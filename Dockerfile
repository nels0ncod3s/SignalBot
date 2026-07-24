FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY strategy.js telegram_bot.js ./
CMD ["node", "telegram_bot.js"]
