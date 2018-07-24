module.exports = {
    outgoing: {
        pong: 'pongMessage',
        initialized: 'initialized',
        started: 'started',
        stopped: 'stopped',
        progress: 'progress',
        error: 'errorMessage',
        startSubPipeline: 'startSubPipeline',
        done: 'done'

    },
    incomming: {
        ping: 'pingMessage',
        initialize: 'initialize',
        start: 'start',
        cleanup: 'cleanup',
        stop: 'stop',
        exit: 'exit',
        startedSubPipline: 'startedSubPipline',
        error: 'errorMessage',
        done: 'done'
    }
}