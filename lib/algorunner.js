const workerCommunication = require('./workerCommunication/workerCommunication');
const messages = require('./workerCommunication/messages');
const Logger = require('@hkube/logger');
let log;
class Algorunner {
    constructor() {
        this._options = null;
        this._input = {};
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
            this._input = data.data.input;
            workerCommunication.send({
                command: messages.outgoing.initialized
            });
            log.info(`got 'initialize' command with data: ${JSON.stringify(data)}`);
            console.log(`got 'initialize' command with data: ${JSON.stringify(data)}`)
        });

        workerCommunication.on(messages.incomming.start, (data) => {
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
                let output = userFunction(inputs, require);
                // //TODO: make some sort of progress report
                console.log(output);
                workerCommunication.send({
                    command: messages.outgoing.done,
                    data: output
                });
            } catch (error) {
                //TODO: send error
                console.error('ERROR ' + error)
                workerCommunication.send({
                    command: messages.outgoing.error,
                    data: {
                        error: {
                            message: error.message
                        }
                    }
                });
            }
        });

        workerCommunication.on(messages.incomming.stop, (data) => {
            //TODO: how do we stop the vm?
            cleanup();
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