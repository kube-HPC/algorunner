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
        this._stopEmitter = new EventEmitter();
        this._currentResult = 10;  // default output if no code
    }

    async init(options) {
        log = Logger.GetLogFromContainer();
        this._options = options;
        this._registerToCommunicationEvents();
    }

    codeResolver() {
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
            this._subPipiline = data.info && data.info.extraData && data.info.extraData.subPipeline;
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
                this.input = this._currentResult;
                const condition = true;   // TODO: get expression by params
                if (this._subPipiline && condition) {
                    this._subPipiline.flowInput = {
                        data: this._currentResult
                    };
                    workerCommunication.send({
                        command: messages.outgoing.startSubPipeline,
                        data: {
                            subPipeline: this._subPipiline,
                            subPipelineId: 'subpipe001'    // Algorithm actually needs to generate and manage the IDs
                        }
                    });
                }
                else {
                    workerCommunication.send({
                        command: messages.outgoing.done,
                        data: this._subPipiline
                    });
                }
                return;
            }
            try {
                // const wrapper = () => {
                //     return new Promise((resolve, reject) => {
                //         let stopped = false;
                //         this._stopEmitter.on('stop', () => {
                //             stopped = true;
                //             return resolve('got stop command');
                //         })
                //         const userFunctionPromise = Promise.resolve(vm.runInThisContext(`(${this._code})`)(this._input));
                //         userFunctionPromise.then((result) => {
                //             this._stopEmitter.removeAllListeners();
                //             if (!stopped) {
                //                 return resolve(result);
                //             }
                //         }).catch(error => {
                //             this._stopEmitter.removeAllListeners();
                //             return reject(error);
                //         })
                //     });
                // }
                // const output = await wrapper();
                const output = await this.codeResolver();
                if (output === 'got stop command') {
                    log.info(`stopped!`);
                }

                // TODO add conditioned sub-pipeline
                else {
                    this._currentResult = output;
                    workerCommunication.send({
                        command: messages.outgoing.done,
                        data: this._currentResult
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

        // subpipeline done event
        workerCommunication.on(messages.incomming.done, (data) => {
            // TODO dummy impl
            if (data && data.subPipelineId && data.response && (data.response instanceof Array)) {
                log.debug(`got subpipeline id=${data.subPipelineId} done: result=${data.response[0].result}, wait 1000 ms to send done`)
                setTimeout(() => {
                    workerCommunication.send({
                        command: messages.outgoing.done,
                        data: data.response[0].result
                    });
                }, 1000);    
            }
            else {
                log.debug(`got subpipeline ${data.subPipelineId} buggy done error command, sending error`)
                workerCommunication.send({
                    command: messages.outgoing.error,
                    error: {
                        code: 'SubPipelineDoneError',
                        message: `Sub Pipeline ${data.subPipelineId} result Error`
                    }
                });
            }
        });

        // subpipeline error event
        workerCommunication.on(messages.incomming.error, (data) => {
            // TODO dummy impl
            log.debug(`got subpipeline ${data.subPipelineId} error command, sending error`)
            workerCommunication.send({
                command: messages.outgoing.error,
                error: {
                    code: 'SubPipelineError',
                    message: `Sub Pipeline ${data.subPipelineId} Error`
                }
            });
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

        workerCommunication.on(messages.incomming.exit, (data) => {
            const code = (data && data.exitCode) | 0;
            log.info(`got exit command. Exiting with code ${code}`);
            process.exit(code);
        });
    }
}

module.exports = new Algorunner();