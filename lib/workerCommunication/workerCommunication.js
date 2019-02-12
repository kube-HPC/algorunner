const EventEmitter = require('events');
const djsv = require('djsv');
const schema = require('./workerCommunicationConfigSchema').workerCommunicationSchema;
const socketAdapter = require('./socketWorkerCommunication');
const wsAdapter = require('./wsWorkerCommunication');
const adapters = require('../consts/consts').adapters;
const forward_emitter = require('forward-emitter');

class WorkerCommunication extends EventEmitter {
    constructor() {
        super();
        this._options = null;
        this._adapters = {};
        this._adapters[adapters.socket] = socketAdapter;
        this._adapters[adapters.ws] = wsAdapter;
        this.adapter = null;
    }
    async init(options) {
        if (this.adapter) {
            this.adapter.removeAllListeners();
            this.adapter = null;
            this.removeAllListeners();

        }
        options = options || {};
        const validator = djsv(schema);
        const validatedOptions = validator(options.workerCommunication);
        if (validatedOptions.valid) {
            this._options = validatedOptions.instance;
        }
        else {
            throw new Error(validatedOptions.error);
        }
        const adapterClass = this._adapters[this._options.adapterName];
        if (!adapterClass) {
            throw new Error(`Invalid worker communication adapter ${this._options.adapterName}`);
        }
        console.info(`Creating communication object of type: ${this._options.adapterName}`);
        this.adapter = new adapterClass();
        await this.adapter.init(this._options.config);
        forward_emitter(this.adapter, this);
    }

    /**
     * 
     * 
     * @param {any} message the message to send to the algoRunner.
     * @param {string} message.command the command for the runner. one of messages.outgoing
     * @param {object} message.data the data for the command
     * @memberof WorkerCommunication
     */
    send(message) {
        console.debug(`sending ${message.command}`);
        return this.adapter.send(message);
    }
}

module.exports = new WorkerCommunication();