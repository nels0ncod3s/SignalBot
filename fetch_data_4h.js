const fs = require('node:fs');
const { loadConfig } = require('./config');
const { MARKETS } = require('./markets');
const { createProviders } = require('./market-data');
async function main() {
  const [, , timeframe = '30m', yearsArg = '3', symbol = 'BTC/USDT'] = process.argv;
  const duration = { '5m': 300000, '15m': 900000, '30m': 1800000, '1h': 3600000, '4h': 14400000, '1d': 86400000 }[timeframe];
  const years = Number(yearsArg), market = MARKETS.find(m => m.symbol === symbol);
  if (!market || !duration || !Number.isFinite(years) || years <= 0) throw new Error('Usage: node fetch_data_4h.js [30m|4h|...] [positive years] [BTC/USDT|XAU/USD]');
  const providers = createProviders(loadConfig());
  const now = Date.now(), all = [];
  let since = Math.floor((now - years * 365.25 * 86400000) / duration) * duration;
  while (since + duration <= now) {
    const bars = await providers.candles(market, { since, limit: market.provider === 'oanda' ? 5000 : 1000, timeframe, now });
    if (!bars.length) break;
    const next = bars.at(-1).timestamp + duration;
    if (next <= since) throw new Error('History pagination stopped advancing');
    all.push(...bars.filter(c => c.timestamp >= since));
    since = next;
    console.log(`Fetched through ${new Date(since).toISOString()}`);
  }
  const candles = [...new Map(all.map(c => [c.timestamp, c])).values()].sort((a, b) => a.timestamp - b.timestamp);
  if (!candles.length) throw new Error('Provider returned no completed historical candles');
  const file = `${market.provider === 'bybit' ? 'btc' : 'xau'}_${timeframe}_history.csv`;
  fs.writeFileSync(file, 'timestamp,open,high,low,close,volume\n' + candles.map(c => [c.timestamp, c.open, c.high, c.low, c.close, c.volume].join(',')).join('\n') + '\n');
  console.log(`Saved ${candles.length} candles to ${file}; coverage ${new Date(candles[0].timestamp).toISOString()} to ${new Date(candles.at(-1).timestamp).toISOString()}`);
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
