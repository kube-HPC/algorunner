const vm = require('vm');
const EventEmitter = require('events');
const workerCommunication = require('./workerCommunication/workerCommunication');
const messages = require('./workerCommunication/messages');
const Logger = require('@hkube/logger');
let log;

const STOP_MARK = 'got stop command';

class Algorunner {
    constructor() {
        this._options = null;
        this._input = {};
        this._stopEmitter = new EventEmitter();
    }

    async init(options) {
        log = Logger.GetLogFromContainer();
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
        log.error('ERROR: ' + error);
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
        log.debug(`send ${command} id=${subPipelineId} with input=${this._input}`);
        workerCommunication.send({
            command,
            data: {
                subPipeline,
                subPipelineId    // Algorithm actually needs to generate and manage the IDs
            }
        });
    }

    getStartedSubPipelineId() {
        return this._startedSubPiplineId;
    }

    _registerToCommunicationEvents() {
        workerCommunication.on('connect', () => {
            log.info('connected!');
        });

        workerCommunication.on('disconnect', () => {
            log.info('disconnected');
        });

        workerCommunication.on(messages.incomming.initialize, (data) => this._initialize(data));

        workerCommunication.on(messages.incomming.start, async (data) => this._start(data));

        // handle subpipeline start event
        workerCommunication.on(messages.incomming.subPiplineStarted, (data) => {
            const subPiplineId = data && data.subPipelineId;
            log.debug(`subpipeline ${subPiplineId} started`);
            this._startedSubPiplineId = subPiplineId;
        });

        // handle subpipeline done event
        workerCommunication.on(messages.incomming.subPipelineDone, (data) => this._subPipelineDone(data));

        // handle subpipeline error event
        workerCommunication.on(messages.incomming.subPipelineError, (data) => {
            let subPipelineId = data && data.subPipelineId;
            let error = data && data.error;
            log.debug(`got subpipeline ${subPipelineId} error command: ${error}`);
            this._sendError(new Error(`SubPipelineError - subPipelineId=${subPipelineId}: ${error}`));
        });

        // handle stop event
        workerCommunication.on(messages.incomming.stop, (data) => {
            if (process.env.IGNORE_STOP) {
                return;
            }
            this._stopEmitter.emit(messages.incomming.stop);
            workerCommunication.send({
                command: messages.outgoing.stopped
            });
        });

        // handle exit event
        workerCommunication.on(messages.incomming.exit, (data) => {
            const code = (data && data.exitCode) | 0;
            log.info(`got exit command. Exiting with code ${code}`);
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
        log.debug(`got 'initialize' command with data: ${JSON.stringify(data)}`);
    }

    /**
     * handle start event from worker
     * @param {object} data 
     */
    async _start(data) {
        let stopped = false;
        log.debug(`running with input: ${JSON.stringify(this._input)}`);
        workerCommunication.send({
            command: messages.outgoing.started
        });

        // eval code
        if (this._code) {
            log.debug(`start eval code...`);
            try {
                this._input = await this._codeResolver(this._code, this._input);
                log.debug(`end eval code, result: ${this._input}`);
            }
            catch (error) {
                this._sendError(error);
            }
            stopped = (this._input === STOP_MARK);
        }
        // if no code make it single result (like code output)
        else if (this._input instanceof Array && this._input.length > 0) {
            this._input = this._input[0];
        }
        if (this._condition && !stopped) {
            // eval condition
            log.debug(`start eval condition...`);
            // const conditionResult = this.evalCode(this._condition, _currentResult);
            try {
                this._conditionResult = await this._codeResolver(this._condition, [this._input]);
                log.debug(`end eval condition, result: ${this._conditionResult}`);
            }
            catch (error) {
                this._sendError(error);
            }

            stopped = (this._conditionResult === STOP_MARK);
            if (!stopped) {
                if (this._conditionResult) {
                    if (this._trueSubPipeline) {
                        this._startSubPipeline(this._trueSubPipeline, 'trueSubPipeline');
                        return;
                    }
                    else {
                        log.console.warn(`condition is true but no trueSubPipeline`);
                    }
                }
                else {
                    if (this._falseSubPipeline) {
                        this._startSubPipeline(this._falseSubPipeline, 'falseSubPipeline');
                        return;
                    }
                    else {
                        log.console.warn(`condition is false but no falseSubPipeline`);
                    }
                }    
            }
        }
        if (stopped) {
            log.info(`stopped!`);
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
            log.debug(`got subPipelineDone for ${subPipelineId}: result=${response[0].result}, wait 1000 ms to send done`)
            setTimeout(() => {
                workerCommunication.send({
                    command: messages.outgoing.done,
                    data: response[0].result
                });
            }, 1000);    
        }
        else {
            log.debug(`got invalid subPipelineDone for ${subPipelineId}, sending error`);
            this._sendError(new Error(`SubPipelineError - subPipelineId=${subPipelineId}: got invalid done command`));
        }
    }
}

module.exports = new Algorunner();