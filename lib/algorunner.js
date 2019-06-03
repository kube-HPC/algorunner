const vm = require('vm');
const EventEmitter = require('events');
const getPath = require('lodash.get');
const setPath = require('lodash.set');
const uuid = require('uuid/v4');
const Websocket = require('./workerCommunication/ws');
const messages = require('./workerCommunication/messages');

const STOP_MARK = 'got stop command';

const TYPES = {
    algorithms: 'algorithms',
    subPipelines: 'subPipelines'
};

const STATUS = {
    SENT: 'sent',
    STARTED: 'started',
    DONE: 'done',
    ERROR: 'error',
    STOPPING: 'stopping',
    STOPPED: 'stopped'
};

class Algorunner {
    constructor() {
        this._options = null;
        this._url = null;
        this._wsc = null;
        this._stopEmitter = new EventEmitter();
    }

    async init(options) {
        this._options = options;
        this._url = options.socket.url || `${options.socket.protocol}://${options.socket.host}:${options.socket.port}`;
        console.debug(`connecting to ${this._url}`);
        this._wsc = new Websocket({ url: this._url });
        this._registerToCommunicationEvents();
    }

    /**
     * - subPipeline
    */
    startSubPipeline({ subPipeline }) {
        subPipeline.flowInput = { data: this._input };
        const command = this._isRawPipeline(subPipeline) ? messages.outgoing.startRawSubPipeline : messages.outgoing.startStoredSubPipeline;
        return this._startInstance({ type: TYPES.subPipelines, command, data: { subPipeline }, idPath: 'subPipelineId' });
    }

    stopSubPipeline({ subPipelineId, reason }) {
        const sub = this._instanceIds[TYPES.subPipelines][subPipelineId];
        sub.status = STATUS.STOPPING;
        return this._sendCommand({ command: messages.outgoing.stopSubPipeline, data: { subPipelineId, reason } });
    }

    /** 
     * message:
     * - execId
     * - algorithmName
     * - input
     */
    startAlgorithmExecution({ execId, algorithmName, input }) {
        const command = messages.outgoing.startAlgorithmExecution;
        return this._startInstance({ type: TYPES.algorithms, command, data: { execId, algorithmName, input }, idPath: 'execId' });
    }

