const packageJson = require(process.cwd() + '/package.json');
const config = module.exports = {};

config.serviceName = packageJson.name;

config.workerCommunication = {
    adapterName: process.env.WORKER_ALGORITHM_PROTOCOL || 'socket',
    config: {
        connection: {
            port: process.env.WORKER_SOCKET_PORT || 3000,
            host: process.env.WORKER_SOCKET_HOST || 'localhost',
            url: process.env.WORKER_SOCKET_URL || null
        }
    }
};
