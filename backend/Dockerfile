FROM node:22-alpine
WORKDIR /app
COPY server.js ./
ENV DATA_DIR=/data PORT=3000 NODE_ENV=production
EXPOSE 3000
USER node
CMD ["node", "server.js"]
