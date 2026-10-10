const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MARKETS } = require('../markets');
const { computeIndicators, evaluateEntry, indicatorsReady, validateCandles } = require('../strategy');
const { getCurrentSignal, MAX_SIGNAL_AGE_MS } = require('../signals');
const { createProviders } = require('../market-data');
const { createTelegram } = require('../telegram_bot');
const { createAlertState, deliverAlert } = require('../alert-state');
const { simulate, scoreTrades, loadCsv } = require('../backtest-engine');
const { loadConfig } = require('../config');
const gold = MARKETS[1], btc = MARKETS[0], duration = gold.timeframeMs;
function fixture() {
  const candles = Array.from({ length: 55 }, (_, i) => {
    const open = 100 + i * 0.1;
    return { timestamp: 1700000000000 + i * duration, open, high: open + 0.2, low: open - 0.2, close: open + 0.1, volume: 100 };
  });
  candles.at(-2).low -= 0.7;
  candles.at(-1).volume = 1000;
  const data = computeIndicators(candles);
  const signal = evaluateEntry(data.at(-1), data.at(-2), btc.strategy);
  assert.ok(signal, 'fixture must qualify');
  return { candles, signal, now: candles.at(-1).timestamp + duration + 1000 };
}
function providerFixture() {
  const f = fixture();
  const providers = { candles: async () => f.candles, quote: async () => ({ bid: f.signal.entry - 0.01, ask: f.signal.entry + 0.01, timestamp: f.now, tradeable: true }) };
  return { ...f, providers };
}
test('rejects NaN indicators, malformed, duplicate and unordered candles', () => {
  assert.equal(indicatorsReady({ trendEma: NaN, pullbackEma: 1, atr: 1, volSma: 1 }), false);
  const { candles } = fixture();
  assert.throws(() => validateCandles([{ ...candles[0], close: NaN }]), /Invalid/);
  assert.throws(() => validateCandles([candles[0], candles[0]]), /unordered/);
  assert.throws(() => validateCandles([{ ...candles[0], high: 1 }]), /Invalid/);
  assert.throws(() => loadCsv('timestamp,open,high,low,close,volume\n1,2,3,1,,0'), /Invalid CSV/);
});
test('gold works without exchange volume; BTC retains its volume filter', () => {
  const { candles } = fixture(); candles.forEach(c => c.volume = 0);
  const data = computeIndicators(candles);
  assert.ok(evaluateEntry(data.at(-1), data.at(-2), gold.strategy));
  assert.equal(evaluateEntry(data.at(-1), data.at(-2), btc.strategy), null);
});
test('fresh complete setup produces signal; stale candles and session gaps cannot', async () => {
  const f = providerFixture();
  assert.equal((await getCurrentSignal(gold, f.providers, f.now)).status, 'signal');
  assert.equal((await getCurrentSignal(gold, f.providers, f.now + MAX_SIGNAL_AGE_MS)).status, 'stale');
  f.candles.at(-1).timestamp += duration;
  assert.equal((await getCurrentSignal(gold, f.providers, f.now + duration)).status, 'session-gap');
});
test('closed market, stale quote, excessive spread and moved prices reject signals', async () => {
  const f = providerFixture();
  for (const [quote, status] of [
    [{ bid: 1, ask: 2, timestamp: f.now, tradeable: false }, 'market-closed'],
    [{ bid: f.signal.entry, ask: f.signal.entry, timestamp: f.now - 61000, tradeable: true }, 'invalid-quote'],
    [{ bid: f.signal.entry - 1, ask: f.signal.entry + 1, timestamp: f.now, tradeable: true }, 'wide-spread'],
    [{ bid: f.signal.entry + 1, ask: f.signal.entry + 1.01, timestamp: f.now, tradeable: true }, 'price-moved'],
  ]) {
    f.providers.quote = async () => quote;
    assert.equal((await getCurrentSignal(gold, f.providers, f.now)).status, status);
  }
});
test('OANDA normalization keeps final completed candle and excludes forming candle', async () => {
  const calls = [];
  const p = createProviders({ oandaApiToken: 'fake', oandaAccountId: 'account', oandaEnvironment: 'practice' }, { fetchFn: async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ candles: [0, 1].map(i => ({ time: new Date(1700000000000 + i * duration).toISOString(), complete: i === 0, mid: { o: '100', h: '101', l: '99', c: '100' }, volume: 10 })) }) };
  } });
  const candles = await p.candles(gold, { now: 1700000000000 + 2 * duration });
  assert.equal(candles.length, 1);
  assert.match(calls[0].url, /api-fxpractice.*XAU_USD.*granularity=M30/);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer fake');
});
test('Bybit excludes only candles whose close time is still in the future', async () => {
  const { candles, now } = fixture();
  const p = createProviders({}, { exchange: { fetchOHLCV: async () => candles.map(c => [c.timestamp, c.open, c.high, c.low, c.close, c.volume]) } });
  assert.equal((await p.candles(btc, { now })).length, 55);
  assert.equal((await p.candles(btc, { now: now - duration })).length, 54);
});
test('gold configuration failure does not prevent fetching BTC', async () => {
  const p = createProviders({}, { exchange: { fetchOHLCV: async () => [] } });
  await assert.rejects(p.candles(gold), /OANDA_API_TOKEN/);
  assert.deepEqual(await p.candles(btc), []);
});
test('rejected Telegram deliveries remain retryable and state is independent per market', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'signalbot-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const state = createAlertState(dir), f = providerFixture();
  const result = await getCurrentSignal(gold, f.providers, f.now);
  await assert.rejects(deliverAlert(result, state, async () => { throw new Error('rejected'); }, f.now));
  assert.equal(state.has('XAU/USD:30m', result.curr.timestamp), false);
  assert.equal(await deliverAlert(result, state, async () => {}, f.now), true);
  assert.equal(await deliverAlert(result, state, async () => { assert.fail('duplicate'); }, f.now), false);
  assert.equal(createAlertState(dir).has('XAU/USD:30m', result.curr.timestamp), true);
  assert.equal(await deliverAlert({ ...result, market: btc }, state, async () => {}, f.now), true);
  assert.equal(await deliverAlert({ ...result, curr: { timestamp: result.curr.timestamp + duration } }, state, async () => { assert.fail('expired'); }, result.expiresAt + 1), false);
});
test('Telegram rejection throws and transport errors never expose token URLs', async () => {
  const telegram = createTelegram({ telegramBotToken: 'secret-token' }, async () => ({ ok: true, status: 200, json: async () => ({ ok: false, error_code: 429 }) }));
  await assert.rejects(telegram('sendMessage', {}), /429/);
  const failed = createTelegram({ telegramBotToken: 'secret-token' }, async () => { throw Error('secret-token'); });
  await assert.rejects(failed('sendMessage', {}), error => !error.message.includes('secret-token'));
});
test('backtest uses next open, stop-first ambiguous exits and price-proportional costs', () => {
  const { candles, signal } = fixture();
  candles.push({ timestamp: candles.at(-1).timestamp + duration, open: signal.entry, close: signal.entry, low: signal.sl - 0.01, high: signal.tp + 0.01, volume: 100 });
  const result = simulate(candles, btc, { feeRate: 0.0015 });
  assert.equal(result.trades.length, 1);
  const trade = result.trades[0];
  assert.equal(trade.entryTime, candles.at(-1).timestamp);
  assert.equal(trade.grossR, -1);
  assert.ok(trade.netR < -1);
  assert.equal(result.ambiguousBars, 1);
  assert.ok(Math.abs(trade.costR - 0.0015 * (trade.entry + trade.exit) / 2 / Math.abs(trade.entry - trade.sl)) < 1e-10);
});
test('gap stops account for adverse opening prices; unfinished trades are retained', () => {
  const { candles, signal } = fixture();
  candles.push({ timestamp: candles.at(-1).timestamp + duration, open: signal.entry, close: signal.entry, low: signal.entry - 0.01, high: signal.entry + 0.01, volume: 100 });
  assert.equal(simulate(candles, btc).open.length, 1);
  const open = signal.sl - 0.5;
  candles.push({ timestamp: candles.at(-1).timestamp + duration, open, close: open, low: open - 0.1, high: open + 0.1, volume: 100 });
  assert.ok(simulate(candles, btc).trades[0].grossR < -1);
});
test('score uses actual 3R reward and safely handles empty samples', () => {
  assert.equal(scoreTrades([{ entry: 100, sl: 90, tp: 130, result: 'WIN' }]).expectancy, 3);
  assert.equal(scoreTrades([]).expectancy, 0);
  assert.ok(Math.abs(scoreTrades([{ grossR: 3, netR: 2.8, result: 'WIN' }, { grossR: -1.5, netR: -1.7, result: 'LOSS' }]).netR - 1.1) < 1e-10);
});
test('individual environment overrides merge with file config', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'signalbot-config-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify({ telegramBotToken: 'old', telegramChatId: '42', oandaApiToken: 'gold' }));
  const c = loadConfig({ TELEGRAM_BOT_TOKEN: 'new' }, file);
  assert.equal(c.telegramBotToken, 'new'); assert.equal(c.telegramChatId, '42'); assert.equal(c.oandaApiToken, 'gold');
});
test('BTC quotes use timestamped order-book bid/ask, not timestamp-less tickers', async () => {
  const p = createProviders({}, { exchange: { fetchOrderBook: async (symbol, limit) => {
    assert.equal(symbol, btc.symbol); assert.equal(limit, 1);
    return { timestamp: 1700000000000, bids: [[100, 2]], asks: [[101, 2]] };
  } } });
  assert.deepEqual(await p.quote(btc), { bid: 100, ask: 101, timestamp: 1700000000000, tradeable: true });
});
test('independent backtest retains overlapping entries; single mode suppresses them', () => {
  const { candles, signal } = fixture();
  candles.at(-1).low -= 0.7;
  for (let i = 0; i < 3; i++) {
    const last = candles.at(-1), open = signal.entry + (i + 1) * 0.1;
    candles.push({ timestamp: last.timestamp + duration, open, close: open + 0.05, high: open + 0.1, low: open - 0.7, volume: 1000 * 10 ** (i + 1) });
  }
  const multiple = simulate(candles, btc, { mode: 'independent' });
  const single = simulate(candles, btc, { mode: 'single' });
  assert.ok(multiple.open.length > 1);
  assert.equal(single.open.length, 1);
});
test('legacy BTC delivery state migrates without blocking gold', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'signalbot-migrate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'alert_state.json'), JSON.stringify({ lastAlertedCandleTime: 123 }));
  const state = createAlertState(dir);
  assert.equal(state.has('BTC/USDT:30m', 123), true);
  assert.equal(state.has('XAU/USD:30m', 123), false);
});
test('OANDA live account uses live pricing and broker tradeability', async () => {
  const p = createProviders({ oandaApiToken: 'fake', oandaAccountId: 'account', oandaEnvironment: 'live' }, { fetchFn: async url => {
    assert.match(url, /^https:\/\/api-fxtrade.oanda.com\/v3\/accounts\/account\/pricing\?instruments=XAU_USD$/);
    return { ok: true, json: async () => ({ prices: [{ instrument: 'XAU_USD', time: '2026-10-10T08:00:00Z', status: 'non-tradeable', bids: [{ price: '3000' }], asks: [{ price: '3000.4' }] }] }) };
  } });
  const quote = await p.quote(gold);
  assert.equal(quote.tradeable, false); assert.equal(quote.bid, 3000); assert.equal(quote.ask, 3000.4);
});
