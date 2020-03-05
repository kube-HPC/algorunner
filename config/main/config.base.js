const packageJson = require(process.cwd() + '/package.json');
const config = module.exports = {};

config.serviceName = packageJson.name;
config.adapter = process.env.WORKER_ALGORITHM_PROTOCOL || 'ws';
config.maxPayload = process.env.WORKER_SOCKET_MAX_PAYLOAD_BYTES;
config.storage = process.env.STORAGE_MODE || 'byRaw';

config.socket = {
    port: process.env.WORKER_SOCKET_PORT || 3000,
    host: process.env.WORKER_SOCKET_HOST || 'localhost',
    protocol: process.env.WORKER_SOCKET_PROTOCOL || 'ws',
    url: process.env.WORKER_SOCKET_URL || null,
    encoding: process.env.WORKER_ENCODING || 'bson'
};
