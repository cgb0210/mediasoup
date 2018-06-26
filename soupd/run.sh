#!/bin/bash

cd `dirname $0`

ulimit -c unlimited

if [ "`uname -s`" = "Darwin" ]; then
	exec ../node-v8.11.3-darwin-x64/bin/node main.js $*
else
	exec ../node-v8.11.3-linux-x64/bin/node main.js $*
fi
