const workerCommunication = require('./workerCommunication/workerCommunication');
const messages = require('./workerCommunication/messages');
const Logger = require('logger.rf');
let log;
class Algorunner {
    constructor() {
        this._options = null;
    }

    async init(options) {
        log = Logger.GetLogFromContainer();
        this._options = options;
        workerCommunication.on('message', (message) => {
            log.info(`got: ${JSON.stringify(message)}`);
            switch (message.command) {
                case messages.incomming.ping:
                    workerCommunication.send({
                        command: messages.outgoing.pong
                    });
                    break;
                case messages.incomming.initialize:
                    workerCommunication.send({
                        command: messages.outgoing.initialized
                    });
                    break;
                case messages.incomming.start:
                    let progress = 0;
                    let interval = setInterval(()=>{
                        workerCommunication.send({
                            command: messages.outgoing.progress,
                            data:{progress}
                        });
                        progress+=10;
                        if (progress >=100){
                            clearInterval(interval);
                            workerCommunication.send({
                                command: messages.outgoing.done,
                                data:{output:['out1','out2']}
                            });

                        }
                    },1000)
                    workerCommunication.send({
                        command: messages.outgoing.started
                    });
                    break;
                case messages.incomming.stop:
                    workerCommunication.send({
                        command: messages.outgoing.stopped
                    });
                    break;
            }

        })
    }
}

module.exports = new Algorunner();