    stopAlgorithmExecution({ execId, reason }) {
        delete this._instanceIds[TYPES.algorithms][execId];
        this._sendCommand({
            command: messages.outgoing.stopAlgorithmExecution,
            data: {
                execId,
                reason
            }
        });
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

    _registerToCommunicationEvents() {
        this._wsc.on('connection', () => console.debug(`connected to ${this._url}`));
        this._wsc.on('disconnect', () => console.debug(`disconnected from ${this._url}`));
        this._wsc.on(messages.incoming.initialize, (data) => this._init(data));
        this._wsc.on(messages.incoming.start, (data) => this._start(data));
        this._wsc.on(messages.incoming.stop, (data) => this._stop(data));
        this._wsc.on(messages.incoming.exit, (data) => this._exit(data));
        this._wsc.on(messages.incoming.subPipelineStarted, (data) => this._subPipelineStarted(data));
        this._wsc.on(messages.incoming.subPipelineDone, (data) => this._subPipelineDone(data));
        this._wsc.on(messages.incoming.subPipelineError, (data) => this._subPipelineError(data));
        this._wsc.on(messages.incoming.subPipelineStopped, (data) => this._subPipelineStopped(data));
        this._wsc.on(messages.incoming.execAlgorithmError, (data) => this._execAlgorithmError(data));
        this._wsc.on(messages.incoming.execAlgorithmDone, (data) => this._execAlgorithmDone(data));
    }

    _clean() {
        this._input = null;
        this._result = null;
        this._instanceIds = {
            [TYPES.algorithms]: Object.create(null),
            [TYPES.subPipelines]: Object.create(null)
        };
    }

    _init(data) {
        this._clean();
        this._input = data && data.input;
        const code = getPath(data, 'info.extraData.code', {});
        this._code = code.join && code.join('\n');
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
                this._result = await this._codeResolver(this._code, this._input);
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

        if (stopped) {
            console.info(`stopped!`);
        }
        else {
            const isExecDone = this._isAllInstancesDone(TYPES.algorithms);
            const isSubDone = this._isAllInstancesDone(TYPES.subPipelines);
            if (isExecDone && isSubDone) {
                this._sendDone(this._result || this._input);
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

    _execAlgorithmDone(data) {
        this._onInstanceDone({ id: data.execId, type: TYPES.algorithms, response: data.response });
    }

    _execAlgorithmError(data) {
        this._onInstanceError({ id: data.execId, type: TYPES.algorithms, response: data.error });
    }

    _isRawPipeline(subPipeline) {
        return subPipeline && subPipeline.nodes;
    }

    _subPipelineStarted(data) {
        const sub = this._instanceIds[TYPES.subPipelines][data.subPipelineId];
        sub.status = STATUS.STARTED;
    }

    _subPipelineDone(data) {
        this._onInstanceDone({ id: data.subPipelineId, type: TYPES.subPipelines, response: data.response });
    }

    _subPipelineError(data) {
        this._onInstanceError({ id: data.subPipelineId, type: TYPES.subPipelines, response: data.error });
    }

    _subPipelineStopped(data) {
        const sub = this._instanceIds[TYPES.subPipelines][data.subPipelineId];
        sub.status = STATUS.STOPPED;
        sub.reason = data.reason;
        sub.resolve(data.reason);
        this._checkAllInstancesResult(TYPES.subPipelines);
    }

    _onInstanceDone({ id, type, response }) {
        const sub = this._instanceIds[type][id];
        sub.status = STATUS.DONE;
        sub.response = response;
        sub.resolve(response);
        this._checkAllInstancesResult(type);
    }

    _onInstanceError({ id, type, error }) {
        const sub = this._instanceIds[type][id];
        sub.status = STATUS.ERROR;
        sub.error = error;
        sub.reject(error);
        this._checkAllInstancesResult(type);
    }

    _checkAllInstancesResult(type) {
        const isDone = this._isAllInstancesDone(type);
        if (isDone) {
            const data = Object.values(this._instanceIds[type]).map(e => e.response);
            this._sendDone(data);
            this._instanceIds[type] = Object.create(null);
        }
    }

    _sendInitialized() {
        this._sendCommand({ command: messages.outgoing.initialized });
    }

    _sendStarted() {
        this._sendCommand({ command: messages.outgoing.started });
    }

    _sendStopped() {
        this._sendCommand({ command: messages.outgoing.stopped });
    }

    _sendDone(data) {
        this._sendCommand({ command: messages.outgoing.done, data });
    }

    _sendCommand({ command, data }) {
        this._wsc.send({ command, data });
    }

    _sendError(error) {
        this._wsc.send({
            command: messages.outgoing.error,
            error: {
                code: 'Failed',
                message: `Error: ${error.message || error}`,
                details: error.stackTrace
            }
        });
    }

    _startSpan(name, tags) {
        this._sendCommand({ command: messages.outgoing.startSpan, data: { name, tags } });
    }

    _finishSpan(tags, error) {
        this._sendCommand({ command: messages.outgoing.finishSpan, data: { tags, error } });
    }

    _startInstance({ type, command, data, idPath }) {
        const id = uuid();
        const done = this._startInstancePromise({ id, type, command, data, idPath });
        return {
            id,
            done
        };
    }

    _startInstancePromise({ id, type, command, data, idPath }) {
        return new Promise((resolve, reject) => {
            this._instanceIds[type][id] = { status: STATUS.SENT, resolve, reject };
            setPath(data, idPath, id);
            this._sendCommand({ command, data });
        });
    }

    _isAllInstancesDone(type) {
        return Object.values(this._instanceIds[type]).every(this._isDoneState);
    }

    _isDoneState(e) {
        return e.status !== STATUS.SENT && e.status !== STATUS.STARTED;
    }
}

module.exports = new Algorunner();