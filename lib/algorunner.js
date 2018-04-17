const vm = require('vm');
const EventEmitter = require('events');
const workerCommunication = require('./workerCommunication/workerCommunication');
const messages = require('./workerCommunication/messages');
const Logger = require('@hkube/logger');
let log;

class Algorunner {
    constructor() {
        this._options = null;
        this._input = {};
        this._stopEmitter = new EventEmitter()
    }

    async init(options) {
        log = Logger.GetLogFromContainer();
        this._options = options;
        this._registerToCommunicationEvents();
    }

    _registerToCommunicationEvents() {
        workerCommunication.on('connect', () => {
            log.info('connected!');
        });

        workerCommunication.on('disconnect', () => {
            log.info('disconnected');
        });

        workerCommunication.on(messages.incomming.initialize, (data) => {
            this._input = data.input;
            this._code = data.info && data.info.extraData && data.info.extraData.code && data.info.extraData.code.join('\n');
            workerCommunication.send({
                command: messages.outgoing.initialized
            });
            log.debug(`got 'initialize' command with data: ${JSON.stringify(data)}`);
        });

        workerCommunication.on(messages.incomming.start, async (data) => {
            log.debug(`running with input: ${JSON.stringify(this._input)}`);
            workerCommunication.send({
                command: messages.outgoing.started
            });
            if (!this._code) {
                workerCommunication.send({
                    command: messages.outgoing.done,
                    data: 52
                });
                return;
            }
            try {
                const wrapper = () => {
                    return new Promise((resolve, reject) => {
                        let stopped = false;
                        this._stopEmitter.on('stop', () => {
                            stopped = true;
                            return resolve('got stop command');
                        })
                        const userFunctionPromise = Promise.resolve(vm.runInThisContext(`(${this._code})`)(this._input));
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
                const output = await wrapper();
                if (output === 'got stop command') {
                    log.info(`stopped!`);
                }
                else {
                    workerCommunication.send({
                        command: messages.outgoing.done,
                        data: output
                    });
                }
                // TODO: make some sort of progress report
            }
            catch (error) {
                // TODO: send error
                log.error('ERROR ' + error);
                workerCommunication.send({
                    command: messages.outgoing.error,
                    error: {
                        code: 'Failed',
                        message: `Error: ${error.message || error}`,
                        details: error.stackTrace
                    }
                });
            }
        });

        workerCommunication.on(messages.incomming.stop, (data) => {
            if (process.env.IGNORE_STOP) {
                return;
            }
            this._stopEmitter.emit(messages.incomming.stop);
            workerCommunication.send({
                command: messages.outgoing.stopped
            });
        });

        workerCommunication.on(messages.incomming.ping, (data) => {
            workerCommunication.send({
                command: messages.outgoing.pong
            });
        });
    }
}

module.exports = new Algorunner();