'use strict';

const WebSocket = require('ws');
const Worker = require('./Worker')
const Channel = require('./Channel')
const utils = require('./utils');
const uuidv1 = require('uuid/v1');
const Logger = require('./Logger');
const config = require(process.argv[2]);

const logger = new Logger();
const CHANNEL_FD = 3;
const MaxBitrate = config.maxbitrate;
const StatInternal = config.statinterval;
const StunInternal = config.stuninterval;
process.env.MEDIASOUP_CHANNEL_FD = String(CHANNEL_FD);

let id = uuidv1();
let rooms = {};
let transform = {};

let worker = new Worker(config.minport, config.maxport);
let channel = new Channel(worker.child.stdio[CHANNEL_FD], notify, restart);

function Socket() {
    this.reconnectInterval = 1000;
}
Socket.prototype.open = function (address) {
    this.address = address;
    this.instance = new WebSocket(this.address);
    this.instance.on('close', (code, reason) => {
        switch (code) {
            case 1000:
                break;
            default:
                this.reconnect();
                break;
        }
        this.onclose(code, reason);
    });
    this.instance.on('error', (err) => {
        switch (err.code) {
            case 'ECONNREFUSED':
                this.reconnect();
                break;
            default:
                this.onerror(err);
                break;
        }
    });
    this.instance.on('message', (data) => {
        this.onmessage(data);
    });
    this.instance.on('open', () => {
        this.onopen();
    });
}
Socket.prototype.close = function (code, data) {
    this.instance.close(code, data);
}
Socket.prototype.sendmsg = function (key, data) {
    var value = JSON.stringify(data);
    var msg = key + '=' + value;
    try {
        this.instance.send(msg);
        logger.info('send', msg);
    } catch (err) {
        logger.error(err);
    }

    // logger.info("rooms", rooms);
    // logger.info("transform", transform);
}
Socket.prototype.reconnect = function () {
    this.instance.removeAllListeners();
    var that = this;
    setTimeout(function () {
        that.open(that.address);
    }, this.reconnectInterval);
}

let ws = new Socket();
ws.open('ws://localhost:5003/erizolpc');
ws.onopen = function () {
    let req = {
        erizodid: id,
    };
    this.sendmsg('handshake', req);
}
ws.onerror = function (err) {
    logger.info("onerror", err);
}
ws.onclose = function (code, reason) {
    logger.info("onclose code & error", code + ' ' + reason);
}
ws.onmessage = function (data) {
    logger.info('recv', data);
    if (typeof data == 'string') {
        var index = data.indexOf('=');
        if (index > 0 && index < data.length - 1) {
            var key = data.substring(0, index);
            var value = data.substring(index + 1);
            try {
                var data = JSON.parse(value);
                procmsg(key, data);
            } catch (err) {
                logger.error(err);
            }
        }
    }
}

let connect = false;

function procmsg(key, data) {
    switch (key) {
        case 'handshake-res':
            connect = true;
            break;
        case 'disconnect':
            connect = false;
            ws.close(1000, 'normal');
            break;
        case 'webrtc-offer':
            if (data.connid) {
                sub(data);
            } else {
                pub(data);
            }
            break;
        case 'webrtc-candidate':
            break;
        case 'publish':
            ws.sendmsg('publish-res', {
                roomiid: data.roomiid,
                playerid: data.playerid,
                streamid: data.streamid,
            });
            break;
        case 'unpublish':
            unpub(data);
            ws.sendmsg('unpublish-res', {
                roomiid: data.roomiid,
                playerid: data.playerid,
                streamid: data.streamid,
            });
            break;
        case 'subscribe':
            ws.sendmsg('subscribe-res', {
                roomiid: data.roomiid,
                playerid: data.playerid,
                streamid: data.streamid,
                connid: data.connid,
            });
            break;
        case 'unsubscribe':
            unsub(data)
            ws.sendmsg('unsubscribe-res', {
                roomiid: data.roomiid,
                playerid: data.playerid,
                streamid: data.streamid,
                connid: data.connid,
            });
            break;
        default:
            break;
    }
}

