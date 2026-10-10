// Gold intentionally uses price-only confirmation: broker tick volume is not BTC exchange volume.
// These gold settings are an unvalidated research baseline, not a measured trading edge.
const MARKETS = [
  { symbol: 'BTC/USDT', provider: 'bybit', timeframe: '30m', timeframeMs: 1800000, strategy: { volumeMultiplier: 2 }, maxSpreadAtr: 0.1, maxEntryDriftAtr: 0.25 },
  { symbol: 'XAU/USD', provider: 'oanda', instrument: 'XAU_USD', timeframe: '30m', timeframeMs: 1800000, strategy: { volumeMultiplier: null }, maxSpreadAtr: 0.1, maxEntryDriftAtr: 0.25 },
];
module.exports = { MARKETS };
