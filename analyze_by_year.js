const fs = require('node:fs');
const { scoreTrades } = require('./backtest-engine');
const trades = JSON.parse(fs.readFileSync(process.argv[2] || 'trade_log.json', 'utf8'));
const groups = Map.groupBy(trades.filter(t => t.result !== 'OPEN'), t => new Date(t.entryTime).getUTCFullYear());
console.log('UTC year | Trades | Win rate | Gross expectancy | Net R after modelled costs');
for (const [year, list] of [...groups].sort((a, b) => a[0] - b[0])) {
  const s = scoreTrades(list);
  console.log(`${year} | ${s.total} | ${(s.winRate * 100).toFixed(1)}% | ${s.expectancy.toFixed(3)}R | ${s.netR.toFixed(2)}R`);
}