function notify(msg) {
    try {
        if (msg.event == "dtlsstatechange") {
            if (msg.data.dtlsState == "connected") {
                let data = transform[msg.targetId];
                if (data) {
                    let res = {
                        roomiid: data.roomiid,
                        playerid: data.playerid,
                        streamid: data.streamid,
                        connid: data.connid,
                        connected: true,
                    }
                    ws.sendmsg("webrtc-icestate", res);
                }
            }
        }

        if (msg.event == "close") {
            let data = transform[msg.targetId];
            if (data) {
                if (data.connid) {
                    let room = rooms[data.roomiid];
                    if (!room)
                        return
                    let stream = room.streams[data.streamid];
                    if (!stream)
                        return
                    let conn = stream.conns[data.connid];
                    if (!conn)
                        return
                    delete transform[conn.audioConsumerId];
                    delete transform[conn.videoConsumerId];
                    delete transform[conn.transportId];
                    clearInterval(conn.getStat);
                    delete stream.conns[data.connid];
                } else {
                    let room = rooms[data.roomiid];
                    if (!room)
                        return
                    let stream = room.streams[data.streamid];
                    if (!stream)
                        return
                    for (let connid in stream.conns) {
                        let conn = stream.conns[connid];
                        if (!conn)
                            continue
                        delete transform[conn.audioConsumerId];
                        delete transform[conn.videoConsumerId];
                        delete transform[conn.transportId];
                        clearInterval(conn.getStat);
                    }

                    delete transform[stream.audioProducerId];
                    delete transform[stream.videoProducerId];
                    delete transform[stream.transportId];
                    clearInterval(stream.getStat);
                    delete room.streams[data.streamid];
                }

                let res = {
                    roomiid: data.roomiid,
                    playerid: data.playerid,
                    streamid: data.streamid,
                    connid: data.connid
                }
                ws.sendmsg("on-pc-close", res);
            }
        }
    } catch (err) {
        logger.error(err);
    }
}

function restart(msg) {
    for (let roomiid in rooms) {
        let room = rooms[roomiid];
        if (!room)
            continue
        for (let streamid in room.streams) {
            let stream = room.streams[streamid];
            if (!stream)
                continue
            for (let connid in stream.conns) {
                let conn = stream.conns[connid];
                if (!conn)
                    continue
                clearInterval(conn.getStat);
            }
            clearInterval(stream.getStat);
            let data = transform[stream.transportId];
            if (data) {
                let res = {
                    roomiid: data.roomiid,
                    playerid: data.playerid,
                    streamid: data.streamid
                }
                ws.sendmsg("on-pc-close", res);
            }
        }
    }

    logger.info("mediasoup restart");

    rooms = {};
    transform = {};

    worker = new Worker(config.minport, config.maxport);
    channel = new Channel(worker.child.stdio[CHANNEL_FD], notify, restart);
}

