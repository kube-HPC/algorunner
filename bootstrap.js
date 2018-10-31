const configIt = require('@hkube/config');
const componentName = require('./lib/consts/componentNames');
const algorunner = require('./lib/algorunner');

const modules = [
    './lib/workerCommunication/workerCommunication.js'
];

class Bootstrap {
    async init() {
        try {
            const { main } = configIt.load();
            this._handleErrors();

            await Promise.all(modules.map(m => require(m).init(main)));
            await algorunner.init(main);
            return main;
        }
        catch (error) {
            this._onInitFailed(new Error(`unable to start application. ${error.message}`));
        }
    }

    _onInitFailed(error) {
        console.error(error.message);
        console.error(error);
        process.exit(1);
    }

    _handleErrors() {
        process.on('exit', (code) => {
            console.info('exit' + (code ? ' code ' + code : ''), { component: componentName.MAIN });
        });
        process.on('SIGINT', () => {
            console.info('SIGINT', { component: componentName.MAIN });
            process.exit(1);
        });
        process.on('SIGTERM', () => {
            console.info('SIGTERM', { component: componentName.MAIN });
            process.exit(1);
        });
        process.on('unhandledRejection', (error) => {
            console.error('unhandledRejection: ' + error.message, { component: componentName.MAIN }, error);
        });
        process.on('uncaughtException', (error) => {
            console.error('uncaughtException: ' + error.message, { component: componentName.MAIN }, error);
            process.exit(1);
        });
    }
}

module.exports = new Bootstrap();

