import pandas as pd,numpy as np,json
from sklearn.ensemble import GradientBoostingClassifier
import argparse
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('--data-dir',type=Path,default=Path('research-data'));args=parser.parse_args()
p=str(args.data_dir.resolve())+'/'
df=pd.read_csv(p+'development.csv');
if df.timestamp.duplicated().any() or not (df.timestamp.diff().dropna()==3600000).all(): raise ValueError('Expected contiguous 1h timestamps')
c=df.close;o=df.open;h=df.high;l=df.low;v=df.volume
tr=pd.concat([h-l,(h-c.shift()).abs(),(l-c.shift()).abs()],axis=1).max(axis=1);atr=tr.ewm(alpha=1/14,adjust=False).mean()
def rsi(n):
 d=c.diff();up=d.clip(lower=0).ewm(alpha=1/n,adjust=False).mean();dn=(-d.clip(upper=0)).ewm(alpha=1/n,adjust=False).mean();return 100-100/(1+up/dn.replace(0,1e-10))
e20=c.ewm(span=20,adjust=False).mean();e50=c.ewm(span=50,adjust=False).mean();e200=c.ewm(span=200,adjust=False).mean();t=pd.to_datetime(df.timestamp,unit='ms',utc=True)
f=pd.DataFrame({'rsi2':rsi(2)/100,'rsi14':rsi(14)/100,'atrpct':atr/c,'gap20':(c-e20)/atr,'gap50':(c-e50)/atr,'gap200':(c-e200)/atr,'slope50':e50.diff(6)/atr,'range':(h-l)/atr,'body':(c-o)/atr,'vol':v/v.rolling(20).mean(),'band':(c-c.rolling(20).mean())/(c.rolling(20).std()*2),'hourSin':np.sin(t.dt.hour*2*np.pi/24),'hourCos':np.cos(t.dt.hour*2*np.pi/24)})
for n in [1,3,6,12,24]:f['ret'+str(n)]=c.pct_change(n)
X=[];Y=[];nets=[];times=[];exits=[];sides=[];risks=[]
atr_a=atr.to_numpy();open_a=o.to_numpy();close_a=c.to_numpy();high_a=h.to_numpy();low_a=l.to_numpy();time_a=df.timestamp.to_numpy();feature_a=f.to_numpy()
for i in range(240,len(df)-49):
 risk=2*atr_a[i];entry=open_a[i+1]
 if .0015*entry/risk>.15 or abs(entry-close_a[i])>atr_a[i]*.25:continue
 for side in [1,-1]:
  sl=close_a[i]-side*risk;tp=close_a[i]+side*1.5*risk
  if not(min(sl,tp)<entry<max(sl,tp)):continue
  exit=None;label=0
  for j in range(i+1,i+49):
   stop=low_a[j]<=sl if side==1 else high_a[j]>=sl;target=high_a[j]>=tp if side==1 else low_a[j]<=tp
   if stop:exit=min(open_a[j],sl) if side==1 else max(open_a[j],sl);break
   if target:exit=tp;break
  if exit is None:exit=close_a[j]
  rr=abs(entry-sl);net=side*(exit-entry)/rr-.0015*(entry+exit)/2/rr
  features=[*feature_a[i],side]
  if not np.isfinite(features).all():continue
  X.append(features);Y.append(int(net>0));nets.append(net);times.append(time_a[i+1]);exits.append(time_a[j]);sides.append(side);risks.append(rr)
X=np.array(X);Y=np.array(Y);nets=np.array(nets);times=np.array(times);exits=np.array(exits)
cut=pd.Timestamp('2025-08-01T00:00:00Z').timestamp()*1000
train=(times<cut)&(exits<cut-48*3600000);validation=times>=cut+48*3600000
model=GradientBoostingClassifier(n_estimators=100,max_depth=2,learning_rate=.05,min_samples_leaf=100,random_state=7)
model.fit(X[train],Y[train]);prob=model.predict_proba(X[validation])[:,1];selected=prob>=.60
scores=nets[validation][selected];hits=Y[validation][selected]
result={'model':'gradient-boosting-100-depth2','training_samples':int(train.sum()),'validation_candidates':int(validation.sum()),'probabilityThreshold':.60,'selected':int(selected.sum()),'winRate':float(hits.mean()) if len(hits) else None,'netExpectancy':float(scores.mean()) if len(scores) else None,'eligible':bool(len(scores)>=30 and hits.mean()>=.50 and scores.mean()>0)}
print(json.dumps(result,indent=2));open(p+'model-selection.json','w').write(json.dumps(result,indent=2))