async function pub(msg) {
    let pubData = utils.parseSdp(msg.sdp);
    logger.info('pubData', JSON.stringify(pubData));
    msg.sdp = "";

    let routerId = 0;
    let transportId = 0;
    let audioProducerId = 0;
    let videoProducerId = 0;
    let needCreateRouter = false;

    if (!rooms[msg.roomiid]) {
        while (true) {
            routerId = utils.genNumber();
            if (!transform[routerId]) {
                transform[routerId] = true;
                rooms[msg.roomiid] = {
                    routerId: routerId,
                    streams: {}
                };
                needCreateRouter = true;
                break
            }
        }
    } else {
        routerId = rooms[msg.roomiid].routerId;
    }

    while (true) {
        transportId = utils.genNumber();
        if (!transform[transportId]) {
            transform[transportId] = msg;
            break
        }
    }

    while (true) {
        audioProducerId = utils.genNumber();
        if (!transform[audioProducerId]) {
            transform[audioProducerId] = true;
            break
        }
    }

    while (true) {
        videoProducerId = utils.genNumber();
        if (!transform[videoProducerId]) {
            transform[videoProducerId] = true;
            break
        }
    }

    let routerIntr = {
        routerId: routerId
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
        pubAudioCodec: pubData.audio.payloadType,
        rtpParameters: {
            muxId: null,
            codecs: [{
                name: 'opus',
                mimeType: 'audio/opus',
                clockRate: 48000,
                payloadType: pubData.audio.payloadType,
                channels: 2,
                rtcpFeedback: [],
                parameters: {
                    useinbandfec: 1
                }
            }],
            headerExtensions: [{
                uri: 'urn:ietf:params:rtp-hdrext:ssrc-audio-level',
                id: 1
            }],
            encodings: [{
                ssrc: pubData.audio.ssrc
            }],
            rtcp: {
                cname: pubData.cname,
                reducedSize: true,
                mux: true
            }
        },
        rtpMapping: {
            codecPayloadTypes: [
                [pubData.audio.payloadType, pubData.audio.payloadType]
            ],
            headerExtensionIds: [
                [1, 1]
            ]
        },
        paused: false
    }

    let videodata = {
        kind: 'video',
        pubVideoCodec: pubData.video.payloadType,
        pubRtxCodec: pubData.video.rtx.payloadType,
        rtpParameters: {
            muxId: null,
            codecs: [{
                name: 'H264',
                mimeType: 'video/H264',
                clockRate: 90000,
                payloadType: pubData.video.payloadType,
                rtcpFeedback: [{
                    type: 'goog-remb'
                }, {
                    type: 'ccm',
                    parameter: 'fir'
                }, {
                    type: 'nack'
                }, {
                    type: 'nack',
                    parameter: 'pli'
                }],
                parameters: {
                    'packetization-mode': 1
                }
            }],
            headerExtensions: [],
            encodings: [{
                ssrc: pubData.video.ssrc
            }],
            rtcp: {
                cname: pubData.cname,
                reducedSize: true,
                mux: true
            }
        },
        rtpMapping: {
            codecPayloadTypes: [
                [pubData.video.payloadType, pubData.video.payloadType]
            ],
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
            parameters: {
                apt: pubData.video.payloadType
            }
        }
        videodata.rtpParameters.encodings[0].rtx = {
            ssrc: pubData.video.rtx.ssrc
        }
        videodata.rtpMapping.codecPayloadTypes[1] = [pubData.video.rtx.payloadType, pubData.video.rtx.payloadType];

        videodata.rtpParameters.headerExtensions = [{
                uri: 'urn:ietf:params:rtp-hdrext:toffset',
                id: 2
            },
            {
                uri: 'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time',
                id: 3
            },
            {
                uri: 'urn:3gpp:video-orientation',
                id: 4
            }
        ]

        videodata.rtpMapping.headerExtensionIds = [
            [2, 2],
            [3, 3],
            [4, 4]
        ];
    } else {
        videodata.rtpParameters.headerExtensions = [{
                uri: 'urn:ietf:params:rtp-hdrext:toffset',
                id: 5
            },
            {
                uri: 'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time',
                id: 4
            }
        ]

        videodata.rtpMapping.headerExtensionIds = [
            [5, 2],
            [4, 3]
        ];
    }

    if (needCreateRouter) {
        await channel.request("worker.createRouter", routerIntr, {})
    }
    let data = await channel.request("router.createWebRtcTransport", transportIntr, transportData)
    let algorithm = data.dtlsLocalParameters.fingerprints[2].algorithm;
    let value = data.dtlsLocalParameters.fingerprints[2].value;
    let ufrag = data.iceLocalParameters.usernameFragment;
    let pwd = data.iceLocalParameters.password;
    let ip = data.iceLocalCandidates[0].ip;
    let port = data.iceLocalCandidates[0].port;
    let params = {
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
            ssrc: pubData.video.rtx.ssrc,
            payloadType: pubData.video.rtx.payloadType,
        }
    }

    let sdp = utils.encodeSdp(params);

    let maxBitrate = MaxBitrate;
    let temp = msg.maxBitrate;
    if (temp > 0) {
        temp = temp * 1000;
        if (temp < maxBitrate) {
            maxBitrate = temp;
        }
    }
    temp = pubData.audio.bandWidth + pubData.video.bandWidth;
    if (temp > 0) {
        temp = temp * 1000;
        if (temp < maxBitrate) {
            maxBitrate = temp;
        }
    }

    await channel.request("transport.setMaxBitrate", transportIntr, {
        bitrate: maxBitrate
    });
    await channel.request("transport.setRemoteDtlsParameters", transportIntr, dtlsdata);
    if (hasAudio) {
        await channel.request("router.createProducer", audioIntr, audiodata);
    }
    if (hasVideo) {
        await channel.request("router.createProducer", videoIntr, videodata);
    }
    let res = {
        roomiid: msg.roomiid,
        playerid: msg.playerid,
        streamid: msg.streamid,
        sdp: sdp,
        ip: ip,
        port: port
    }

    let start = new Date().getTime();
    let bytes = 0;
    let getStat = setInterval(() => {
        channel.request("transport.getStats", transportIntr, {})
            .then((data) => {
                setWH(msg, data[0].width, data[0].height);
                let now = new Date().getTime();
                let res = {
                    streams: [{
                        roomiid: msg.roomiid,
                        playerid: msg.playerid,
                        streamid: msg.streamid,
                        stat: {
                            bytes: data[0].bytesReceived - bytes,
                            time: parseInt(now / 1000),
                            elapsed: parseInt((now - start) / 1000),
                            duration: StatInternal,
                            height: data[0].height,
                            width: data[0].width
                        }
                    }]
                }
                bytes = data[0].bytesReceived;
                ws.sendmsg("on-pc-stat", res);

                if (data[0].lastStunTimestamp &&
                    data[0].lastRtcpTimestamp &&
                    data[0].lastStunTimestamp + StunInternal < parseInt(now / 1000) &&
                    data[0].lastRtcpTimestamp + StunInternal < parseInt(now / 1000)) {
                    let res = {
                        roomiid: msg.roomiid,
                        playerid: msg.playerid,
                        streamid: msg.streamid
                    }
                    unpub(res);
                    ws.sendmsg("on-pc-close", res);
                }
            })
        if (hasAudio) {
            channel.request("producer.getStats", audioIntr, {});
        }
        if (hasVideo) {
            channel.request("producer.getStats", videoIntr, {});
        }
    }, StatInternal);

    rooms[msg.roomiid].streams[msg.streamid] = {
        audioProducerId: audioProducerId,
        videoProducerId: videoProducerId,
        transportId: transportId,
        pubData: pubData,
        getStat: getStat,
        conns: {}
    }
    ws.sendmsg("webrtc-answer", res);

    logger.info('add pub', JSON.stringify({
        roomiid: msg.roomiid,
        streamid: msg.streamid,
        audioProducerId: audioProducerId,
        videoProducerId: videoProducerId,
        transportId: transportId
    }));
}

