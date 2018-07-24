'use strict';

const netstring = require('netstring');
const Logger = require('./Logger');

const logger = new Logger();
const REQUEST_TIMEOUT = 5000;

class Channel {
  constructor(socket, notify, restart) {
    this.socket = socket;
    this.notify = notify;
    this.restart = restart;
    this.pendingSent = new Map();
    this.recvBuffer = null;
    this.id = 0;

    this.socket.on('data', (buffer) => {
      if (!this.recvBuffer) {
        this.recvBuffer = buffer;
      } else {
        this.recvBuffer = Buffer.concat([this.recvBuffer, buffer], this.recvBuffer.length + buffer.length);
      }

      while (true) {
        let nsPayload = netstring.nsPayload(this.recvBuffer);
        // Incomplete netstring.
        if (nsPayload === -1) {
          return;
        }

        // We can receive JSON messages (Channel messages) or log strings.
        switch (nsPayload[0]) {
          // 123 = '{' (a Channel JSON messsage).
          case 123:
            this.processMessage(JSON.parse(nsPayload), nsPayload.toString());
            break;

            // 68 = 'D' (a debug log).
          case 68:
            logger.debug(`channel`, nsPayload.toString('utf8', 1));
            break;

            // 87 = 'W' (a warning log).
          case 87:
            logger.warn(`channel`, nsPayload.toString('utf8', 1));
            break;

            // 69 = 'E' (an error log).
          case 69:
            logger.error(`channel`, nsPayload.toString('utf8', 1));
            break;

          default:
            logger.error('channel unexpected data:', nsPayload.toString('utf8'));
        }

        // Remove the read payload from the recvBuffer.
        this.recvBuffer = this.recvBuffer.slice(netstring.nsLength(this.recvBuffer));
      }
    });

    this.socket.on('end', () => {
      logger.error('channel ended by the other side');
    });

    this.socket.on('error', (error) => {
      logger.error('channel error:', error);
      restart();
    });
  }

  request(method, internal, data, reqid) {
    this.id = this.id + 1;

    const id = this.id;
    const request = {
      id,
      method,
      internal,
      data
    };
    const ns = netstring.nsWrite(JSON.stringify(request));

    try {
      this.socket.write(ns);
      logger.info(reqid, JSON.stringify(request));
    } catch (error) {
      return Promise.reject(error);
    }

    return new Promise((pResolve, pReject) => {
      const sent = {
        reqid: reqid,

        resolve: (data2) => {
          if (!this.pendingSent.delete(id)) {
            return;
          }

          clearTimeout(sent.timer);
          pResolve(data2);
        },

        reject: (error) => {
          if (!this.pendingSent.delete(id)) {
            return;
          }

          clearTimeout(sent.timer);
          pReject(error);
        },

        timer: setTimeout(() => {
          if (!this.pendingSent.delete(id)) {
            return;
          }

          pReject(new Error('request timeout'));
        }, REQUEST_TIMEOUT),

        close: () => {
          clearTimeout(sent.timer);
          pReject(new errors.InvalidStateError('Channel closed'));
        }
      };

      // Add sent stuff to the Map.
      this.pendingSent.set(id, sent);
    });
  }

  processMessage(msg, data) {
    if (msg.id) {
      const sent = this.pendingSent.get(msg.id);

      if (!sent) {
        logger.error('received Response does not match any sent Request');
        return;
      }

      logger.info(sent.reqid, data);
      if (msg.accepted)
        sent.resolve(msg.data);
      else if (msg.rejected)
        sent.reject(new Error(msg.reason));
    } else if (msg.targetId && msg.event) {
      this.notify(msg);
    } else {
      logger.error('received message is not a Response nor a Notification');
    }
  }
}

module.exports = Channel;