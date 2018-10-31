const vm = require('vm');
const EventEmitter = require('events');
const workerCommunication = require('./workerCommunication/workerCommunication');
const messages = require('./workerCommunication/messages');

const STOP_MARK = 'got stop command';

class Algorunner {
    constructor() {
        this._options = null;
        this._input = {};
        this._stopEmitter = new EventEmitter();
    }

    async init(options) {
        this._options = options;
        this._registerToCommunicationEvents();
    }

    _codeResolver(code, input) {
        return new Promise((resolve, reject) => {
            let stopped = false;
            this._stopEmitter.on('stop', () => {
                stopped = true;
                return resolve(STOP_MARK);
            })
            const userFunctionPromise = Promise.resolve(vm.runInThisContext(`(${code})`)(input));
            userFunctionPromise.then((result) => {
                this._stopEmitter.removeAllListeners();
                if (!stopped) {
                    return resolve(result);
                }
            }).catch(error => {
                this._stopEmitter.removeAllListeners();
                return reject(error);
            })
        });
    }

    /**
     * Send error message to worker.
     * @param {object} error 
     */
    _sendError(error) {
        console.error('ERROR: ' + error);
        workerCommunication.send({
            command: messages.outgoing.error,
            error: {
                code: 'Failed',
                message: `Error: ${error.message || error}`,
                details: error.stackTrace
            }
        });
    }

    _isRawPipeline(subPipeline) {
        return subPipeline && subPipeline.nodes;
    }

    /**
     * Start subpipeline
     * @param {object} subPipeline may be raw or stored
     * @param {string} subPipelineId internal subpipeline Id (for algorithm use to follow subpipeline progess)
     */
    _startSubPipeline(subPipeline, subPipelineId) {
        // assign input to sub pipeline using flowInput
        // NOTE: expect subpipeline to have: "input": ["@flowInput.data"]
        subPipeline.flowInput = {
            data: this._input
        };
        // Send appropriate start subpipeline command (Raw or Stored)
        const command = this._isRawPipeline(subPipeline) ? messages.outgoing.startRawSubPipeline : messages.outgoing.startStoredSubPipeline;
        console.debug(`send ${command} id=${subPipelineId} with input=${this._input}`);
        workerCommunication.send({
            command,
            data: {
                subPipeline,
                subPipelineId    // Algorithm actually needs to generate and manage the IDs
            }
        });
    }

    getStartedSubPipelineId() {
        return this._startedSubPipelineId;
    }

    _registerToCommunicationEvents() {
        workerCommunication.on('connect', () => {
            console.info('connected!');
        });

        workerCommunication.on('disconnect', () => {
            console.info('disconnected');
        });

        workerCommunication.on(messages.incoming.initialize, (data) => this._initialize(data));

        workerCommunication.on(messages.incoming.start, (data) => this._start(data));

        // handle subpipeline start event
        workerCommunication.on(messages.incoming.subPipelineStarted, (data) => {
            const subPipelineId = data && data.subPipelineId;
            console.debug(`subpipeline ${subPipelineId} started`);
            this._startedSubPipelineId = subPipelineId;
        });

        // handle subpipeline done event
        workerCommunication.on(messages.incoming.subPipelineDone, (data) => this._subPipelineDone(data));

        // handle subpipeline error event
        workerCommunication.on(messages.incoming.subPipelineError, (data) => {
            let subPipelineId = data && data.subPipelineId;
            let error = data && data.error;
            console.debug(`got subPipeline ${subPipelineId} error command: ${error}`);
            this._sendError(new Error(`SubPipelineError - subPipelineId=${subPipelineId}: ${error}`));
        });

        workerCommunication.on(messages.incoming.subPipelineStopped, (data) => {
            let subPipelineId = data && data.subPipelineId;
            console.debug(`got subPipeline ${subPipelineId} stopped`);
            // possible alg option: send alg error because the subPipeline stopped
            this._sendError(new Error(`Failed because alg subPipeline ${subPipelineId} stopped`));
        });

        // handle stop event
        workerCommunication.on(messages.incoming.stop, (data) => {
            this._stop();
        });

        // handle exit event
        workerCommunication.on(messages.incoming.exit, (data) => {
            const code = (data && data.exitCode) | 0;
            console.info(`got exit command. Exiting with code ${code}`);
            process.exit(code);
        });
    }

