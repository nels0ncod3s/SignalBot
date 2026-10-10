const fs = require('node:fs');
const path = require('node:path');
function createAlertState(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'alert_state.json');
  let state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  // Migrate the old BTC-only state without repeating its last alert.
  state = state.sent || { 'BTC/USDT:30m': state.lastAlertedCandleTime ?? null };
  if (!state || typeof state !== 'object' || Array.isArray(state) || Object.values(state).some(v => v !== null && !Number.isFinite(v))) throw new Error('Invalid alert state');
  return {
    has(key, timestamp) { return Number.isFinite(state[key]) && state[key] >= timestamp; },
    mark(key, timestamp) {
      const next = { ...state, [key]: timestamp };
      const temporary = `${file}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify({ version: 2, sent: next }));
      fs.renameSync(temporary, file);
      state = next;
    },
  };
}
async function deliverAlert(result, state, send, now = Date.now()) {
  const key = `${result.market.symbol}:${result.market.timeframe}`;
  if (result.status !== 'signal' || result.expiresAt < now || state.has(key, result.curr.timestamp)) return false;
  await send(result); // Throws on failure. Do not mark a rejected Telegram message as sent.
  state.mark(key, result.curr.timestamp);
  return true;
}
module.exports = { createAlertState, deliverAlert };
