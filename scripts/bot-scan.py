#!/usr/bin/env python3
"""Mechanical scan of the sweep, shift, retrace model on recorded 1m candles.

    python3 scripts/bot-scan.py ~/src/ict-scanner/data/xyz:SP500_1m.parquet \
        '[{}, {"mss":"swing","entry":"far","bias":"combo"}]' [--trades]

Each JSON object overrides the defaults in run(); the defaults are the rules
in bot/models/2022-v3.md (mss=sweepbar, entry=near, sweep=failed, bias=4h).
The v2 model is mss=swing, entry=far, sweep=strict, bias=combo. Prints one
summary line per variant: sweeps seen, displacements with a shift, fills,
trades, net R at a fixed 2R target with the stop beyond the sweep wick, and the
win rate. 5m bars are built from the 1m file; sweeps are taken 09:30 to 11:30
ET; positions run until stop, target or the cut time; one position at a time;
two losses end the day. Limit fills need price to trade through the limit.
This is a calibration aid for the wording in bot/, not a backtest of the bot.
"""
import sys, itertools, json
import numpy as np, pandas as pd
ET='America/New_York'
raw=pd.read_parquet(sys.argv[1]); raw['ts']=pd.to_datetime(raw['timestamp'],utc=True).dt.tz_convert(ET)
raw=raw.set_index('ts').sort_index()
m1=raw[['open','high','low','close','volume']]
def resample(df,rule,origin='start_day'):
    o=df.resample(rule,label='left',closed='left',origin=origin).agg({'open':'first','high':'max','low':'min','close':'last','volume':'sum'}).dropna()
    return o
m5=resample(m1,'5min'); h4=resample(m1,'4h',origin=pd.Timestamp('2026-04-26 00:00',tz=ET))
# RTH day frames
days=sorted(set(m5.index.date))
def rth(df,d): return df[(df.index.date==d)&(df.index.time>=pd.Timestamp('09:30').time())&(df.index.time<pd.Timestamp('16:00').time())]
daily={}
for d in days:
    r=rth(m1,d)
    if len(r)>300: daily[d]=dict(high=r.high.max(),low=r.low.min(),open=r.open.iloc[0],close=r.close.iloc[-1])
dd=pd.DataFrame(daily).T.sort_index().astype(float)
def swings(hi,lo,k=1):
    """indices of 3-bar swing highs/lows"""
    sh=[i for i in range(k,len(hi)-k) if hi[i]>max(hi[i-k:i]) and hi[i]>max(hi[i+1:i+1+k])]
    sl=[i for i in range(k,len(lo)-k) if lo[i]<min(lo[i-k:i]) and lo[i]<min(lo[i+1:i+1+k])]
    return sh,sl
def bias_from(df):
    """direction of last break of structure: last close beyond a prior swing high (+1) or low (-1)"""
    hi,lo,cl=df.high.values,df.low.values,df.close.values
    sh,sl=swings(hi,lo)
    last=0
    for i in range(len(df)):
        ph=[hi[j] for j in sh if j<i-1]; pl=[lo[j] for j in sl if j<i-1]
        if ph and cl[i]>ph[-1]: last=+1
        if pl and cl[i]<pl[-1]: last=-1
    return last
def levels_for(d, dprev):
    L={}
    if dprev in daily: L['PDH']=daily[dprev]['high']; L['PDL']=daily[dprev]['low']
    on=m1[(m1.index>=pd.Timestamp(f'{dprev} 18:00',tz=ET))&(m1.index<pd.Timestamp(f'{d} 09:30',tz=ET))]
    if len(on): L['ONH']=on.high.max(); L['ONL']=on.low.min()
    # 4h swings over last 10 days
    h=h4[(h4.index<pd.Timestamp(f'{d} 09:30',tz=ET))&(h4.index>=pd.Timestamp(f'{d} 09:30',tz=ET)-pd.Timedelta(days=12))]
    sh,sl=swings(h.high.values,h.low.values)
    for n,i in enumerate(sh[-3:]): L[f'4hH{n}']=h.high.values[i]
    for n,i in enumerate(sl[-3:]): L[f'4hL{n}']=h.low.values[i]
    return L,h
