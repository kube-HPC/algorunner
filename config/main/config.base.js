const packageJson = require(process.cwd() + '/package.json');
const config = module.exports = {};

config.serviceName = packageJson.name;

config.workerCommunication = {
    adapterName: 'socket',
    config: {
        connection: {
            port: process.env.WORKER_SOCKET_PORT || 3000,
            host: process.env.WORKER_SOCKET_HOST || "localhost",
            // optional url. If provided ignores the above host and port
            url: process.env.WORKER_SOCKET_URL || ''
        }
    }
};
