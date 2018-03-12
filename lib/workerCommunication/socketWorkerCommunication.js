const EventEmitter = require('events');
const Logger = require('@hkube/logger')
const djsv = require('djsv');
const schema = require('./workerCommunicationConfigSchema').socketWorkerCommunicationSchema;
const socketio = require('socket.io-client');
const messages = require('./messages');
let log;

class SocketWorkerCommunication extends EventEmitter {
    constructor() {
        super();
        this._options = null;
        this._socket = null;

    }
    init(options) {
        log = Logger.GetLogFromContainer();
        return new Promise((resolve, reject) => {
            try {
                options = options || {};
                const validator = djsv(schema);
                const validatedOptions = validator(options);
                if (validatedOptions.valid) {
                    this._options = validatedOptions.instance;
                }
                else {
                    return reject(new Error(validatedOptions.error));
                }
                const url = `${this._options.connection.protocol}://${this._options.connection.host}:${this._options.connection.port}`;
                log.info(`algorunner socket connecting to ${url}`);
                this._socket = socketio(url);
                this._registerSocketMessages(this._socket);
                return resolve();
            } catch (error) {
                return reject(error);
            }
        });
    }

    _registerSocketMessages(socket) {
        Object.values(messages.incomming).forEach((topic) => {
            log.info(`registering for topic ${topic}`);
            socket.on(topic, (message) => {
                log.info(`got message on topic ${topic}`);
                this.emit(topic, message && message.data);
            });
        });
        socket.on('connect', () => {
            log.info('Client Connected!!!')
        })
        socket.on('disconnect', () => {
            log.info('socket disconnected');
        })
    }
    /**
        * 
        * 
        * @param {any} message the message to send to the algoRunner.
        * @param {string} message.command the command for the runner. one of messages.outgoing
        * @param {object} message.data the data for the command
        * @memberof SocketWorkerCommunication
        */
    send(message) {
        if (!this._socket) {
            const error = 'trying to send without a connected socket';
            log.error(error);
            throw new Error(error)
        }
        this._socket.emit(message.command, message);
    }
}

module.exports = SocketWorkerCommunication;