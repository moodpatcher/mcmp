#!/bin/bash

docker rm -f mcmp

docker run -d --name mcmp \
    -p 8080:8080/tcp \
    -v $PWD/mcmp:/opt/mcmp \
    --restart always \
    node:latest \
    bash -c '
      apt update && apt install -y tmux iputils-ping iproute2 tcpdump && tmux new -d -s mcmp "cd /opt/mcmp && npm install && npm run dev" && tail -f /dev/null;
    '