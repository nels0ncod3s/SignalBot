FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY *.js ./
ENV STATE_DIR=/data
VOLUME /data
CMD ["node", "telegram_bot.js"]
