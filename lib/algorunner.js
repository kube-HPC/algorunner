const vm = require('vm');
const EventEmitter = require('events');
const getPath = require('lodash.get');
const workerCommunication = require('./workerCommunication/workerCommunication');
const messages = require('./workerCommunication/messages');
const STOP_MARK = 'got stop command';

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

class Algorunner {
    constructor() {
        this._options = null;
        this._input = {};
        this._stopEmitter = new EventEmitter();
        this._execIds = Object.create(null);
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
            const userFunctionPromise = Promise.resolve(vm.runInThisContext(`(${code})`)(input, this));
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
        workerCommunication.on('connect', () => console.info('connected!'));
        workerCommunication.on('disconnect', () => console.info('disconnected'));

        workerCommunication.on(messages.incoming.initialize, (data) => this._init(data));
        workerCommunication.on(messages.incoming.start, (data) => this._start(data));
        workerCommunication.on(messages.incoming.stop, (data) => this._stop(data));
        workerCommunication.on(messages.incoming.exit, (data) => this._exit(data));

        workerCommunication.on(messages.incoming.subPipelineStarted, (data) => {
            const subPipelineId = data && data.subPipelineId;
            console.debug(`subpipeline ${subPipelineId} started`);
            this._startedSubPipelineId = subPipelineId;
        });
        workerCommunication.on(messages.incoming.subPipelineDone, (data) => this._subPipelineDone(data));
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
        workerCommunication.on(messages.incoming.execAlgorithmError, (data) => {
            console.info(messages.incoming.execAlgorithmError);
            this._execIds[data.execId] = { status: 'error', error: data.error };
            this._checkAllExecIds();
        });
        workerCommunication.on(messages.incoming.execAlgorithmDone, (data) => {
            console.info(messages.incoming.execAlgorithmDone);
            this._execIds[data.execId] = { status: 'done', result: data.result };
            this._checkAllExecIds();
        });
    }

    _init(data) {
        /**
         * algorunner flow:
         * - if code exists => eval code on input
         * - if condition exists => eval condition on input
         * - if condition is true => send startRawSubPipeline/startStoredSubPipeline message for trueSubPipeline with current result as input
         * - else (condition is false) => send startRawSubPipeline/startStoredSubPipeline message for falseSubPipeline with current result as input
         */
        this._execIds = Object.create(null);
        this._input = data && data.input;
        const extraData = getPath(data, 'info.extraData', {});
        const code = getPath(data, 'info.extraData.code');
        this._code = code && code.join('\n');

        this._condition = extraData.conditionCode && extraData.conditionCode.join('\n');
        this._trueSubPipeline = extraData.trueSubPipeline;
        this._falseSubPipeline = extraData.falseSubPipeline;
        this._sendInitialized();
    }

    async _start() {
        let stopped = false;
        console.debug(`running with input: ${this._input.length}`);
        this._sendStarted();

        // eval code
        if (this._code) {
            console.debug(`start eval code...`);
            this._startSpan('evaluating code', { code: this._code });
            try {
                this._input = await this._codeResolver(this._code, this._input);
                console.debug(`end eval code`);
            }
            catch (error) {
                const errText = `failed to eval code: ${error.message}`;
                this._finishSpan(undefined, errText);
                this._sendError(new Error(errText));
                return;
            }
            stopped = (this._input === STOP_MARK);
            this._finishSpan();
        }
        //await sleep(2000);
        if (this._condition && !stopped) {
            this._startSpan('evaluating condition', { condition: this._condition });
            console.debug(`start eval condition...`);
            try {
                this._conditionResult = await this._codeResolver(this._condition, [this._input]);
                console.debug(`end eval condition, result: ${this._conditionResult}`);
            }
            catch (error) {
                const errText = `failed to eval condition: ${error.message}`;
                this._finishSpan(undefined, errText);
                this._sendError(new Error(errText));
                return;
            }
            this._finishSpan();

            stopped = (this._conditionResult === STOP_MARK);
            if (!stopped) {
                if (this._conditionResult) {
                    if (this._trueSubPipeline) {
                        this._startSubPipeline(this._trueSubPipeline, 'trueSubPipeline');
                        return;
                    }
                    else {
                        console.warn(`condition is true but no trueSubPipeline`);
                    }
                }
                else {
                    if (this._falseSubPipeline) {
                        this._startSubPipeline(this._falseSubPipeline, 'falseSubPipeline');
                        return;
                    }
                    else {
                        console.warn(`condition is false but no falseSubPipeline`);
                    }
                }
            }
        }
        if (stopped) {
            console.info(`stopped!`);
        }
        else {
            const isDone = this._isAllExecIdsDone();
            if (isDone) {
                this._sendDone(this._input);
            }
        }
    }

    _stop() {
        if (process.env.IGNORE_STOP) {
            return;
        }
        this._stopEmitter.emit(messages.incoming.stop);
        this._sendStopped();
    }

    _exit(data) {
        const code = (data && data.exitCode) | 0;
        console.info(`got exit command. Exiting with code ${code}`);
        process.exit(code);
    }

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
                this._sendDone(response[0].result);
            }, 1000);
        }
        else {
            console.debug(`got invalid subPipelineDone for ${subPipelineId}, sending error`);
            this._sendError(new Error(`SubPipelineError - subPipelineId=${subPipelineId}: got invalid done command`));
        }
    }

    _checkAllExecIds() {
        const isDone = this._isAllExecIdsDone();
        if (isDone) {
            this._sendDone(Object.values(this._execIds).map(e => e.result));
            this._execIds = Object.create(null);
        }
    }

    _sendInitialized() {
        workerCommunication.send({
            command: messages.outgoing.initialized
        });
    }

    _sendStarted() {
        workerCommunication.send({
            command: messages.outgoing.started
        });
    }

    _sendStopped() {
        workerCommunication.send({
            command: messages.outgoing.stopped
        });
    }

    _sendDone(data) {
        workerCommunication.send({
            command: messages.outgoing.done,
            data
        });
    }

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

    _startSpan(name, tags) {
        workerCommunication.send({
            command: messages.outgoing.startSpan,
            data: {
                name,
                tags
            }
        });
    }

    _finishSpan(tags, error) {
        workerCommunication.send({
            command: messages.outgoing.finishSpan,
            data: {
                tags,
                error
            }
        });
    }

    /** 
     * message:
     * - execId
     * - algorithmName
     * - input
     */
    startAlgorithmExecution(message) {
        this._execIds[message.execId] = { status: 'sent' }
        workerCommunication.send({
            command: messages.outgoing.startAlgorithmExecution,
            data: message
        });
    }

    stopAlgorithmExecution({ execId, reason }) {
        delete this._execIds[execId];
        workerCommunication.send({
            command: messages.outgoing.stopAlgorithmExecution,
            data: {
                execId,
                reason
            }
        });
    }

    _isAllExecIdsDone() {
        return Object.values(this._execIds).every(e => e.status !== 'sent');
    }
}

module.exports = new Algorunner();