def run(params):
    P=dict(period='all',entry='near',m=2.0,fvg=True,mss='sweepbar',dwin=3,retr=12,sweep='failed',failk=3,bias='4h',R=2.0,tgt='fixed',tick=0.0,fill='through',cut='15:55',levels='all',minpoke=0.0)
    P.update(params)
    trades=[];stats=dict(n_sweeps=0,n_disp=0,n_fill=0)
    for di in range(1,len(days)):
        d=days[di]; dprev=days[di-1]
        if d not in daily or dprev not in daily: continue
        if P['period']=='A' and str(d)>='2026-07-01': continue
        if P['period']=='B' and str(d)<'2026-07-01': continue
        L,h=levels_for(d,dprev)
        if not L: continue
        b4=bias_from(h) if len(h)>10 else 0
        dl=dd[dd.index<d].tail(40)
        bd=bias_from(dl) if len(dl)>10 else 0
        if P['bias']=='4h': allowed={+1:'long',-1:'short',0:'both'}[b4]
        elif P['bias']=='combo': allowed = {+1:'long',-1:'short',0:'both4h'}[b4] if b4==bd else ('both4h')
        elif P['bias']=='daily': allowed={+1:'long',-1:'short',0:'both'}[bd]
        else: allowed='both'
        bars=m5[(m5.index.date==d)&(m5.index.time>=pd.Timestamp('09:30').time())&(m5.index.time<pd.Timestamp(P['cut']).time())]
        if len(bars)<20: continue
        pre=m5[(m5.index.date==d)&(m5.index<bars.index[0])].tail(20)
        allb=pd.concat([pre,bars])
        o,hi,lo,c=allb.open.values,allb.high.values,allb.low.values,allb.close.values
        idx=allb.index; n0=len(pre)
        intr=dict(L)
        taken_levels=set(); traded=0; losses=0; inpos_until=None
        for i in range(n0,len(allb)):
            t=idx[i].time()
            if t>=pd.Timestamp('11:30').time(): break
            if inpos_until is not None and idx[i]<inpos_until: continue
            if losses>=2: break
            # intraday levels
            if t>=pd.Timestamp('09:35').time():
                intr['ORH']=hi[n0]; intr['ORL']=lo[n0]
                if P['levels']=='all':
                    intr['SH']=hi[n0:i].max(); intr['SL']=lo[n0:i].min()
            for name,lv in list(intr.items()):
                if (name,lv) in taken_levels: continue
                for side in ('short','long'):
                    # short: sweep of a high; long: sweep of a low
                    if side=='short':
                        if not (hi[i]>lv+P['minpoke'] and c[i]<lv): continue
                        if P['sweep']=='strict':
                            if c[i-1]>lv: continue
                            wick=hi[i]; sb=i
                        else:
                            # allow prior up to failk closes above: find excursion start
                            j=i-1; k=0
                            while k<P['failk'] and c[j]>lv: j-=1;k+=1
                            if c[j]>lv: continue
                            wick=hi[j+1:i+1].max(); sb=i
                    else:
                        if not (lo[i]<lv-P['minpoke'] and c[i]>lv): continue
                        if P['sweep']=='strict':
                            if c[i-1]<lv: continue
                            wick=lo[i]; sb=i
                        else:
                            j=i-1;k=0
                            while k<P['failk'] and c[j]<lv: j-=1;k+=1
                            if c[j]<lv: continue
                            wick=lo[j+1:i+1].min(); sb=i
                    if name in('SH','SL') and P['levels']!='all': continue
                    stats['n_sweeps']+=1
                    ok_bias = allowed in('both',side) or (allowed=='both4h' and name.startswith('4h'))
                    if not ok_bias: continue
                    # displacement within dwin bars after (incl.) sweep bar
                    avgb=np.mean(np.abs(c[sb-20:sb]-o[sb-20:sb]))
                    disp=None
                    for k in range(sb,min(sb+1+P['dwin'],len(allb))):
                        body=c[k]-o[k] if side=='long' else o[k]-c[k]
                        if body<P['m']*avgb: continue
                        if k==sb and body<P['m']*avgb: continue
                        if P['fvg'] and k+1<len(allb):
                            gap = (lo[k+1]-hi[k-1]) if side=='long' else (lo[k-1]-hi[k+1])
                            if gap<=0: continue
                        # MSS
                        if P['mss']=='swing':
                            # last 3-bar swing low (short) inside the last 8 bars before sb, else sweep bar extreme
                            ref=None
                            for q in range(sb-1,max(sb-8,1),-1):
                                if side=='short' and lo[q]<lo[q-1] and lo[q]<lo[q+1]: ref=lo[q];break
                                if side=='long' and hi[q]>hi[q-1] and hi[q]>hi[q+1]: ref=hi[q];break
                            if ref is None: ref=lo[sb] if side=='short' else hi[sb]
                        elif P['mss']=='sweepbar': ref=lo[sb] if side=='short' else hi[sb]
                        else: ref=None
                        if ref is not None and not ((c[k]<ref) if side=='short' else (c[k]>ref)): continue
                        disp=k;break
                    if disp is None: continue
                    stats['n_disp']+=1
                    k=disp
                    # zone: FVG between hi[k-1] and lo[k+1] (long) else OB
                    if P['fvg'] and k+1<len(allb):
                        z=(hi[k-1],lo[k+1]) if side=='long' else (hi[k+1],lo[k-1])
                    else:
                        # OB: last opposite bar before disp
                        q=k-1
                        while q>0 and ((c[q]>o[q]) if side=='long' else (c[q]<o[q])): q-=1
                        z=(min(o[q],c[q]),max(o[q],c[q]))
                    zlo,zhi=min(z),max(z)
                    if P['entry']=='mid': entry=(zlo+zhi)/2
                    elif P['entry']=='near': entry = zhi if side=='long' else zlo
                    elif P['entry']=='far': entry = zlo if side=='long' else zhi
                    elif P['entry']=='level': entry = lv
                    elif P['entry']=='close': entry = c[k]
                    # tick: move a limit inside the zone, away from the near edge, to make the fill likelier
                    if P['entry'] in ('near','mid') and P['tick']:
                        entry = entry-P['tick'] if side=='long' else entry+P['tick']
                    stop = wick-0.5 if side=='long' else wick+0.5
                    risk=abs(entry-stop)
                    if risk<=0.5: continue
                    tgt = entry+P['R']*risk if side=='long' else entry-P['R']*risk
                    if P['tgt'] in ('level','htf'):
                        # nearest level on the far side of the entry; 'htf' ignores intraday levels
                        cand=[v for nm,v in intr.items() if (P['tgt']=='level' or nm not in('ORH','ORL','SH','SL'))
                              and ((v>entry+0.5) if side=='long' else (v<entry-0.5))]
                        if cand:
                            nearest=min(cand) if side=='long' else max(cand)
                            if abs(nearest-entry)<P['R']*risk: continue
                            tgt=nearest
                    if P['tgt']=='htfcap':
                        # fixed 2R, but a daily/4h level between 2R and 3R becomes the target
                        cand=[v for nm,v in intr.items() if nm not in('ORH','ORL','SH','SL') and ((v>entry) if side=='long' else (v<entry))]
                        for v in sorted(cand, key=lambda v: abs(v-entry)):
                            if P['R']*risk<=abs(v-entry)<=3*risk: tgt=v;break
                    # wait for fill in next retr bars (1m granularity)
                    t0=idx[k]+pd.Timedelta(minutes=10 if P['fvg'] else 5)
                    tend=pd.Timestamp(f'{d} {P["cut"]}',tz=ET)
                    f1=m1[(m1.index>=t0)&(m1.index<tend)]
                    fill_t=None; res=None
                    for ti,(fo,fh,fl,fc) in enumerate(zip(f1.open,f1.high,f1.low,f1.close)):
                        tt=f1.index[ti]
                        if fill_t is None:
                            if tt>idx[k]+pd.Timedelta(minutes=5*P['retr']): break
                            touched = ((fl<=entry) if side=='long' else (fh>=entry)) if P['fill']=='touch' else ((fl<entry) if side=='long' else (fh>entry))
                            if touched:
                                fill_t=tt
                                # same-bar stop check
                                if (fl<=stop) if side=='long' else (fh>=stop): res=('stop',tt);break
                                continue
                            # cancel if close beyond far edge
                            if (fc<zlo) if side=='long' else (fc>zhi): break
                        else:
                            hit_s=(fl<=stop) if side=='long' else (fh>=stop)
                            hit_t=(fh>=tgt) if side=='long' else (fl<=tgt)
                            if hit_s: res=('stop',tt);break
                            if hit_t: res=('target',tt);break
                    if fill_t is None: continue
                    stats['n_fill']+=1
                    if res is None:
                        last=f1.close.iloc[-1]; pnlR=((last-entry) if side=='long' else (entry-last))/risk; res=('eod',f1.index[-1])
                    else: pnlR = abs(tgt-entry)/risk if res[0]=='target' else -1.0
                    trades.append(dict(day=str(d),level=name,side=side,sweep=str(idx[sb].time())[:5],entry=round(entry,1),stop=round(stop,1),risk=round(risk,1),res=res[0],R=round(pnlR,2)))
                    taken_levels.add((name,lv)); traded+=1
                    if pnlR<0: losses+=1
                    inpos_until=res[1]
                    break
                else: continue
                break
    tr=pd.DataFrame(trades)
    summ=dict(P, **stats, trades=len(tr), sumR=round(tr.R.sum(),1) if len(tr) else 0, win=round((tr.R>0).mean(),2) if len(tr) else 0)
    return summ,tr
if __name__=='__main__':
    grid=json.loads(sys.argv[2]) if len(sys.argv)>2 else [{}]
    for g in grid:
        s,tr=run(g)
        print(json.dumps(s))
        if '--trades' in sys.argv: print(tr.to_string())