    /**
     * handle initialize event from worker
     * @param {object} data 
     */
    _initialize(data) {
        /**
         * algorunner flow:
         * - if code exists => eval code on input
         * - if condition exists => eval condition on input
         * - if condition is true => send startRawSubPipeline/startStoredSubPipeline message for trueSubPipeline with current result as input
         * - else (condition is false) => send startRawSubPipeline/startStoredSubPipeline message for falseSubPipeline with current result as input
         */
        this._input = data && data.input;
        const info = data && data.info;
        const extraData = info && info.extraData && info.extraData || {};
        this._code = extraData && extraData.code && extraData.code.join('\n');
        this._condition = extraData && extraData.conditionCode && extraData.conditionCode.join('\n');
        this._trueSubPipeline = extraData.trueSubPipeline;
        this._falseSubPipeline = extraData.falseSubPipeline;
        workerCommunication.send({
            command: messages.outgoing.initialized
        });
        console.debug(`got 'initialize' command`);
    }

    async _start() {
        let stopped = false;
        console.debug(`running with input: ${this._input.length}`);
        workerCommunication.send({
            command: messages.outgoing.started
        });

        // eval code
        if (this._code) {
            console.debug(`start eval code...`);
            try {
                this._input = await this._codeResolver(this._code, this._input);
                console.debug(`end eval code, result: ${this._input}`);
            }
            catch (error) {
                this._sendError(new Error(`failed to eval code: ${error.message}`));
                return;
            }
            stopped = (this._input === STOP_MARK);
        }
        // if no code make it single result (like code output)
        else if (this._input instanceof Array && this._input.length > 0) {
            this._input = this._input[0];
        }
        if (this._condition && !stopped) {
            // eval condition
            console.debug(`start eval condition...`);
            // const conditionResult = this.evalCode(this._condition, _currentResult);
            try {
                this._conditionResult = await this._codeResolver(this._condition, [this._input]);
                console.debug(`end eval condition, result: ${this._conditionResult}`);
            }
            catch (error) {
                this._sendError(new Error(`failed to eval condition: ${error.message}`));
                return;
            }

            stopped = (this._conditionResult === STOP_MARK);
            if (!stopped) {
                if (this._conditionResult) {
                    if (this._trueSubPipeline) {
                        this._startSubPipeline(this._trueSubPipeline, 'trueSubPipeline');
                        return;
                    }
                    else {
                        console.console.warn(`condition is true but no trueSubPipeline`);
                    }
                }
                else {
                    if (this._falseSubPipeline) {
                        this._startSubPipeline(this._falseSubPipeline, 'falseSubPipeline');
                        return;
                    }
                    else {
                        console.console.warn(`condition is false but no falseSubPipeline`);
                    }
                }
            }
        }
        if (stopped) {
            console.info(`stopped!`);
        }
        else {
            workerCommunication.send({
                command: messages.outgoing.done,
                data: this._input
            });
        }
    }

    /**
     * Handle subPipelineDone event from worker
     * @param {object} data 
     */
    _subPipelineDone(data) {
        let subPipelineId = data && data.subPipelineId;
        let response = data && data.response;
        if (subPipelineId && response && (response instanceof Array)) {
            if (subPipelineId !== this.getStartedSubPipelineId()) {
                this._sendError(new Error(`got subPipelineDone for unknown id=${subPipelineId}`));
                return;
            }
            console.debug(`got subPipelineDone for ${subPipelineId}: result=${response[0].result}, wait 1000 ms to send done`)
            setTimeout(() => {
                workerCommunication.send({
                    command: messages.outgoing.done,
                    data: response[0].result
                });
            }, 1000);
        }
        else {
            console.debug(`got invalid subPipelineDone for ${subPipelineId}, sending error`);
            this._sendError(new Error(`SubPipelineError - subPipelineId=${subPipelineId}: got invalid done command`));
        }
    }

    _stop() {
        if (process.env.IGNORE_STOP) {
            return;
        }
        this._stopEmitter.emit(messages.incoming.stop);
        workerCommunication.send({
            command: messages.outgoing.stopped
        });
    }
}

module.exports = new Algorunner();