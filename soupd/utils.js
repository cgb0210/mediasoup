'use strict';

const transform = require('sdp-transform');
const randomNumber = require('random-number');

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
                    config: "packetization-mode=1"
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
    }

    if (!params.hasAudio) {
        sdp.media = [sdp.media[1]];
    }

    if (!params.hasVideo) {
        sdp.media = [sdp.media[0]];
    }

    let sdpStr = transform.write(sdp);
    return sdpStr
}

const genNumber = randomNumber.generator(
    {
        min: 10000000,
        max: 99999999,
        integer: true
    });

exports.parseSdp = parseSdp;
exports.encodeSdp = encodeSdp;
exports.genNumber = genNumber;