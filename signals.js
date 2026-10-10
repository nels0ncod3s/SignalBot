const { computeIndicators, indicatorsReady, evaluateEntry } = require('./strategy');
const MAX_SIGNAL_AGE_MS = 3 * 60000;
async function getCurrentSignal(market, providers, fixedNow) {
  const clock = () => fixedNow ?? Date.now();
  const candles = await providers.candles(market, { now: clock() });
  let now = clock();
  const data = computeIndicators(candles);
  const curr = data.at(-1), prev = data.at(-2);
  if (!indicatorsReady(curr) || !indicatorsReady(prev)) return { market, status: 'warming-up' };
  const closedAt = curr.timestamp + market.timeframeMs;
  const base = { market, curr, closedAt, expiresAt: closedAt + MAX_SIGNAL_AGE_MS };
  if (closedAt > now || now - closedAt > MAX_SIGNAL_AGE_MS) return { ...base, status: 'stale' };
  if (curr.timestamp - prev.timestamp !== market.timeframeMs) return { ...base, status: 'session-gap' };
  const signal = evaluateEntry(curr, prev, market.strategy);
  if (!signal) return { ...base, status: 'no-signal' };
  const quote = await providers.quote(market);
  now = clock();
  if (now > base.expiresAt) return { ...base, status: "stale" };
  if (!quote.tradeable) return { ...base, status: 'market-closed' };
  if (![quote.bid, quote.ask, quote.timestamp].every(Number.isFinite) || quote.bid <= 0 || quote.ask < quote.bid || quote.timestamp > now + 5000 || now - quote.timestamp > 60000) return { ...base, status: 'invalid-quote' };
  if (quote.ask - quote.bid > curr.atr * market.maxSpreadAtr) return { ...base, status: 'wide-spread' };
  const liveEntry = signal.direction === 'LONG' ? quote.ask : quote.bid;
  if (Math.abs(liveEntry - signal.entry) > curr.atr * market.maxEntryDriftAtr) return { ...base, status: 'price-moved' };
  return { ...base, status: 'signal', signal, quote, liveEntry };
}
function formatResult(result) {
  const { market, signal, curr } = result;
  const title = `${market.symbol} · ${market.timeframe}`;
  if (result.status === 'error') return `${title}\nData unavailable. Check provider configuration and logs.`;
  if (result.status !== 'signal') {
    const reasons = { 'not-configured': 'Set OANDA_API_TOKEN and OANDA_ACCOUNT_ID on your host to enable gold.', 'warming-up': 'Not enough valid candle data.', stale: 'No fresh closed candle; market may be closed.', 'session-gap': 'Entry skipped across a session/data gap.', 'no-signal': 'No qualifying entry on the latest closed candle.', 'market-closed': 'Broker reports market closed.', 'invalid-quote': 'Quote is missing or stale.', 'wide-spread': 'Spread exceeds the strategy limit.', 'price-moved': 'Price has moved too far from the signal entry.' };
    return `${title}\n${reasons[result.status] || 'No valid signal.'}${curr ? `\nCandle closed: ${new Date(result.closedAt).toISOString()}` : ''}`;
  }
  return `${signal.direction === 'LONG' ? '🟢' : '🔴'} ${signal.direction} · ${title}\nReference entry: ${signal.entry.toFixed(2)}\nCurrent ${signal.direction === 'LONG' ? 'ask' : 'bid'}: ${result.liveEntry.toFixed(2)}\nStop loss: ${signal.sl.toFixed(2)}\nTake profit: ${signal.tp.toFixed(2)}\nReference reward/risk: 3:1\nCandle closed: ${new Date(result.closedAt).toISOString()}\nExpires: ${new Date(result.expiresAt).toISOString()}\n${market.provider === 'oanda' ? 'Gold research strategy; performance not yet validated.' : 'Research signal; no order placed.'}`;
}
module.exports = { getCurrentSignal, formatResult, MAX_SIGNAL_AGE_MS };
