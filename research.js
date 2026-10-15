// Reproduce the limited BTC experiments. The bundled data has already been viewed
// and tuned on; these diagnostic splits do not establish an untouched live edge.
const fs = require('node:fs');
const { MARKETS } = require('./markets');
const { ema, evaluateEntry, computeIndicators } = require('./strategy');
const { loadCsv, simulate, scoreTrades } = require('./backtest-engine');
function aggregate(candles, duration) {
  const groups = Map.groupBy(candles, c => Math.floor(c.timestamp / duration) * duration);
  return [...groups].filter(([, list]) => list.length === duration / 1800000).map(([timestamp, list]) => ({ timestamp, open: list[0].open, high: Math.max(...list.map(c => c.high)), low: Math.min(...list.map(c => c.low)), close: list.at(-1).close, volume: list.reduce((sum, c) => sum + c.volume, 0) }));
}
function main() {
  const candles = loadCsv(fs.readFileSync(process.argv[2] || 'btc_30m_history.csv', 'utf8'));
  const cutoff1 = candles[Math.floor(candles.length * 0.6)]?.timestamp;
  const cutoff2 = candles[Math.floor(candles.length * 0.8)]?.timestamp;
  if (candles.length < 100) throw new Error('Research needs at least 100 valid 30m candles');
  const btc = { ...MARKETS[0], strategy: { volumeMultiplier: 2 } };
  const htf = aggregate(candles, 14400000), htfEma = ema(htf.map(c => c.close), 50);
  const htfByTimestamp = new Map(); let h = -1;
  for (const c of candles) {
    while (h + 1 < htf.length && htf[h + 1].timestamp + 14400000 <= c.timestamp + 1800000) h++;
    htfByTimestamp.set(c.timestamp, { trend: htfEma[h], slope: h > 0 && htfEma[h] !== null && htfEma[h - 1] !== null ? htfEma[h] - htfEma[h - 1] : null });
  }
  const profiles = [
    ['baseline', {}], ['slope', { slope: true }], ['reclaim', { reclaim: true }], ['break', { breakout: true }], ['cost-cap', { cost: true }], ['htf', { htf: true }],
    ['htf-cost', { htf: true, cost: true }], ['slope-cost', { slope: true, cost: true }], ['break-cost', { breakout: true, cost: true }], ['htf-break-cost', { htf: true, breakout: true, cost: true }], ['reclaim-cost', { reclaim: true, cost: true }], ['htf-reclaim', { htf: true, reclaim: true }],
  ];
  const results = [];
  const record = (name, result) => {
    const trades = result.trades;
    const train = scoreTrades(trades.filter(t => t.entryTime < cutoff1 && t.exitTime < cutoff1));
    const validation = scoreTrades(trades.filter(t => t.entryTime >= cutoff1 && t.exitTime < cutoff2));
    results.push({ name, result, train, validation });
  };
  for (const [name, rules] of profiles) {
    const entryRule = (curr, prev) => {
      const signal = evaluateEntry(curr, prev, { volumeMultiplier: 2, requireBreakout: Boolean(rules.breakout), maxEstimatedCostR: rules.cost ? 0.15 : Infinity });
      if (!signal) return null;
      const long = signal.direction === 'LONG';
      if (rules.slope && !(long ? curr.trendEma > prev.trendEma : curr.trendEma < prev.trendEma)) return null;
      if (rules.reclaim && !(long ? prev.close <= prev.pullbackEma : prev.close >= prev.pullbackEma)) return null;
      const higher = htfByTimestamp.get(curr.timestamp);
      if (rules.htf && !([higher.trend, higher.slope].every(Number.isFinite) && (long ? curr.close > higher.trend && higher.slope > 0 : curr.close < higher.trend && higher.slope < 0))) return null;
      return signal;
    };
    record(name, simulate(candles, btc, { feeRate: 0.0015, entryRule }));
  }
  for (const timeframe of ['1h', '4h']) {
    const duration = timeframe === '1h' ? 3600000 : 14400000;
    const slower = aggregate(candles, duration);
    for (const direction of ['both', 'long']) for (const rewardR of [2, 3, 4]) {
      const entryRule = (curr, prev) => {
        const signal = evaluateEntry(curr, prev, { volumeMultiplier: 2, rewardR });
        return signal && (direction === 'both' || signal.direction === 'LONG') ? signal : null;
      };
      record(`${timeframe}-${direction}-${rewardR}R`, simulate(slower, { ...btc, timeframe, timeframeMs: duration }, { feeRate: 0.0015, entryRule }));
    }
  }
  console.log(`Selection periods: earlier 60% ends ${new Date(cutoff1).toISOString()}, next 20% ends ${new Date(cutoff2).toISOString()}`);
  console.table(results.map(r => ({ profile: r.name, earlyTrades: r.train.total, earlyNetRPerTrade: Number(r.train.netExpectancy.toFixed(4)), validationTrades: r.validation.total, validationNetRPerTrade: Number(r.validation.netExpectancy.toFixed(4)) })));
  // Report only the baseline and the two candidates evaluated during this experiment.
  for (const name of ['baseline', 'break-cost', '1h-both-4R']) {
    const r = results.find(r => r.name === name);
    console.log(name, 'FINAL 20% DIAGNOSTIC', scoreTrades(r.result.trades.filter(t => t.entryTime >= cutoff2)));
  }
  console.log('None of the evaluated candidates established profitability. Do not treat these reused-history results as proof of future accuracy.');
}
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { aggregate };
