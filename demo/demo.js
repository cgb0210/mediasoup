'use strict';

const spawn = require('child_process').spawn;
const netstring = require('netstring');
const transform = require('sdp-transform');
const WebSocket = require('ws');

const CHANNEL_FD = 3;
const REQUEST_TIMEOUT = 5000;
process.env.MEDIASOUP_CHANNEL_FD = String(CHANNEL_FD);

class Channel {
  constructor(socket) {
    this.socket = socket;
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
      // this.emit(msg.targetId, msg.event, msg.data);
    } else {
      console.error('received message is not a Response nor a Notification');
    }
  }
}

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
      '--rtcIPv6=false',
      '--rtcMinPort=10000',
      '--rtcMaxPort=11000',
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

class Server {
  constructor() {
    this.worker = new Worker()
    this.channel = new Channel(this.worker.child.stdio[CHANNEL_FD])
    this.wss = new WebSocket.Server({ port: 5012 });

    var channel = this.channel;
    var pubData = {};
    var subData = {};

    this.wss.on('connection', function connection(ws) {
      ws.on('message', function incoming(message) {
        console.log(message)
        const msg = JSON.parse(message)

        async function pub(msg) {
          try {
            console.log('pub start');

            pubData = parseSdp(msg.data.sdp);
            console.log(JSON.stringify(pubData));

            let routerId = 1;
            let transportId = 2;
            let audioProducerId = 3;
            let videoProducerId = 4;

            let routerIntr = {
              routerId: routerId
            }

            let transportIntr = {
              routerId: routerId,
              transportId: transportId
            }

            let transportData = {
              tcp: false,
              ipv4: '100.100.81.208'
            }

            let dtlsdata = {
              role: 'server',
              fingerprints: [{
                algorithm: pubData.fingerprint.type,
                value: pubData.fingerprint.hash
              }]
            }

            let audioIntr = {
              routerId: routerId,
              transportId: transportId,
              producerId: audioProducerId
            }

            let videoIntr = {
              routerId: routerId,
              transportId: transportId,
              producerId: videoProducerId
            }

            let audiodata = {
              kind: 'audio',
              rtpParameters: {
                muxId: null,
                codecs: [
                  {
                    name: 'opus',
                    mimeType: 'audio/opus',
                    clockRate: 48000,
                    payloadType: pubData.audio.payloadType,
                    channels: 2,
                    rtcpFeedback: [],
                    parameters: { useinbandfec: 1 }
                  }
                ],
                headerExtensions: [
                  { uri: 'urn:ietf:params:rtp-hdrext:ssrc-audio-level', id: 1 }
                ],
                encodings: [{ ssrc: pubData.audio.ssrc }],
                rtcp: { cname: pubData.cname, reducedSize: true, mux: true }
              },
              rtpMapping: {
                codecPayloadTypes: [[pubData.audio.payloadType, pubData.audio.payloadType]],
                headerExtensionIds: [[1, 1]]
              },
              paused: false
            }

            let videodata = {
              kind: 'video',
              rtpParameters: {
                muxId: null,
                codecs: [
                  {
                    name: 'H264',
                    mimeType: 'video/H264',
                    clockRate: 90000,
                    payloadType: pubData.video.payloadType,
                    rtcpFeedback: [{ type: 'goog-remb' }, { type: 'ccm', parameter: 'fir' }, { type: 'nack' }, { type: 'nack', parameter: 'pli' }],
                    parameters: { 'packetization-mode': 1 }
                  }
                ],
                headerExtensions: [],
                encodings: [{ ssrc: pubData.video.ssrc }],
                rtcp: { cname: pubData.cname, reducedSize: true, mux: true }
              },
              rtpMapping: {
                codecPayloadTypes: [[pubData.video.payloadType, pubData.video.payloadType]],
                headerExtensionIds: []
              },
              paused: false
            }

            let hasAudio = msg.hasAudio && pubData.audio.ssrc && pubData.audio.payloadType;
            let hasVideo = msg.hasVideo && pubData.video.ssrc && pubData.video.payloadType;
            let hasRtx = msg.hasVideo && pubData.video.rtx.ssrc && pubData.video.rtx.payloadType;

            if (hasRtx) {
              videodata.rtpParameters.codecs[1] = {
                name: 'rtx',
                mimeType: 'video/rtx',
                clockRate: 90000,
                payloadType: pubData.video.rtx.payloadType,
                parameters: { apt: pubData.video.payloadType }
              }
              videodata.rtpParameters.encodings[0].rtx = { ssrc: pubData.video.rtx.ssrc }
              videodata.rtpMapping.codecPayloadTypes[1] = [pubData.video.rtx.payloadType, pubData.video.rtx.payloadType];

              videodata.rtpParameters.headerExtensions = [
                { uri: 'urn:ietf:params:rtp-hdrext:toffset', id: 2 },
                { uri: 'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time', id: 3 },
                { uri: 'urn:3gpp:video-orientation', id: 4 }
              ]

              videodata.rtpMapping.headerExtensionIds = [[2, 2], [3, 3], [4, 4]];
            }

            await channel.request("worker.createRouter", routerIntr, {});
            let data = await channel.request("router.createWebRtcTransport", transportIntr, transportData);
            var algorithm = data.dtlsLocalParameters.fingerprints[2].algorithm;
            var value = data.dtlsLocalParameters.fingerprints[2].value;
            var ufrag = data.iceLocalParameters.usernameFragment;
            var pwd = data.iceLocalParameters.password;
            var ip = data.iceLocalCandidates[0].ip;
            var port = data.iceLocalCandidates[0].port;
            var params = {
              fingerprint: {
                type: algorithm,
                hash: value
              },
              ice: {
                iceUfrag: ufrag,
                icePwd: pwd
              },
              candidate: {
                ip: ip,
                port: port
              },
              audio: {
                ssrc: pubData.audio.ssrc,
                payloadType: pubData.audio.payloadType,
                mid: pubData.audio.mid
              },
              video: {
                ssrc: pubData.video.ssrc,
                payloadType: pubData.video.payloadType,
                mid: pubData.video.mid
              },
              cname: pubData.cname,
              sessionId: pubData.sessionId,
              isPub: true,
              hasAudio: hasAudio,
              hasVideo: hasVideo,
              hasRtx: hasRtx
            }

            if (hasRtx) {
              params.video.rtx = {
                ssrc: pubData.video.payloadType,
                payloadType: pubData.video.rtx.payloadType,
              }
            }

            var sdp = encodeSdp(params);
            await channel.request("transport.setMaxBitrate", transportIntr, { bitrate: 1200000 });
            await channel.request("transport.setRemoteDtlsParameters", transportIntr, dtlsdata);
            if (hasAudio) {
              await channel.request("router.createProducer", audioIntr, audiodata);
            }
            if (hasVideo) {
              await channel.request("router.createProducer", videoIntr, videodata);
            }
            var pubsdp = {
              op: 'pub',
              type: 'answer',
              sdp: sdp,
            }
            console.log(JSON.stringify(pubsdp))
            ws.send(JSON.stringify(pubsdp));
            setInterval(() => {
              channel.request("transport.getStats", transportIntr, {});
              if (hasAudio) {
                channel.request("producer.getStats", audioIntr, {});
              }
              if (hasVideo) {
                channel.request("producer.getStats", videoIntr, {});
              }
            }, 3000);
            console.log('pub end');
          } catch (err) {
            console.log('pub error', err);
          }
        }

        async function sub1(msg) {
          try {
            console.log('sub1 start');

            subData = parseSdp(msg.data.sdp);
            console.log(JSON.stringify(subData));

            let routerId = 1;
            let audioProducerId = 3;
            let videoProducerId = 4;

            let transportId = 5;
            let audioConsumerId = 6;
            let videoConsumerId = 7;

            let audioIntr = {
              routerId: routerId,
              producerId: audioProducerId,
              consumerId: audioConsumerId,
              transportId: transportId
            }

            let audioData = {
              kind: 'audio',
              pubAudioCodec: pubData.audio.payloadType,
              subAudioCodec: subData.audio.payloadType
            }

            let videoIntr = {
              routerId: routerId,
              producerId: videoProducerId,
              consumerId: videoConsumerId,
              transportId: transportId
            }

            let videoData = {
              kind: 'video',
              pubVideoCodec: pubData.video.payloadType,
              subVideoCodec: subData.video.payloadType,
              pubRtxCodec: pubData.video.rtx.payloadType,
              subRtxCodec: subData.video.rtx.payloadType
            }

            let transportIntr = {
              routerId: routerId,
              transportId: transportId
            }

            let transportData = {
              tcp: false,
              ipv4: msg.ipv4
            }

            let dtlsdata = {
              role: 'server',
              fingerprints: [{
                algorithm: subData.fingerprint.type,
                value: subData.fingerprint.hash
              }]
            }

            let enableaudio = {
              rtpParameters: {
                muxId: null,
                codecs: [
                  {
                    name: 'opus',
                    mimeType: 'audio/opus',
                    clockRate: 48000,
                    payloadType: subData.audio.payloadType,
                    channels: 2,
                    rtcpFeedback: [],
                    parameters: { useinbandfec: 1 }
                  }
                ],
                headerExtensions: [
                  { uri: 'urn:ietf:params:rtp-hdrext:ssrc-audio-level', id: 1 }
                ],
                encodings: [{ ssrc: pubData.audio.ssrc }],
                rtcp: { cname: pubData.cname, reducedSize: true, mux: true }
              }
            }

            let enablevideo = {
              rtpParameters: {
                muxId: null,
                codecs: [
                  {
                    name: 'H264',
                    mimeType: 'video/H264',
                    clockRate: 90000,
                    payloadType: subData.video.payloadType,
                    rtcpFeedback: [{ type: 'goog-remb' }, { type: 'ccm', parameter: 'fir' }, { type: 'nack' }, { type: 'nack', parameter: 'pli' }],
                    parameters: { 'packetization-mode': 1 }
                  }
                ],
                headerExtensions: [],
                encodings: [{ ssrc: pubData.video.ssrc }],
                rtcp: { cname: pubData.cname, reducedSize: true, mux: true }
              }
            }

            let hasAudio = msg.hasAudio && subData.audio.payloadType;
            let hasVideo = msg.hasVideo && subData.video.payloadType;
            let hasRtx = msg.hasVideo && subData.video.rtx.payloadType && pubData.video.rtx.payloadType;

            if (hasRtx) {
              enablevideo.rtpParameters.codecs[1] = {
                name: 'rtx',
                mimeType: 'video/rtx',
                clockRate: 90000,
                payloadType: subData.video.rtx.payloadType,
                parameters: { apt: subData.video.payloadType }
              }
              enablevideo.rtpParameters.encodings[0].rtx = { ssrc: pubData.video.rtx.ssrc }

              enablevideo.rtpParameters.headerExtensions = [
                { uri: 'urn:ietf:params:rtp-hdrext:toffset', id: 2 },
                { uri: 'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time', id: 3 },
                { uri: 'urn:3gpp:video-orientation', id: 4 }
              ]
            }

            if (hasAudio) {
              await channel.request("router.createConsumer", audioIntr, audioData)
            }
            if (hasVideo) {
              await channel.request("router.createConsumer", videoIntr, videoData)
            }
            let data = await channel.request("router.createWebRtcTransport", transportIntr, transportData)
            var algorithm = data.dtlsLocalParameters.fingerprints[2].algorithm;
            var value = data.dtlsLocalParameters.fingerprints[2].value;
            var ufrag = data.iceLocalParameters.usernameFragment;
            var pwd = data.iceLocalParameters.password;
            var ip = data.iceLocalCandidates[0].ip;
            var port = data.iceLocalCandidates[0].port;
            var params = {
              fingerprint: {
                type: algorithm,
                hash: value
              },
              ice: {
                iceUfrag: ufrag,
                icePwd: pwd
              },
              candidate: {
                ip: ip,
                port: port
              },
              audio: {
                ssrc: pubData.audio.ssrc,
                streamId: 'transport-'+transportId,
                trackId: 'consumer-audio-'+audioConsumerId,
                payloadType: subData.audio.payloadType,
                mid: subData.audio.mid
              },
              video: {
                ssrc: pubData.video.ssrc,
                streamId: 'transport-'+transportId,
                trackId: 'consumer-video-'+videoConsumerId,
                payloadType: subData.video.payloadType,
                mid: subData.video.mid,
              },
              cname: pubData.cname,
              sessionId: subData.sessionId,
              isPub: false,
              hasAudio: hasAudio,
              hasVideo: hasVideo,
              hasRtx: hasRtx
            }

            if (hasRtx) {
              params.video.rtx = {
                ssrc: pubData.video.rtx.ssrc,
                payloadType: subData.video.rtx.payloadType,
              }
            }

            var sdp = encodeSdp(params);
            await channel.request("transport.setRemoteDtlsParameters", transportIntr, dtlsdata)
            if (hasAudio) {
              await channel.request("consumer.enable", audioIntr, enableaudio)
            }
            if (hasVideo) {
              await channel.request("consumer.enable", videoIntr, enablevideo)
            }
            var subsdp = {
              op: 'sub1',
              type: 'answer',
              sdp: sdp,
            }
            console.log(JSON.stringify(subsdp))
            ws.send(JSON.stringify(subsdp));
            setInterval(() => {
              channel.request("transport.getStats", transportIntr, {});
              if (hasAudio) {
                channel.request("consumer.getStats", audioIntr, {});
              }
              if (hasVideo) {
                channel.request("consumer.getStats", videoIntr, {});
              }
            }, 3000);
            console.log('sub1 end');
          } catch (err) {
            console.log('sub1 error', err);
          }
        }

        async function sub2(msg) {
          try {
            console.log('sub2 start');

            subData = parseSdp(msg.data.sdp);
            console.log(JSON.stringify(subData));

            let routerId = 1;
            let audioProducerId = 3;
            let videoProducerId = 4;

            let transportId = 8;
            let audioConsumerId = 9;
            let videoConsumerId = 10;

            let audioIntr = {
              routerId: routerId,
              producerId: audioProducerId,
              consumerId: audioConsumerId,
              transportId: transportId
            }

            let audioData = {
              kind: 'audio',
              pubAudioCodec: pubData.audio.payloadType,
              subAudioCodec: subData.audio.payloadType
            }

            let videoIntr = {
              routerId: routerId,
              producerId: videoProducerId,
              consumerId: videoConsumerId,
              transportId: transportId
            }

            let videoData = {
              kind: 'video',
              pubVideoCodec: pubData.video.payloadType,
              subVideoCodec: subData.video.payloadType,
              pubRtxCodec: pubData.video.rtx.payloadType,
              subRtxCodec: subData.video.rtx.payloadType
            }

            let transportIntr = {
              routerId: routerId,
              transportId: transportId
            }

            let transportData = {
              tcp: false,
              ipv4: msg.ipv4
            }

            let dtlsdata = {
              role: 'server',
              fingerprints: [{
                algorithm: subData.fingerprint.type,
                value: subData.fingerprint.hash
              }]
            }

            let enableaudio = {
              rtpParameters: {
                muxId: null,
                codecs: [
                  {
                    name: 'opus',
                    mimeType: 'audio/opus',
                    clockRate: 48000,
                    payloadType: subData.audio.payloadType,
                    channels: 2,
                    rtcpFeedback: [],
                    parameters: { useinbandfec: 1 }
                  }
                ],
                headerExtensions: [
                  { uri: 'urn:ietf:params:rtp-hdrext:ssrc-audio-level', id: 1 }
                ],
                encodings: [{ ssrc: pubData.audio.ssrc }],
                rtcp: { cname: pubData.cname, reducedSize: true, mux: true }
              }
            }

            let enablevideo = {
              rtpParameters: {
                muxId: null,
                codecs: [
                  {
                    name: 'H264',
                    mimeType: 'video/H264',
                    clockRate: 90000,
                    payloadType: subData.video.payloadType,
                    rtcpFeedback: [{ type: 'goog-remb' }, { type: 'ccm', parameter: 'fir' }, { type: 'nack' }, { type: 'nack', parameter: 'pli' }],
                    parameters: { 'packetization-mode': 1 }
                  }
                ],
                headerExtensions: [],
                encodings: [{ ssrc: pubData.video.ssrc }],
                rtcp: { cname: pubData.cname, reducedSize: true, mux: true }
              }
            }

            let hasAudio = msg.hasAudio && subData.audio.payloadType;
            let hasVideo = msg.hasVideo && subData.video.payloadType;
            let hasRtx = msg.hasVideo && subData.video.rtx.payloadType && pubData.video.rtx.payloadType;

            if (hasRtx) {
              enablevideo.rtpParameters.codecs[1] = {
                name: 'rtx',
                mimeType: 'video/rtx',
                clockRate: 90000,
                payloadType: subData.video.rtx.payloadType,
                parameters: { apt: subData.video.payloadType }
              }
              enablevideo.rtpParameters.encodings[0].rtx = { ssrc: pubData.video.rtx.ssrc }

              enablevideo.rtpParameters.headerExtensions = [
                { uri: 'urn:ietf:params:rtp-hdrext:toffset', id: 2 },
                { uri: 'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time', id: 3 },
                { uri: 'urn:3gpp:video-orientation', id: 4 }
              ]
            }

            if (hasAudio) {
              await channel.request("router.createConsumer", audioIntr, audioData)
            }
            if (hasVideo) {
              await channel.request("router.createConsumer", videoIntr, videoData)
            }
            let data = await channel.request("router.createWebRtcTransport", transportIntr, transportData)
            var algorithm = data.dtlsLocalParameters.fingerprints[2].algorithm;
            var value = data.dtlsLocalParameters.fingerprints[2].value;
            var ufrag = data.iceLocalParameters.usernameFragment;
            var pwd = data.iceLocalParameters.password;
            var ip = data.iceLocalCandidates[0].ip;
            var port = data.iceLocalCandidates[0].port;
            var params = {
              fingerprint: {
                type: algorithm,
                hash: value
              },
              ice: {
                iceUfrag: ufrag,
                icePwd: pwd
              },
              candidate: {
                ip: ip,
                port: port
              },
              audio: {
                ssrc: pubData.audio.ssrc,
                streamId: 'transport-'+transportId,
                trackId: 'consumer-audio-'+audioConsumerId,
                payloadType: subData.audio.payloadType,
                mid: subData.audio.mid
              },
              video: {
                ssrc: pubData.video.ssrc,
                streamId: 'transport-'+transportId,
                trackId: 'consumer-video-'+videoConsumerId,
                payloadType: subData.video.payloadType,
                mid: subData.video.mid,
              },
              cname: pubData.cname,
              sessionId: subData.sessionId,
              isPub: false,
              hasAudio: hasAudio,
              hasVideo: hasVideo,
              hasRtx: hasRtx
            }

            if (hasRtx) {
              params.video.rtx = {
                ssrc: pubData.video.rtx.ssrc,
                payloadType: subData.video.rtx.payloadType,
              }
            }

            var sdp = encodeSdp(params);
            await channel.request("transport.setRemoteDtlsParameters", transportIntr, dtlsdata)
            if (hasAudio) {
              await channel.request("consumer.enable", audioIntr, enableaudio)
            }
            if (hasVideo) {
              await channel.request("consumer.enable", videoIntr, enablevideo)
            }
            var subsdp = {
              op: 'sub2',
              type: 'answer',
              sdp: sdp,
            }
            console.log(JSON.stringify(subsdp))
            ws.send(JSON.stringify(subsdp));
            setInterval(() => {
              channel.request("transport.getStats", transportIntr, {});
              if (hasAudio) {
                channel.request("consumer.getStats", audioIntr, {});
              }
              if (hasVideo) {
                channel.request("consumer.getStats", videoIntr, {});
              }
            }, 3000);
            console.log('sub2 end');
          } catch (err) {
            console.log('sub2 error', err);
          }
        }

        switch (msg.type) {
          case 'pub':
            pub(msg);
            break;
          case 'unpub':
            break;
          case 'sub1':
            sub1(msg);
            break;
          case 'unsub1':
            break;
          case 'sub2':
            sub2(msg);
            break;
          case 'unsub2':
            break;
        }
      });
    });
  }
}

