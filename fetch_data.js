const ccxt = require('ccxt');
const fs = require('fs');

async function fetchFullHistory(symbol = 'BTC/USDT', timeframe = '1h', years = 2) {
  const exchange = new ccxt.bybit();
  const msPerCandle = 60 * 60 * 1000; // 1h in ms
  const totalCandles = years * 365 * 24;
  let since = exchange.milliseconds() - totalCandles * msPerCandle;

  let allBars = [];

  while (since < exchange.milliseconds()) {
    const bars = await exchange.fetchOHLCV(symbol, timeframe, since, 1000);
    if (!bars || bars.length === 0) break;

    allBars = allBars.concat(bars);
    since = bars[bars.length - 1][0] + msPerCandle;

    console.log(`Fetched up to ${new Date(since).toISOString()} — total so far: ${allBars.length}`);

    // respect rate limits
    await new Promise((resolve) => setTimeout(resolve, exchange.rateLimit));
  }

  // dedupe by timestamp just in case of overlap
  const seen = new Set();
  const deduped = allBars.filter((bar) => {
    if (seen.has(bar[0])) return false;
    seen.add(bar[0]);
    return true;
  });

  // build CSV
  const header = 'timestamp,open,high,low,close,volume\n';
  const rows = deduped
    .map((bar) => bar.join(','))
    .join('\n');

  fs.writeFileSync('btc_1h_history.csv', header + rows);
  console.log(`Saved ${deduped.length} candles to btc_1h_history.csv`);

  return deduped;
}

fetchFullHistory().catch((err) => {
  console.error('Error fetching data:', err);
});