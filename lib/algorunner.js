const vm = require('vm');
const EventEmitter = require('events');
const workerCommunication = require('./workerCommunication/workerCommunication');
const messages = require('./workerCommunication/messages');
const Logger = require('@hkube/logger');
const prime = require('prime-factors');
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
        let interval;
        this._registerToCommunicationEvents();
    }

    _cleanup() {
        _input = {};
        progress = 0;
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
            workerCommunication.send({
                command: messages.outgoing.initialized
            });
            log.info(`got 'initialize' command with data: ${JSON.stringify(data)}`);
        });

        workerCommunication.on(messages.incomming.start, async (data) => {
            log.info(`running with input: ${JSON.stringify(this._input)}`);
            workerCommunication.send({
                command: messages.outgoing.started
            });
            try {
                    setTimeout(()=>{
                        const output = prime(this._input[0])
                        log.info(output);
                        workerCommunication.send({
                            command: messages.outgoing.done,
                            data: output
                        });
                    },200)

            } catch (error) {

                //TODO: send error
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