new Server();

let sdpTemplate = {
  version: 0,
  origin: {
    username: "mediasoup-client",
    sessionId: 0,
    sessionVersion: 2,
    netType: "IN",
    ipVer: 4,
    address: "0.0.0.0"
  },
  name: "-",
  timing: {
    start: 0,
    stop: 0
  },
  icelite: "ice-lite",
  fingerprint: {
    type: "",
    hash: ""
  },
  msidSemantic: {
    semantic: "WMS",
    token: "*"
  },
  groups: [
    {
      type: "BUNDLE",
      mids: ""
    }
  ],
  media: [
    {
      rtp: [
        {
          payload: 0,
          codec: "opus",
          rate: 48000,
          encoding: 2
        }
      ],
      fmtp: [
        {
          payload: 0,
          config: "useinbandfec=1"
        }
      ],
      type: "audio",
      port: 7,
      protocol: "RTP/SAVPF",
      payloads: '',
      connection: {
        version: 4,
        ip: "127.0.0.1"
      },
      ext: [
        {
          value: 1,
          uri: "urn:ietf:params:rtp-hdrext:ssrc-audio-level"
        }
      ],
      setup: "active",
      mid: "",
      direction: "",
      iceUfrag: "",
      icePwd: "",
      candidates: [
        {
          foundation: "udpcandidate",
          component: 1,
          transport: "udp",
          priority: 1078862079,
          ip: "",
          port: 0,
          type: "host"
        }
      ],
      endOfCandidates: "end-of-candidates",
      iceOptions: "renomination",
      ssrcs: [
        {
          id: 0,
          attribute: "msid",
          value: ""
        },
        {
          id: 0,
          attribute: "mslabel",
          value: ""
        },
        {
          id: 0,
          attribute: "label",
          value: ""
        },
        {
          id: 0,
          attribute: "cname",
          value: ""
        }
      ],
      rtcpMux: "rtcp-mux",
      rtcpRsize: "rtcp-rsize"
    },
    {
      rtp: [
        {
          payload: 0,
          codec: "H264",
          rate: 90000
        },
        {
          payload: 0,
          codec: "rtx",
          rate: 90000
        }
      ],
      fmtp: [
        {
          payload: 0,
          config: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f"
        },
        {
          payload: 0,
          config: ""
        }
      ],
      type: "video",
      port: 7,
      protocol: "RTP/SAVPF",
      payloads: "",
      connection: {
        version: 4,
        ip: "127.0.0.1"
      },
      rtcpFb: [
        {
          payload: 0,
          type: "goog-remb",
          subtype: ""
        },
        {
          payload: 0,
          type: "ccm",
          subtype: "fir"
        },
        {
          payload: 0,
          type: "nack",
          subtype: ""
        },
        {
          payload: 0,
          type: "nack",
          subtype: "pli"
        }
      ],
      ext: [
        {
          value: 2,
          uri: "urn:ietf:params:rtp-hdrext:toffset"
        },
        {
          value: 3,
          uri: "http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time"
        },
        {
          value: 4,
          uri: "urn:3gpp:video-orientation"
        }
      ],
      setup: "active",
      mid: "",
      direction: "",
      iceUfrag: "",
      icePwd: "",
      candidates: [
        {
          foundation: "udpcandidate",
          component: 1,
          transport: "udp",
          priority: 1078862079,
          ip: "",
          port: 0,
          type: "host"
        }
      ],
      endOfCandidates: "end-of-candidates",
      iceOptions: "renomination",
      ssrcs: [
        {
          id: 0,
          attribute: "msid",
          value: ""
        },
        {
          id: 0,
          attribute: "mslabel",
          value: ""
        },
        {
          id: 0,
          attribute: "label",
          value: ""
        },
        {
          id: 0,
          attribute: "cname",
          value: ""
        },
        {
          id: 0,
          attribute: "msid",
          value: ""
        },
        {
          id: 0,
          attribute: "mslabel",
          value: ""
        },
        {
          id: 0,
          attribute: "label",
          value: ""
        },
        {
          id: 0,
          attribute: "cname",
          value: ""
        }
      ],
      ssrcGroups: [
        {
          semantics: "FID",
          ssrcs: ""
        }
      ],
      rtcpMux: "rtcp-mux",
      rtcpRsize: "rtcp-rsize"
    }
  ]
}

