const ccxt = require("ccxt");
const fs = require("fs");

// map timeframe string -> milliseconds per candle (needed to fix pagination correctly)
const TIMEFRAME_MS = {
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "30m": 30 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
};

async function fetchFullHistory(
  symbol = "BTC/USDT",
  timeframe = "4h",
  years = 8,
) {
  const exchange = new ccxt.bybit();
  const msPerCandle = TIMEFRAME_MS[timeframe];
  if (!msPerCandle) throw new Error(`Unsupported timeframe: ${timeframe}`);

  const totalCandles = Math.ceil(
    (years * 365 * 24 * 60 * 60 * 1000) / msPerCandle,
  );
  let since = exchange.milliseconds() - totalCandles * msPerCandle;

  let allBars = [];

  while (since < exchange.milliseconds()) {
    const bars = await exchange.fetchOHLCV(symbol, timeframe, since, 1000);
    if (!bars || bars.length === 0) break;

    allBars = allBars.concat(bars);
    since = bars[bars.length - 1][0] + msPerCandle;

    console.log(
      `Fetched up to ${new Date(since).toISOString()} — total so far: ${allBars.length}`,
    );

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
  const header = "timestamp,open,high,low,close,volume\n";
  const rows = deduped.map((bar) => bar.join(",")).join("\n");

  const outFile = `btc_${timeframe}_history.csv`;
  fs.writeFileSync(outFile, header + rows);
  console.log(`Saved ${deduped.length} candles to ${outFile}`);

  return deduped;
}

// Usage: node fetch_data_4h.js [timeframe] [years]
// e.g.:  node fetch_data_4h.js 30m 2
const [, , timeframeArg, yearsArg] = process.argv;
const args = [
  "BTC/USDT",
  ...(timeframeArg ? [timeframeArg] : []),
  ...(yearsArg ? [Number(yearsArg)] : []),
];

fetchFullHistory(...args).catch((err) => {
  console.error("Error fetching data:", err);
});
