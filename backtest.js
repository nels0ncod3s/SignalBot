const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { MARKETS } = require('./markets');
const { simulate, scoreTrades, loadCsv } = require('./backtest-engine');
function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { market: { type: 'string', default: 'BTC/USDT' }, mode: { type: 'string', default: 'independent' }, timeframe: { type: 'string', default: '30m' }, fee: { type: 'string' }, spread: { type: 'string', default: '0' }, slippage: { type: 'string', default: '0' } } });
  const selected = MARKETS.find(m => m.symbol === values.market);
  if (!selected) throw new Error('Market must be BTC/USDT or XAU/USD');
  const duration = { '5m': 300000, '15m': 900000, '30m': 1800000, '1h': 3600000, '4h': 14400000, '1d': 86400000 }[values.timeframe];
  if (!duration) throw new Error('Unsupported timeframe');
  const market = { ...selected, timeframe: values.timeframe, timeframeMs: duration };
  const defaultFile = `${selected.provider === 'bybit' ? 'btc' : 'xau'}_${values.timeframe}_history.csv`;
  const csv = positionals[0] || defaultFile;
  const candles = loadCsv(fs.readFileSync(csv, 'utf8')).filter(c => c.timestamp + duration <= Date.now());
  const feeRate = values.fee === undefined ? (selected.provider === 'bybit' ? 0.0015 : 0) : Number(values.fee);
  const result = simulate(candles, market, { mode: values.mode, feeRate, spread: Number(values.spread), slippage: Number(values.slippage) });
  const report = (list, label) => console.log(label, JSON.stringify(scoreTrades(list), null, 2));
  console.log(`${market.symbol} ${market.timeframe}; mode=${values.mode}; round-trip fee=${feeRate}; spread=${values.spread}; slippage/side=${values.slippage}`);
  console.log('Next candle open entries; stop-first ambiguous bars; gap-aware stop fills. Costs are assumptions, not measured execution.');
  report(result.trades, 'FULL DATASET');
  // Diagnostic time split only. Do not call reused/tuned data untouched out-of-sample.
  const cutoff = candles[Math.floor(candles.length * 0.7)]?.timestamp;
  report(result.trades.filter(t => t.entryTime < cutoff && t.exitTime < cutoff), 'EARLIER 70% OF CANDLE TIME');
  report(result.trades.filter(t => t.entryTime >= cutoff), 'LATER 30% OF CANDLE TIME (diagnostic only)');
  console.log(`Open trades: ${result.open.length}; pending final signal: ${Boolean(result.pending)}; ambiguous exits: ${result.ambiguousBars}; skipped gap entries: ${result.skippedGapEntries}`);
  if (selected.provider === 'oanda' && Number(values.spread) === 0) console.warn('Gold spread is zero: supply --spread in USD/oz for meaningful cost estimates.');
  const stem = path.basename(csv, path.extname(csv));
  const output = csv === 'btc_30m_history.csv' && !positionals.length ? 'trade_log.json' : `trade_log_${stem}.json`;
  fs.writeFileSync(output, JSON.stringify([...result.trades, ...result.open], null, 2));
  console.log(`Saved ${output}`);
}
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