function parseSdp(sdpStr) {
  let sdp = transform.parse(sdpStr);
  console.log(JSON.stringify(sdp))
  let res = {
    fingerprint: {
      type: '',
      hash: ''
    },
    audio: {
      ssrc: '',
      payloadType: 0,
      mid: '',
      streamId: '',
      trackId: ''
    },
    video: {
      ssrc: '',
      payloadType: 0,
      mid: '',
      streamId: '',
      trackId: '',
      rtx: {
        ssrc: '',
        payloadType: 0,
      }
    },
    cname: '',
    sessionId: 0
  }
  res.sessionId = sdp.origin.sessionId;
  if (sdp.fingerprint) {
    res.fingerprint.type = sdp.fingerprint.type;
    res.fingerprint.hash = sdp.fingerprint.hash;
  } else {
    res.fingerprint.type = sdp.media[0].fingerprint.type;
    res.fingerprint.hash = sdp.media[0].fingerprint.hash;
  }
  for (let media of sdp.media) {
    switch (media.type) {
      case 'audio':
        res.audio.mid = media.mid;
        for (let rtp of media.rtp) {
          if (rtp.codec == 'opus') {
            res.audio.payloadType = rtp.payload;
            break;
          }
        }
        if (media.ssrcs) {
          for (let ssrc of media.ssrcs) {
            if (ssrc.attribute == 'cname') {
              res.cname = ssrc.value;
              res.audio.ssrc = ssrc.id;
            }
            if (ssrc.attribute == 'msid') {
              let msid = ssrc.value.split(' ');
              res.audio.streamId = msid[0];
              res.audio.trackId = msid[1];
            }
          }
        }
        if (media.msid) {
          let msid = media.msid.split(' ');
          res.audio.streamId = msid[0];
          res.audio.trackId = msid[1];
        }

        break;
      case 'video':
        res.video.mid = media.mid;
        for (let rtp of media.rtp) {
          if (rtp.codec == 'H264') {
            res.video.payloadType = rtp.payload;
            for (let fmtp of media.fmtp) {
              if (fmtp.config == 'apt=' + rtp.payload) {
                res.video.rtx.payloadType = fmtp.payload;
                break;
              }
            }
            break;
          }
        }
        if (media.ssrcs) {
          for (let ssrc of media.ssrcs) {
            if (ssrc.attribute == 'cname') {
              res.cname = ssrc.value;
              if (res.video.ssrc) {
                res.video.rtx.ssrc = ssrc.id;
              } else {
                res.video.ssrc = ssrc.id;
              }
            }
            if (ssrc.attribute == 'msid') {
              let msid = ssrc.value.split(' ');
              res.video.streamId = msid[0];
              res.video.trackId = msid[1];
            }
          }
        }
        if (media.msid) {
          let msid = media.msid.split(' ');
          res.video.streamId = msid[0];
          res.video.trackId = msid[1];
        }
        break;
    }
  }
  return res
}

