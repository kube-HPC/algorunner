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

    codeResolver(code, input) {
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

    // static async evalCode(code, input) {
    //     try {
    //         const output = await this.codeResolver(code, input);
    //         return output;
    //     }
    //     catch (error) {
    //         log.error('ERROR ' + error);
    //         workerCommunication.send({
    //             command: messages.outgoing.error,
    //             error: {
    //                 code: 'Failed',
    //                 message: `Error: ${error.message || error}`,
    //                 details: error.stackTrace
    //             }
    //         });
    //     }
    // }

    sendError(error) {
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

    startSubPipeline(subPipeline, subPipelineId) {
        subPipeline.flowInput = {
            data: this._input
        };
        workerCommunication.send({
            command: messages.outgoing.startRawSubPipeline,
            data: {
                subPipeline,
                subPipelineId    // Algorithm actually needs to generate and manage the IDs
            }
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
            /**
             * algorunner flow:
             * - if code exists => eval code on input
             * - if condition exists => eval condition
             * - if contidion is true => send subPipelineStart message for trueSubPipeline with current result as input
             * - else (contidion is false) => send subPipelineStart message for falseSubPipeline with current result as input
             */
            this._input = data.input;
            this._code = data.info && data.info.extraData && data.info.extraData.code && data.info.extraData.code.join('\n');
            this._condition = data.info && data.info.extraData && data.info.extraData.conditionCode && data.info.extraData.conditionCode.join('\n');
            this._trueSubPipeline = data.info && data.info.extraData && data.info.extraData.trueSubPipeline;
            this._falseSubPipeline = data.info && data.info.extraData && data.info.extraData.falseSubPipeline;
            workerCommunication.send({
                command: messages.outgoing.initialized
            });
            log.debug(`got 'initialize' command with data: ${JSON.stringify(data)}`);
        });

        workerCommunication.on(messages.incomming.start, async (data) => {
            let stopped = false;
            log.debug(`running with input: ${JSON.stringify(this._input)}`);
            workerCommunication.send({
                command: messages.outgoing.started
            });

            // eval code
            if (this._code) {
                log.debug(`start eval code...`);
                try {
                    this._input = await this.codeResolver(this._code, this._input);
                    log.debug(`end eval code, result: ${this._input}`);
                }
                catch (error) {
                    this.sendError(error);
                }
                stopped = (this._input === STOP_MARK);
            }
            if (this._condition && !stopped) {
                // eval condition
                log.debug(`start eval condition...`);
                // const conditionResult = this.evalCode(this._condition, _currentResult);
                try {
                    this._conditionResult = await this.codeResolver(this._condition, this._input);
                    log.debug(`end eval condition, result: ${this._conditionResult}`);
                }
                catch (error) {
                    this.sendError(error);
                }

                stopped = (this._input === STOP_MARK);
                if (!stopped) {
                    if (this._conditionResult) {
                        if (this._trueSubPipeline) {
                            log.debug(`start eval trueSubPipeline with input=${this._input}...`);
                            this._trueSubPipeline.flowInput = {
                                data: this._input
                            };
                            this.startSubPipeline(this._trueSubPipeline, 'trueSubPipeline');
                            return;
                        }
                        else {
                            log.console.warn(`condition is true but no trueSubPipeline`);
                        }
                    }
                    else {
                        if (this._falseSubPipeline) {
                            log.debug(`start eval falseSubPipeline with input=${this._input}...`);
                            this._falseSubPipeline.flowInput = {
                                data: this._input
                            };
                            this.startSubPipeline(this._falseSubPipeline, 'falseSubPipeline');
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
        });

        // handle subpipeline done event
        workerCommunication.on(messages.incomming.subPipelineDone, (data) => {
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

        // handle subpipeline error event
        workerCommunication.on(messages.incomming.subPipelineError, (data) => {
            log.debug(`got subpipeline ${data.subPipelineId} error command, sending error`)
            workerCommunication.send({
                command: messages.outgoing.error,
                error: {
                    code: 'SubPipelineError',
                    message: `Sub Pipeline ${data.subPipelineId} Error`
                }
            });
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

        workerCommunication.on(messages.incomming.exit, (data) => {
            const code = (data && data.exitCode) | 0;
            log.info(`got exit command. Exiting with code ${code}`);
            process.exit(code);
        });
    }
}

module.exports = new Algorunner();