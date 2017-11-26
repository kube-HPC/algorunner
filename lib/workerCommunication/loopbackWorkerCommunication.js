const EventEmitter = require('events');
const log = require('@hkube/logger').GetLogFromContainer();
const djsv = require('djsv');
const schema = require('./workerCommunicationConfigSchema').loopbackWorkerCommunicationSchema;
const forward_emitter = require('forward-emitter');

class LoopbackWorkerCommunication extends EventEmitter {
    constructor() {
        super();
    }

    async init(option){

    }


    simulateMessage(message){
        this.emit('message',message);
    }

    send(message){
        this.emit('message-outgoing',message);        
    }
}

module.exports = LoopbackWorkerCommunication;