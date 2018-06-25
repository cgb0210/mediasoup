'use strict';

const spawn = require('child_process').spawn;

class Worker {
  constructor() {
    const workerPath = './worker/out/Release/mediasoup-worker';
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
      '--rtcMinPort=10000',
      '--rtcMaxPort=20000',
    ]

    const spawnOptions = {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe', 'pipe']
    };

    this.child = spawn(workerPath, spawnArgs, spawnOptions);

    this.child.stdout.on('data', (buffer) => {
      for (const line of buffer.toString('utf8').split('\n')) {
        if (line) {
          console.debug(`mediasoup-worker's stdout: ${line}`);
        }
      }
    });

    this.child.stderr.on('data', (buffer) => {
      for (const line of buffer.toString('utf8').split('\n')) {
        if (line) {
          console.error(`mediasoup-worker's stderr: ${line}`);
        }
      }
    });

    this.child.on('exit', (code, signal) => {
      console.error('child process exited [code:%s, signal:%s]', code, signal);
    });

    this.child.on('error', (error) => {
      console.error('child process error [error:%s]', error);
    });
  }
}

module.exports = Worker;