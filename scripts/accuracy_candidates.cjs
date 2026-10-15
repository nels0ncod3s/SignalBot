const fs=require('fs'); const root=require('node:path').resolve(__dirname,'..'),s=require(root+'/strategy'), {loadCsv,simulate,scoreTrades}=require(root+'/backtest-engine'),{MARKETS}=require(root+'/markets');
function rsi(values,n){const out=values.map(()=>null);let up=0,down=0;for(let i=1;i<values.length;i++){const d=values[i]-values[i-1],u=Math.max(d,0),l=Math.max(-d,0);if(i<=n){up+=u;down+=l;if(i<n)continue;up/=n;down/=n;}else{up=(up*(n-1)+u)/n;down=(down*(n-1)+l)/n;}out[i]=up===0&&down===0?50:down===0?100:100-100/(1+up/down);}return out;}
const dataDir=require('node:path').resolve(process.argv[2]||'research-data');
const dev=loadCsv(fs.readFileSync(require('node:path').join(dataDir,'development.csv'),'utf8'));
if (dev.some((c,i)=>i && c.timestamp-dev[i-1].timestamp!==3600000)) throw new Error('Expected contiguous 1h data');
const cut=Date.parse('2025-08-01T00:00:00Z');const candidates=[];
for(const tf of ['1h','4h']){const duration=tf==='1h'?3600000:14400000;
// aggregate helper assumes 30m inputs, so use an explicit UTC group here.
const candles=tf==='1h'?dev:[...Map.groupBy(dev,c=>Math.floor(c.timestamp/duration)*duration)].filter(([,cs])=>cs.length===4).map(([timestamp,cs])=>({timestamp,open:cs[0].open,close:cs.at(-1).close,high:Math.max(...cs.map(c=>c.high)),low:Math.min(...cs.map(c=>c.low)),volume:cs.reduce((a,c)=>a+c.volume,0)}));
const closes=candles.map(c=>c.close),e200=s.ema(closes,200),r2=rsi(closes,2),r14=rsi(closes,14),avg=s.sma(closes,20);const rich=new Map(candles.map((c,i)=>{const sd=i>=19?Math.sqrt(closes.slice(i-19,i+1).reduce((sum,v)=>sum+(v-avg[i])**2,0)/20):null;return[c.timestamp,{e200:e200[i],r2:r2[i],r14:r14[i],lower:sd!==null?avg[i]-2*sd:null,upper:sd!==null?avg[i]+2*sd:null}];}));
for(const type of ['rsi-pullback','rsi2-reversal','band-reclaim'])for(const reward of [1,1.5]){
 const name=`${type}-${tf}-${reward}R`;
 const rule=(c,p)=>{const x=rich.get(c.timestamp),y=rich.get(p.timestamp);if(![x.e200,y.e200,x.r14,y.r14,x.r2,y.r2].every(Number.isFinite))return null;let long=false,short=false;
 if(type==='rsi-pullback'){long=c.trendEma>x.e200&&c.close>x.e200&&y.r14<40&&x.r14>=40;short=c.trendEma<x.e200&&c.close<x.e200&&y.r14>60&&x.r14<=60;}
 if(type==='rsi2-reversal'){long=c.close>x.e200&&y.r2<15&&x.r2>y.r2;short=c.close<x.e200&&y.r2>85&&x.r2<y.r2;}
 if(type==='band-reclaim'){long=c.close>x.e200&&p.close<y.lower&&c.close>=x.lower;short=c.close<x.e200&&p.close>y.upper&&c.close<=x.upper;}
 if(!long&&!short)return null;const risk=2*c.atr,entry=c.close;if(.0015*entry/risk>.15)return null;return{direction:long?'LONG':'SHORT',entry,sl:entry+(long?-risk:risk),tp:entry+(long?1:-1)*risk*reward};};
 const result=simulate(candles,{...MARKETS[0],timeframe:tf,timeframeMs:duration},{feeRate:.0015,entryRule:rule});const train=scoreTrades(result.trades.filter(t=>t.entryTime<cut&&t.exitTime<cut)),validation=scoreTrades(result.trades.filter(t=>t.entryTime>=cut));candidates.push({name,type,tf,reward,train,validation});
}}
fs.writeFileSync(require('node:path').join(dataDir,'selection.json'),JSON.stringify(candidates,null,2));console.table(candidates.map(c=>({name:c.name,trainN:c.train.total,trainWR:c.train.winRate,trainNet:c.train.netExpectancy,valN:c.validation.total,valWR:c.validation.winRate,valNet:c.validation.netExpectancy})));
// Predeclared acceptance: >=100 train and >=30 validation trades, positive net in both,
// >=50% hit rate in validation. Rank eligible models by validation net expectancy.
const eligible=candidates.filter(c=>c.train.total>=100&&c.validation.total>=30&&c.train.netExpectancy>0&&c.validation.netExpectancy>0&&c.validation.winRate>=.5).sort((a,b)=>b.validation.netExpectancy-a.validation.netExpectancy);
console.log('ELIGIBLE',eligible.map(c=>c.name));fs.writeFileSync(require('node:path').join(dataDir,'locked-candidate.json'),JSON.stringify(eligible[0]||null,null,2));
