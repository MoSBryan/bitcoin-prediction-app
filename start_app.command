#!/bin/zsh
cd "/Users/cheungbryan/Documents/New project" || exit 1
python3 server.py &
SERVER_PID=$!
sleep 1
open "http://127.0.0.1:8080"
wait $SERVER_PID
