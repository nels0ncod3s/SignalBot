const { validateCandles } = require('./strategy');
async function requestJson(url, options = {}, fetchFn = fetch) {
  const response = await fetchFn(url, { ...options, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Data provider returned HTTP ${response.status}`);
  return response.json();
}
function createProviders(config, { exchange, fetchFn = fetch } = {}) {
  let bybit = exchange;
  const oandaUrl = config.oandaEnvironment === 'live' ? 'https://api-fxtrade.oanda.com' : 'https://api-fxpractice.oanda.com';
  async function oandaRequest(route) {
    if (!config.oandaApiToken || !config.oandaAccountId) throw new Error('XAU/USD needs OANDA_API_TOKEN and OANDA_ACCOUNT_ID (account must offer XAU_USD)');
    return requestJson(`${oandaUrl}/v3${route}`, { headers: { Authorization: `Bearer ${config.oandaApiToken}` } }, fetchFn);
  }
  function normalizeOanda(data) {
    if (!Array.isArray(data.candles)) throw new Error('OANDA returned no candle list');
    return data.candles.filter(c => c.complete === true).map(c => ({
      timestamp: Date.parse(c.time), open: Number(c.mid?.o), high: Number(c.mid?.h), low: Number(c.mid?.l), close: Number(c.mid?.c), volume: Number(c.volume),
    }));
  }
  return {
    async candles(market, { since, limit = 300, timeframe = market.timeframe, now = Date.now() } = {}) {
      let candles;
      if (market.provider === 'bybit') {
        bybit ||= new (require('ccxt').bybit)({ enableRateLimit: true, timeout: 15000 });
        const bars = await bybit.fetchOHLCV(market.symbol, timeframe, since, limit);
        candles = bars.map(([timestamp, open, high, low, close, volume]) => ({ timestamp, open, high, low, close, volume }));
      } else {
        const granularity = { '5m': 'M5', '15m': 'M15', '30m': 'M30', '1h': 'H1', '4h': 'H4', '1d': 'D' }[timeframe];
        if (!granularity) throw new Error('Unsupported OANDA timeframe');
        const query = new URLSearchParams({ granularity, price: 'M', count: String(Math.min(limit, 5000)) });
        if (since !== undefined) query.set('from', new Date(since).toISOString());
        const account = encodeURIComponent(config.oandaAccountId || '');
        candles = normalizeOanda(await oandaRequest(`/accounts/${account}/instruments/${market.instrument}/candles?${query}`));
      }
      validateCandles(candles);
      const duration = { '5m': 300000, '15m': 900000, '30m': 1800000, '1h': 3600000, '4h': 14400000, '1d': 86400000 }[timeframe];
      if (!duration) throw new Error('Unsupported timeframe');
      return candles.filter(c => c.timestamp + duration <= now);
    },
    async quote(market) {
      if (market.provider === 'bybit') {
        bybit ||= new (require('ccxt').bybit)({ enableRateLimit: true, timeout: 15000 });
        // The pinned CCXT Bybit ticker omits response time; order books retain ts.
        const book = await bybit.fetchOrderBook(market.symbol, 1);
        return { bid: book.bids?.[0]?.[0], ask: book.asks?.[0]?.[0], timestamp: book.timestamp, tradeable: true };
      }
      const account = encodeURIComponent(config.oandaAccountId || '');
      const data = await oandaRequest(`/accounts/${account}/pricing?instruments=${market.instrument}`);
      const price = data.prices?.find(p => p.instrument === market.instrument);
      if (!price) throw new Error('OANDA account has no XAU_USD pricing');
      return { bid: Number(price.bids?.[0]?.price), ask: Number(price.asks?.[0]?.price), timestamp: Date.parse(price.time), tradeable: price.status === 'tradeable' };
    },
  };
}
module.exports = { createProviders, requestJson };
