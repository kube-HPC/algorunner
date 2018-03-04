
const config = module.exports = {};

config.serviceName = 'algorunner';

config.workerCommunication = {
    adapterName: 'socket',
    config: {
        connection: {
            port: process.env.WORKER_SOCKET_PORT || 3000,
            host: process.env.WORKER_SOCKET_HOST || "localhost"
        }
    }
};