async function sub(msg) {
    let subData = utils.parseSdp(msg.sdp);
    logger.info('subData', JSON.stringify(subData));
    msg.sdp = "";

    let transportId = 0;
    let audioConsumerId = 0;
    let videoConsumerId = 0;

    let routerId = rooms[msg.roomiid].routerId;
    let audioProducerId = rooms[msg.roomiid].streams[msg.streamid].audioProducerId;
    let videoProducerId = rooms[msg.roomiid].streams[msg.streamid].videoProducerId;
    let pubData = rooms[msg.roomiid].streams[msg.streamid].pubData;

    while (true) {
        transportId = utils.genNumber();
        if (!transform[transportId]) {
            transform[transportId] = msg;
            break
        }
    }

    while (true) {
        audioConsumerId = utils.genNumber();
        if (!transform[audioConsumerId]) {
            transform[audioConsumerId] = true;
            break
        }
    }

    while (true) {
        videoConsumerId = utils.genNumber();
        if (!transform[videoConsumerId]) {
            transform[videoConsumerId] = true;
            break
        }
    }

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
            codecs: [{
                name: 'opus',
                mimeType: 'audio/opus',
                clockRate: 48000,
                payloadType: subData.audio.payloadType,
                channels: 2,
                rtcpFeedback: [],
                parameters: {
                    useinbandfec: 1
                }
            }],
            headerExtensions: [{
                uri: 'urn:ietf:params:rtp-hdrext:ssrc-audio-level',
                id: 1
            }],
            encodings: [{
                ssrc: pubData.audio.ssrc
            }],
            rtcp: {
                cname: pubData.cname,
                reducedSize: true,
                mux: true
            }
        }
    }

    let enablevideo = {
        rtpParameters: {
            muxId: null,
            codecs: [{
                name: 'H264',
                mimeType: 'video/H264',
                clockRate: 90000,
                payloadType: subData.video.payloadType,
                rtcpFeedback: [{
                    type: 'goog-remb'
                }, {
                    type: 'ccm',
                    parameter: 'fir'
                }, {
                    type: 'nack'
                }, {
                    type: 'nack',
                    parameter: 'pli'
                }],
                parameters: {
                    'packetization-mode': 1
                }
            }],
            headerExtensions: [],
            encodings: [{
                ssrc: pubData.video.ssrc
            }],
            rtcp: {
                cname: pubData.cname,
                reducedSize: true,
                mux: true
            }
        }
    }

    let hasAudio = msg.hasAudio && subData.audio.payloadType;
    let hasVideo = msg.hasVideo && subData.video.payloadType;
    let hasRtx = msg.hasVideo && subData.video.rtx.payloadType && pubData.video.rtx.payloadType;
    let isChrome = msg.hasVideo && subData.video.rtx.payloadType;

    if (hasRtx) {
        enablevideo.rtpParameters.codecs[1] = {
            name: 'rtx',
            mimeType: 'video/rtx',
            clockRate: 90000,
            payloadType: subData.video.rtx.payloadType,
            parameters: {
                apt: subData.video.payloadType
            }
        }
        enablevideo.rtpParameters.encodings[0].rtx = {
            ssrc: pubData.video.rtx.ssrc
        }
    }

    if (isChrome) {
        enablevideo.rtpParameters.headerExtensions = [{
                uri: 'urn:ietf:params:rtp-hdrext:toffset',
                id: 2
            },
            {
                uri: 'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time',
                id: 3
            },
            {
                uri: 'urn:3gpp:video-orientation',
                id: 4
            }
        ]
    } else {
        enablevideo.rtpParameters.headerExtensions = [{
                uri: 'urn:ietf:params:rtp-hdrext:toffset',
                id: 5
            },
            {
                uri: 'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time',
                id: 4
            },
        ]
    }

    if (hasAudio) {
        await channel.request("router.createConsumer", audioIntr, audioData);
    }
    if (hasVideo) {
        await channel.request("router.createConsumer", videoIntr, videoData);
    }
    let data = await channel.request("router.createWebRtcTransport", transportIntr, transportData);
    let algorithm = data.dtlsLocalParameters.fingerprints[2].algorithm;
    let value = data.dtlsLocalParameters.fingerprints[2].value;
    let ufrag = data.iceLocalParameters.usernameFragment;
    let pwd = data.iceLocalParameters.password;
    let ip = data.iceLocalCandidates[0].ip;
    let port = data.iceLocalCandidates[0].port;
    let params = {
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
            streamId: 'transport-' + transportId,
            trackId: 'consumer-audio-' + audioConsumerId,
            payloadType: subData.audio.payloadType,
            mid: subData.audio.mid
        },
        video: {
            ssrc: pubData.video.ssrc,
            streamId: 'transport-' + transportId,
            trackId: 'consumer-video-' + videoConsumerId,
            payloadType: subData.video.payloadType,
            mid: subData.video.mid,
        },
        cname: pubData.cname,
        sessionId: subData.sessionId,
        isPub: false,
        hasAudio: hasAudio,
        hasVideo: hasVideo,
        hasRtx: hasRtx,
        isChrome: isChrome
    }

    if (hasRtx) {
        params.video.rtx = {
            ssrc: pubData.video.rtx.ssrc,
            payloadType: subData.video.rtx.payloadType,
        }
    }

    let sdp = utils.encodeSdp(params);
    await channel.request("transport.setRemoteDtlsParameters", transportIntr, dtlsdata);
    if (hasAudio) {
        await channel.request("consumer.enable", audioIntr, enableaudio);
    }
    if (hasVideo) {
        await channel.request("consumer.enable", videoIntr, enablevideo);
    }
    let res = {
        roomiid: msg.roomiid,
        playerid: msg.playerid,
        streamid: msg.streamid,
        connid: msg.connid,
        sdp: sdp,
        ip: ip,
        port: port
    }

    let start = new Date().getTime();
    let bytes = 0;
    let getStat = setInterval(() => {
        channel.request("transport.getStats", transportIntr, {})
            .then((data) => {
                let wh = getWH(msg);
                if (!wh) {
                    wh = {
                        height: 0,
                        width: 0
                    }
                }
                let now = new Date().getTime();
                let res = {
                    streams: [{
                        roomiid: msg.roomiid,
                        playerid: msg.playerid,
                        streamid: msg.streamid,
                        connid: msg.connid,
                        stat: {
                            bytes: data[0].bytesSent - bytes,
                            time: parseInt(now / 1000),
                            elapsed: parseInt((now - start) / 1000),
                            duration: StatInternal,
                            height: wh.height,
                            width: wh.width
                        }
                    }]
                }
                bytes = data[0].bytesSent;
                ws.sendmsg("on-pc-stat", res);

                if (data[0].lastStunTimestamp &&
                    data[0].lastRtcpTimestamp &&
                    data[0].lastStunTimestamp + StunInternal < parseInt(now / 1000) &&
                    data[0].lastRtcpTimestamp + StunInternal < parseInt(now / 1000)) {
                    let res = {
                        roomiid: msg.roomiid,
                        playerid: msg.playerid,
                        streamid: msg.streamid,
                        connid: msg.connid
                    }
                    unsub(res);
                    ws.sendmsg("on-pc-close", res);
                }
            })
        if (hasAudio) {
            channel.request("consumer.getStats", audioIntr, {});
        }
        if (hasVideo) {
            channel.request("consumer.getStats", videoIntr, {});
        }
    }, StatInternal);

    rooms[msg.roomiid].streams[msg.streamid].conns[msg.connid] = {
        audioConsumerId: audioConsumerId,
        videoConsumerId: videoConsumerId,
        transportId: transportId,
        subData: subData,
        getStat: getStat
    }
    ws.sendmsg("webrtc-answer", res);

    logger.info('add sub', JSON.stringify({
        roomiid: msg.roomiid,
        streamid: msg.streamid,
        connid: msg.connid,
        audioProducerId: audioProducerId,
        videoProducerId: videoProducerId,
        audioConsumerId: audioConsumerId,
        videoConsumerId: videoConsumerId,
        transportId: transportId
    }));
}

