const EventEmitter = require('events');
const djsv = require('djsv');
const WebSocket = require('ws');
const schema = require('./workerCommunicationConfigSchema').socketWorkerCommunicationSchema;
const messages = require('./messages');

class WsWorkerCommunication extends EventEmitter {
    constructor() {
        super();
        this._socket = null;
        this._url=null;
        this._reconnectInterval = 5000;
    }

    _connect() {
        console.log(`connecting to ${this._url}`);
        this._socket = new WebSocket(this._url);
        this._socket.on('open', () => {
            this.emit('connection');
        });
        this._handleConnectEvents();
        this._handleMessages();
    }

    init(options) {
        options = options || {};
        const validator = djsv(schema);
        const validatedOptions = validator(options);
        if (validatedOptions.valid) {
            this._options = validatedOptions.instance;
        }
        else {
            throw(new Error(validatedOptions.error));
        }
        if (this._options.connection.url){
            this._url = this._options.connection.url;
        }
        else {
            this._url = `${this._options.connection.protocol}://${this._options.connection.host}:${this._options.connection.port}`;
        }
        this._connect();
    }

    _handleConnectEvents() {
        this._socket.on('close', (code, reason) => {
            switch (code) {
                case 1000:
                    this.emit('disconnect');
                    break;
                default:
                    this._reconnect();
                    break;
            }
        });
        this._socket.on('error', (e) => {
            switch (e.code) {
                case 'ECONNREFUSED':
                    this._reconnect();
                    break;
                default:
                    this.emit('disconnect');
                    break;
            }
        });
    }

    _handleMessages() {
        this._socket.on('message', (message) => {
            const payload = JSON.parse(message);
            this.emit(payload.command, payload.data);
        });
    }

    _reconnect() {
        this._socket.removeAllListeners();
        setTimeout(() => {
            this._connect();
        }, this._reconnectInterval);
    }

    send(message) {
        this._socket.send(JSON.stringify(message));
    }
}

module.exports = WsWorkerCommunication;