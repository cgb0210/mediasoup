'use strict';

const moment = require('moment');

class Logger {
	debug(tag, msg) {
		console.log(moment(Date.now()).format('YYYY/MM/DD HH:mm:ss.SSSSSS'), `[DEBUG]`, tag, msg);
	}

	info(tag, msg) {
		console.log(moment(Date.now()).format('YYYY/MM/DD HH:mm:ss.SSSSSS'), `[INFO]`, tag, msg);
	}

	warn(tag, msg) {
		console.log(moment(Date.now()).format('YYYY/MM/DD HH:mm:ss.SSSSSS'), `[WARN]`, tag, msg);
	}

	error(tag, msg) {
		console.log(moment(Date.now()).format('YYYY/MM/DD HH:mm:ss.SSSSSS'), `[ERROR]`, tag, msg);
	}
}

module.exports = Logger;