function unpub(msg) {
    let room = rooms[msg.roomiid];
    if (!room)
        return
    let stream = room.streams[msg.streamid];
    if (!stream)
        return
    for (let connid in stream.conns) {
        let conn = stream.conns[connid];
        if (!conn)
            continue
        delete transform[conn.audioConsumerId];
        delete transform[conn.videoConsumerId];
        delete transform[conn.transportId];
        clearInterval(conn.getStat);
    }

    delete transform[stream.audioProducerId];
    delete transform[stream.videoProducerId];
    delete transform[stream.transportId];
    clearInterval(stream.getStat);
    delete room.streams[msg.streamid];

    let transportIntr = {
        routerId: room.routerId,
        transportId: stream.transportId
    }
    channel.request("transport.close", transportIntr, {});
}

function unsub(msg) {
    let room = rooms[msg.roomiid];
    if (!room)
        return
    let stream = room.streams[msg.streamid];
    if (!stream)
        return
    let conn = stream.conns[msg.connid];
    if (!conn)
        return
    delete transform[conn.audioConsumerId];
    delete transform[conn.videoConsumerId];
    delete transform[conn.transportId];
    clearInterval(conn.getStat);
    delete stream.conns[msg.connid];

    let transportIntr = {
        routerId: room.routerId,
        transportId: conn.transportId
    }
    channel.request("transport.close", transportIntr, {});
}

function setWH(msg, w, h) {
    let room = rooms[msg.roomiid];
    if (!room)
        return
    let stream = room.streams[msg.streamid];
    if (!stream)
        return
    stream.width = w;
    stream.height = h;
}

function getWH(msg, w, h) {
    let room = rooms[msg.roomiid];
    if (!room)
        return
    let stream = room.streams[msg.streamid];
    if (!stream)
        return
    if (stream.width && stream.width) {
        return {
            width: stream.width,
            height: stream.height
        }
    }
}

process.on('exit', (code) => {
    ws.sendmsg("disconnect", {});
    console.log(`pili-soupd exit：${code}`);
});

process.on('SIGINT', () => {
    console.log('Received SIGINT.');
    process.exit(-1);
});

process.once('SIGTERM', function (code) {
    console.log('Received SIGINT.');
    process.exit(-1);
});