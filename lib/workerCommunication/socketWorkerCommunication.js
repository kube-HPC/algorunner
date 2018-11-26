const EventEmitter = require('events');
const djsv = require('djsv');
const schema = require('./workerCommunicationConfigSchema').socketWorkerCommunicationSchema;
const socketio = require('socket.io-client');
const messages = require('./messages');

class SocketWorkerCommunication extends EventEmitter {
    constructor() {
        super();
        this._options = null;
        this._socket = null;
        this._url = null;
    }

    init(options) {
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

                const socketOptions={
                    transports: ['websocket'],
                    rejectUnauthorized: false
                };
                if (this._options.connection.url){
                    const url = new URL(this._options.connection.url);
                    socketOptions.path = url.pathname;
                    this._url = url.origin;
                }
                else {
                    this._url = `${this._options.connection.protocol}://${this._options.connection.host}:${this._options.connection.port}`;
                }
                console.info(`algorunner socket connecting to ${this._url}`);
                this._socket = socketio(this._url,socketOptions);
                this._registerSocketMessages(this._socket);
                return resolve();
            } catch (error) {
                return reject(error);
            }
        });
    }

    _registerSocketMessages(socket) {
        Object.values(messages.incoming).forEach((topic) => {
            console.info(`registering for topic ${topic}`);
            socket.on(topic, (message) => {
                console.debug(`got message on topic ${topic}`);
                this.emit(topic, message && message.data);
            });
        });
        socket.on('connect', () => {
            console.info(`algorunner socket connected to ${this._url}`);
        });
        socket.on('disconnect', () => {
            console.info(`algorunner socket disconnected from ${this._url}`);
        });
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
            console.error(error);
            throw new Error(error)
        }
        this._socket.emit(message.command, message);
    }
}

module.exports = SocketWorkerCommunication;