const adapters = require('../consts/consts').adapters;
const socketWorkerCommunicationSchema = {
    type: 'object',
    properties: {
        connection: {
            type: 'object',
            properties: {
                host: {
                    type: 'string',
                    default: 'localhost'
                },
                port: {
                    type: ['integer', 'string'],
                    default: 3000
                },
                protocol: {
                    type: 'string',
                    default: 'ws'
                }
            }
        }
    }
}
const workerCommunicationSchema = {
    type: 'object',
    properties: {
        adapterName: {
            type: 'string',
            default: adapters.socket
        },
        config: {
            type: 'object'
        }
    },
    required: ['config']
}
module.exports = {
    socketWorkerCommunicationSchema,
    workerCommunicationSchema
}