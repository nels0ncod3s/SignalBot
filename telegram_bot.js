const http = require('node:http');
const { loadConfig } = require('./config');
const { MARKETS } = require('./markets');
const { createProviders } = require('./market-data');
const { getCurrentSignal, formatResult } = require('./signals');
const { createAlertState, deliverAlert } = require('./alert-state');
function createTelegram(config, fetchFn = fetch) {
  return async function telegramCall(method, body) {
    // Never log the request URL: it contains the bot token.
    let response;
    try {
      response = await fetchFn(`https://api.telegram.org/bot${config.telegramBotToken}/${method}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(method === 'getUpdates' ? 40000 : 10000),
      });
    } catch { throw new Error('Telegram request failed or timed out'); }
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(`Telegram ${method} rejected request (${data.error_code || response.status})`);
    return data;
  };
}
async function main() {
  const config = loadConfig();
  if (!config.telegramBotToken || !config.telegramChatId) throw new Error('Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID or config.json');
  const telegram = createTelegram(config);
  const providers = createProviders(config);
  const state = createAlertState(config.stateDir);
  const send = text => telegram('sendMessage', { chat_id: config.telegramChatId, text });
  const health = { lastTelegramPoll: null, markets: {} };
  let stopping = false, timer, offset = 0;
  async function lookup(market) {
    if (market.provider === 'oanda' && (!config.oandaApiToken || !config.oandaAccountId)) {
      health.markets[market.symbol] = { checkedAt: Date.now(), status: 'not-configured' };
      return { market, status: 'not-configured' };
    }
    try {
      const result = await getCurrentSignal(market, providers);
      health.markets[market.symbol] = { checkedAt: Date.now(), status: result.status };
      return result;
    } catch (error) {
      console.error(`${market.symbol}: ${error.message}`);
      health.markets[market.symbol] = { checkedAt: Date.now(), status: 'error' };
      return { market, status: 'error' };
    }
  }
  async function check() {
    // Sequential cycles prevent overlapping auto-alert sends. One feed failure never blocks the other.
    for (const market of MARKETS) {
      const result = await lookup(market);
      try { await deliverAlert(result, state, r => send(formatResult(r))); }
      catch (error) { console.error(`${market.symbol} alert: ${error.message}`); }
    }
    if (!stopping) timer = setTimeout(check, 60000);
  }
  async function handleUpdate(update) {
    const message = update.message;
    if (!message?.text || String(message.chat.id) !== String(config.telegramChatId)) return;
    const command = message.text.trim().split(/\s+/)[0].split('@')[0].toLowerCase();
    if (command === '/start' || command === '/help') {
      await telegram('sendMessage', { chat_id: config.telegramChatId, text: 'SignalBot watches BTC/USDT and XAU/USD on 30m candles.\n/signal — both markets\n/btc — Bitcoin\n/gold — Gold\n/status — feed status\nFresh qualifying entries are sent automatically once per market/candle. Alerts may overlap; no orders are placed. Gold needs an OANDA account offering XAU_USD.', reply_markup: { keyboard: [['📊 Get Signal'], ['/btc', '/gold'], ['/status']], resize_keyboard: true } });
    } else if (command === '/status') {
      await send(MARKETS.map(m => `${m.symbol}: ${health.markets[m.symbol]?.status || 'not checked'}${m.provider === 'oanda' && (!config.oandaApiToken || !config.oandaAccountId) ? '\nSet OANDA_API_TOKEN and OANDA_ACCOUNT_ID to enable gold.' : ''}`).join('\n\n'));
    } else if (['/signal', '/btc', '/gold', '/xau'].includes(command) || message.text.trim() === '📊 Get Signal') {
      const selected = command === '/btc' ? MARKETS.slice(0, 1) : ['/gold', '/xau'].includes(command) ? MARKETS.slice(1) : MARKETS;
      for (const market of selected) await send(formatResult(await lookup(market)));
    }
  }
  const server = http.createServer((req, res) => {
    const now = Date.now();
    const healthy = health.lastTelegramPoll !== null && now - health.lastTelegramPoll < 90000 && MARKETS.every(m => {
      const h = health.markets[m.symbol]; return h && !['error', 'not-configured', 'invalid-quote'].includes(h.status) && now - h.checkedAt < 120000;
    });
    // Root preserves existing hosts' liveness checks; /health reports dependency readiness.
    res.writeHead(req.url !== '/health' || healthy ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ healthy, ...health }));
  }).listen(process.env.PORT || 3000, '0.0.0.0');
  function shutdown() { stopping = true; clearTimeout(timer); server.close(); }
  process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
  check().catch(error => { console.error(error.message); shutdown(); process.exitCode = 1; });
  while (!stopping) {
    try {
      const data = await telegram('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] });
      health.lastTelegramPoll = Date.now();
      for (const update of data.result) {
        // Commands are acknowledged after handling; Telegram errors get retried.
        await handleUpdate(update);
        offset = update.update_id + 1;
      }
    } catch (error) {
      console.error(error.message);
      if (!stopping) await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { createTelegram, main };
