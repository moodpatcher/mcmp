FROM node:20-alpine

RUN apk add --no-cache git coreutils

WORKDIR /mcmp

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8080

VOLUME [ "/mcmp" ]

ENTRYPOINT ["/entrypoint.sh"]