'use strict';

const spawn = require('child_process').spawn;
const Logger = require('./Logger');

const logger = new Logger();

class Worker {
  constructor(rtcMinPort, rtcMaxPort) {
    const workerPath = '../worker/out/Release/mediasoup-worker';
    const spawnArgs = ['wdiawvur#1',
      '--logLevel=debug',
      '--logTag=info',
      '--logTag=ice',
      '--logTag=dtls',
      '--logTag=rtp',
      '--logTag=srtp',
      '--logTag=rtcp',
      '--logTag=rbe',
      '--logTag=rtx',
      '--rtcIPv4=true',
      '--rtcIPv6=true',
      '--rtcMinPort=' + rtcMinPort,
      '--rtcMaxPort=' + rtcMaxPort,
    ]

    const spawnOptions = {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe', 'pipe']
    };

    this.child = spawn(workerPath, spawnArgs, spawnOptions);

    this.child.stdout.on('data', (buffer) => {
      for (const line of buffer.toString('utf8').split('\n')) {
        if (line) {
          logger.debug(`mediasoup-worker's stdout:`, `${line}`);
        }
      }
    });

    this.child.stderr.on('data', (buffer) => {
      for (const line of buffer.toString('utf8').split('\n')) {
        if (line) {
          logger.error(`mediasoup-worker's stderr:`, `${line}`);
        }
      }
    });

    this.child.on('exit', (code, signal) => {
      logger.error('child process exited code & signal:', code + ' ' + signal);
    });

    this.child.on('error', (error) => {
      logger.error('child process error:', error);
    });
  }
}

module.exports = Worker;