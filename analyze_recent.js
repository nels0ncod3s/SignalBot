const fs = require('node:fs');
const { scoreTrades } = require('./backtest-engine');
const trades = JSON.parse(fs.readFileSync(process.argv[2] || 'trade_log.json', 'utf8')).filter(t => t.result !== 'OPEN');
if (!trades.length) { console.log('No completed trades.'); process.exit(0); }
const start = new Date(); start.setUTCMonth(start.getUTCMonth() - 18);
const groups = Map.groupBy(trades.filter(t => t.entryTime >= start.getTime()), t => new Date(t.entryTime).toISOString().slice(0, 7));
console.log('UTC month | Trades | Win rate | Gross expectancy | Net R after modelled costs');
for (const [month, list] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
  const s = scoreTrades(list);
  console.log(`${month} | ${s.total} | ${(s.winRate * 100).toFixed(1)}% | ${s.expectancy.toFixed(3)}R | ${s.netR.toFixed(2)}R`);
}
const sorted = [...trades].sort((a, b) => a.entryTime - b.entryTime);
const midpoint = (sorted[0].entryTime + sorted.at(-1).entryTime) / 2;
console.log('Early half:', scoreTrades(trades.filter(t => t.entryTime < midpoint)));
console.log('Late half:', scoreTrades(trades.filter(t => t.entryTime >= midpoint)));
console.log('Diagnostic only: overlapping trades are not independent observations. No naive significance test is applied.');
