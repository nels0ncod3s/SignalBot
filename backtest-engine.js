const { computeIndicators, indicatorsReady, evaluateEntry } = require('./strategy');
function simulate(candles, market, { mode = 'independent', feeRate = 0, spread = 0, slippage = 0, entryRule = evaluateEntry } = {}) {
  if (!['independent', 'single'].includes(mode)) throw new Error('Mode must be independent or single');
  if (![feeRate, spread, slippage].every(v => Number.isFinite(v) && v >= 0)) throw new Error('Costs must be non-negative numbers');
  const data = computeIndicators(candles);
  const active = [], completed = [];
  let pending = null, ambiguousBars = 0, skippedGapEntries = 0;
  function finish(trade, exit, curr, ambiguous = false) {
    const risk = Math.abs(trade.entry - trade.sl);
    const grossR = (trade.direction === 'LONG' ? exit - trade.entry : trade.entry - exit) / risk;
    const costR = (feeRate * (trade.entry + exit) / 2 + spread + 2 * slippage) / risk;
    return { ...trade, exit, exitTime: curr.timestamp, grossR, costR, netR: grossR - costR, result: grossR > 0 ? 'WIN' : 'LOSS', ambiguous };
  }
  for (let i = 0; i < data.length; i++) {
    const curr = data[i], prev = data[i - 1];
    if (pending) {
      if (prev && curr.timestamp - prev.timestamp === market.timeframeMs) {
        const valid = pending.direction === 'LONG' ? curr.open > pending.sl && curr.open < pending.tp : curr.open < pending.sl && curr.open > pending.tp;
        if (valid && Math.abs(curr.open - pending.entry) <= prev.atr * market.maxEntryDriftAtr && spread <= prev.atr * market.maxSpreadAtr) {
          active.push({ ...pending, entry: curr.open, entryTime: curr.timestamp, market: market.symbol, mode });
        }
      } else skippedGapEntries++;
      pending = null;
    }
    // Process exits before evaluating a new signal. If both levels are touched, use stop-first.
    for (let j = active.length - 1; j >= 0; j--) {
      const t = active[j], long = t.direction === 'LONG';
      const stop = long ? curr.low <= t.sl : curr.high >= t.sl;
      const target = long ? curr.high >= t.tp : curr.low <= t.tp;
      if (stop || target) {
        const ambiguous = stop && target;
        if (ambiguous) ambiguousBars++;
        const exit = stop ? (long ? Math.min(curr.open, t.sl) : Math.max(curr.open, t.sl)) : t.tp;
        completed.push(finish(t, exit, curr, ambiguous));
        active.splice(j, 1);
      }
    }
    if (!prev || !indicatorsReady(curr) || !indicatorsReady(prev) || curr.timestamp - prev.timestamp !== market.timeframeMs) continue;
    if (mode === 'single' && active.length) continue;
    const signal = entryRule(curr, prev, market.strategy);
    if (signal) pending = { ...signal, referenceEntry: signal.entry, signalTime: curr.timestamp + market.timeframeMs };
  }
  const last = data.at(-1);
  const open = active.map(t => ({ ...finish(t, last.close, last), result: 'OPEN' }));
  completed.sort((a, b) => a.entryTime - b.entryTime);
  return { trades: completed, open, pending, ambiguousBars, skippedGapEntries };
}
function scoreTrades(trades) {
  const closed = trades.filter(t => t.result === 'WIN' || t.result === 'LOSS');
  const value = t => Number.isFinite(t.grossR) ? t.grossR : (t.result === 'WIN' ? Math.abs(t.tp - t.entry) / Math.abs(t.entry - t.sl) : -1);
  const grossR = closed.reduce((sum, t) => sum + value(t), 0);
  const netR = closed.reduce((sum, t) => sum + (Number.isFinite(t.netR) ? t.netR : value(t)), 0);
  const wins = closed.filter(t => value(t) > 0).length;
  return { total: closed.length, wins, losses: closed.length - wins, winRate: closed.length ? wins / closed.length : 0, expectancy: closed.length ? grossR / closed.length : 0, netExpectancy: closed.length ? netR / closed.length : 0, grossR, netR };
}
function loadCsv(raw) {
  const lines = raw.trim().split(/\r?\n/);
  if (lines[0].replace(/^\uFEFF/, '') !== 'timestamp,open,high,low,close,volume') throw new Error('CSV header must be timestamp,open,high,low,close,volume (timestamp in UTC milliseconds)');
  return lines.slice(1).map((line, i) => {
    const parts = line.split(',');
    if (parts.length !== 6 || parts.some(p => !p.trim())) throw new Error(`Invalid CSV row ${i + 2}`);
    const [timestamp, open, high, low, close, volume] = parts.map(Number);
    return { timestamp, open, high, low, close, volume };
  });
}
module.exports = { simulate, scoreTrades, loadCsv };
