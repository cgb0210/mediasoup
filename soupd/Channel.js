'use strict';

const netstring = require('netstring');
const REQUEST_TIMEOUT = 5000;

class Channel {
  constructor(socket, notify) {
    this.socket = socket;
    this.notify = notify;
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
            this.processMessage(JSON.parse(nsPayload));
            console.log('<<---', nsPayload.toString());
            break;

          // 68 = 'D' (a debug log).
          case 68:
            console.debug(nsPayload.toString('utf8', 0));
            break;

          // 87 = 'W' (a warning log).
          case 87:
            console.warn(nsPayload.toString('utf8', 0));
            break;

          // 69 = 'E' (an error log).
          case 69:
            console.error(nsPayload.toString('utf8', 0));
            break;

          default:
            console.error('unexpected data: %s', nsPayload.toString('utf8'));
        }

        // Remove the read payload from the recvBuffer.
        this.recvBuffer = this.recvBuffer.slice(netstring.nsLength(this.recvBuffer));
      }
    });

    this.socket.on('end', () => {
      console.debug('channel ended by the other side');
    });

    this.socket.on('error', (error) => {
      console.error('channel error: %s', error);
    });
  }

  request(method, internal, data) {
    this.id = this.id + 1;

    const id = this.id;
    const request = { id, method, internal, data };
    const ns = netstring.nsWrite(JSON.stringify(request));

    try {
      this.socket.write(ns);
      console.log('--->>', ns.toString());
    } catch (error) {
      return Promise.reject(error);
    }

    return new Promise((pResolve, pReject) => {
      const sent =
      {
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

  processMessage(msg) {
    if (msg.id) {
      // if (msg.accepted)
      //     console.debug('request succeeded [id:%s]', msg.id);
      // else
      //     console.error('request failed [id:%s, reason:"%s"]', msg.id, msg.reason);

      const sent = this.pendingSent.get(msg.id);

      if (!sent) {
        console.error('received Response does not match any sent Request');
        return;
      }

      if (msg.accepted)
        sent.resolve(msg.data);
      else if (msg.rejected)
        sent.reject(new Error(msg.reason));
    } else if (msg.targetId && msg.event) {
      this.notify(msg);
    } else {
      console.error('received message is not a Response nor a Notification');
    }
  }
}

module.exports = Channel;