function encodeSdp(params) {
  console.log(JSON.stringify(params));
  let sdp = JSON.parse(JSON.stringify(sdpTemplate));

  sdp.origin.sessionId = params.sessionId;
  sdp.fingerprint.type = params.fingerprint.type;
  sdp.fingerprint.hash = params.fingerprint.hash;

  if (params.hasAudio && params.hasVideo) {
    sdp.groups[0].mids = params.audio.mid + ' ' + params.video.mid;
    sdp.media[0].mid = params.audio.mid;
    sdp.media[1].mid = params.video.mid;
  } else {
    if (params.hasAudio) {
      sdp.groups[0].mids = params.audio.mid;
      sdp.media[0].mid = params.audio.mid;
    }
    if (params.hasVideo) {
      sdp.groups[0].mids = params.video.mid;
      sdp.media[1].mid = params.video.mid;
    }
  }

  if (params.hasAudio) {
    let media = sdp.media[0];
    if (params.isPub) {
      media.direction = 'recvonly';
    } else {
      media.direction = 'sendonly';
    }
    media.rtp[0].payload = params.audio.payloadType;
    media.fmtp[0].payload = params.audio.payloadType;
    media.payloads = params.audio.payloadType;
    media.iceUfrag = params.ice.iceUfrag;
    media.icePwd = params.ice.icePwd;
    media.candidates[0].ip = params.candidate.ip;
    media.candidates[0].port = params.candidate.port;
    if (params.isPub) {
      delete media.ssrcs;
    } else {
      media.ssrcs[0].id = params.audio.ssrc;
      media.ssrcs[0].value = params.audio.streamId + ' ' + params.audio.trackId;
      media.ssrcs[1].id = params.audio.ssrc;
      media.ssrcs[1].value = params.audio.streamId;
      media.ssrcs[2].id = params.audio.ssrc;
      media.ssrcs[2].value = params.audio.trackId;
      media.ssrcs[3].id = params.audio.ssrc;
      media.ssrcs[3].value = params.cname;
    }
  }

  if (params.hasVideo) {
    if (params.hasRtx) {
      let media = sdp.media[1];
      if (params.isPub) {
        media.direction = 'recvonly';
      } else {
        media.direction = 'sendonly';
      }
      media.rtp[0].payload = params.video.payloadType;
      media.rtp[1].payload = params.video.rtx.payloadType;
      media.fmtp[0].payload = params.video.payloadType;
      media.fmtp[1].payload = params.video.rtx.payloadType;
      media.fmtp[1].config = 'apt=' + params.video.payloadType;
      media.payloads = params.video.payloadType + ' ' + params.video.rtx.payloadType;
      media.rtcpFb[0].payload = params.video.payloadType;
      media.rtcpFb[1].payload = params.video.payloadType;
      media.rtcpFb[2].payload = params.video.payloadType;
      media.rtcpFb[3].payload = params.video.payloadType;
      media.iceUfrag = params.ice.iceUfrag;
      media.icePwd = params.ice.icePwd;
      media.candidates[0].ip = params.candidate.ip;
      media.candidates[0].port = params.candidate.port;
      if (params.isPub) {
        delete media.ssrcs;
        delete media.ssrcGroups;
      } else {
        media.ssrcs[0].id = params.video.ssrc;
        media.ssrcs[0].value = params.video.streamId + ' ' + params.video.trackId;
        media.ssrcs[1].id = params.video.ssrc;
        media.ssrcs[1].value = params.video.streamId;
        media.ssrcs[2].id = params.video.ssrc;
        media.ssrcs[2].value = params.video.trackId;
        media.ssrcs[3].id = params.video.ssrc;
        media.ssrcs[3].value = params.cname;
        media.ssrcs[4].id = params.video.rtx.ssrc;
        media.ssrcs[4].value = params.video.streamId + ' ' + params.video.trackId;
        media.ssrcs[5].id = params.video.rtx.ssrc;
        media.ssrcs[5].value = params.video.streamId;
        media.ssrcs[6].id = params.video.rtx.ssrc;
        media.ssrcs[6].value = params.video.trackId;
        media.ssrcs[7].id = params.video.rtx.ssrc;
        media.ssrcs[7].value = params.cname;
        media.ssrcGroups[0].ssrcs = params.video.ssrc + ' ' + params.video.rtx.ssrc;
      }
    } else {
      let media = sdp.media[1];
      if (params.isPub) {
        media.direction = 'recvonly';
      } else {
        media.direction = 'sendonly';
      }

      media.rtp = [media.rtp[0]];
      media.fmtp = [media.fmtp[0]];
      media.ssrcs = [media.ssrcs[0], media.ssrcs[1], media.ssrcs[2], media.ssrcs[3]];
      delete media.ssrcGroups;
      delete media.ext;

      media.rtp[0].payload = params.video.payloadType;
      media.fmtp[0].payload = params.video.payloadType;
      media.payloads = params.video.payloadType;
      media.rtcpFb[0].payload = params.video.payloadType;
      media.rtcpFb[1].payload = params.video.payloadType;
      media.rtcpFb[2].payload = params.video.payloadType;
      media.rtcpFb[3].payload = params.video.payloadType;
      media.iceUfrag = params.ice.iceUfrag;
      media.icePwd = params.ice.icePwd;
      media.candidates[0].ip = params.candidate.ip;
      media.candidates[0].port = params.candidate.port;
      if (params.isPub) {
        delete media.ssrcs;
        delete media.ssrcGroups;
      } else {
        media.ssrcs[0].id = params.video.ssrc;
        media.ssrcs[0].value = params.video.streamId + ' ' + params.video.trackId;
        media.ssrcs[1].id = params.video.ssrc;
        media.ssrcs[1].value = params.video.streamId;
        media.ssrcs[2].id = params.video.ssrc;
        media.ssrcs[2].value = params.video.trackId;
        media.ssrcs[3].id = params.video.ssrc;
        media.ssrcs[3].value = params.cname;
      }
    }
  }
  if (!params.hasAudio) {
    sdp.media = [sdp.media[1]];
  }

  if (!params.hasVideo) {
    sdp.media = [sdp.media[0]];
  }

  console.log(JSON.stringify(sdp));

  let sdpStr = transform.write(sdp);
  return sdpStr
}