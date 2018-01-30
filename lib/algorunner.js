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
        let interval;


        this._registerToCommunicationEvents();

    }

    _cleanup() {

        _input = {};
        //             if (interval){
        //                 clearInterval(interval);
        //             }
        progress = 0;

    }

    _registerToCommunicationEvents() {
        workerCommunication.on('connect', () => {
            //_cleanup();
            log.info('connected!');
            console.log('connected!')
        });

        workerCommunication.on('disconnect', () => {
            log.info('disconnected');
            console.log('disconnected!')
        });

        workerCommunication.on(messages.incomming.initialize, (data) => {
            //cleanup();
            this._input = data.input;
            workerCommunication.send({
                command: messages.outgoing.initialized
            });
            log.info(`got 'initialize' command with data: ${JSON.stringify(data)}`);
            console.log(`got 'initialize' command with data: ${JSON.stringify(data)}`)
        });

        workerCommunication.on(messages.incomming.start, async (data) => {
            console.log('got start!')

            let input = this._input[0];
            let code = this._input[0].join('\n');
            let inputs = this._input.slice(1);
            log.info(`running ${code} with input: ${JSON.stringify(inputs)}`);

            workerCommunication.send({
                command: messages.outgoing.started
            });
            try {
                let userFunction = eval(code);
                const wrapper = (inputs, require, stopEmitter) => {
                    return new Promise((resolve, reject) => {
                        let stopped = false;
                        if (stopEmitter && stopEmitter instanceof EventEmitter) {
                            stopEmitter.on('stop', () => {
                                stopped = true;
                                return resolve('got stop command');
                            })
                        }
                        const userFunctionPromise = Promise.resolve(userFunction(inputs, require, this._stopEmitter));
                        userFunctionPromise.then((result) => {
                            if (!stopped) {
                                return resolve(result);
                            }
                        }).catch(error => {
                            return reject(error);
                        })
                    });
                }
                let output = await wrapper(inputs, require, this._stopEmitter);
                if (output === 'got stop command') {
                    console.log('stopped!');

                }
                else {
                    console.log(output);
                    workerCommunication.send({
                        command: messages.outgoing.done,
                        data: output
                    });
                }
                // //TODO: make some sort of progress report

            } catch (error) {

                //TODO: send error
                console.error('ERROR ' + error)
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
            if (process.env.IGNORE_STOP){
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