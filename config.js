const fs = require('node:fs');
const path = require('node:path');
function loadConfig(env = process.env, file = path.join(__dirname, 'config.json')) {
  const stored = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const config = {
    telegramBotToken: env.TELEGRAM_BOT_TOKEN || stored.telegramBotToken,
    telegramChatId: env.TELEGRAM_CHAT_ID || stored.telegramChatId,
    oandaApiToken: env.OANDA_API_TOKEN || stored.oandaApiToken,
    oandaAccountId: env.OANDA_ACCOUNT_ID || stored.oandaAccountId,
    oandaEnvironment: env.OANDA_ENVIRONMENT || stored.oandaEnvironment || 'practice',
    stateDir: env.STATE_DIR || stored.stateDir || __dirname,
  };
  if (!['practice', 'live'].includes(config.oandaEnvironment)) throw new Error('OANDA_ENVIRONMENT must be practice or live');
  return config;
}
module.exports = { loadConfig };
