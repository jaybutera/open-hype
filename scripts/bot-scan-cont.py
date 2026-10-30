"""Mechanical scan of the break-and-retrace form of bot/models/2022-v4.md: a 5m bar
closing through a level in the bias direction with a body at least m times the 20-bar
average, the FVG it leaves, a limit at the gap's near edge, stop beyond the gap's far
edge ('fvg'), the break bar ('bar') or the leg's origin ('leg'), fixed-R target.

    python3 scripts/bot-scan-cont.py '[{}, {"bias":"4h"}, {"stop":"bar"}]' [--trades]

Loads the recording through bot-scan.py next to it. A calibration aid, not a backtest:
no GEX, no discretion, and the sweep form is in bot-scan.py."""
import sys, os, io, contextlib, json, importlib.util
ARGS=sys.argv[1:]
sys.argv=['x','/home/casper/src/ict-scanner/data/xyz:SP500_1m.parquet']
spec=importlib.util.spec_from_file_location('scan', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bot-scan.py')); sc=importlib.util.module_from_spec(spec)
with contextlib.redirect_stdout(io.StringIO()): spec.loader.exec_module(sc)
import numpy as np, pandas as pd
m1,m5,days,daily,dd=sc.m1,sc.m5,sc.days,sc.daily,sc.dd
GEX={'2026-10-15','2026-10-16','2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23','2026-10-26','2026-10-27','2026-10-28'}
def run(params):
    P=dict(bias='daily',m=2.0,R=2.0,stop='fvg',stoppad=0.5,retr=12,sw0='09:30',sw1='11:30',cut='15:55',levels='all',mingapb=0.0,fallback=0,maxrisk=0,period='all',legbars=6)
    P.update(params)
    trades=[];stats=dict(n_breaks=0,n_fvg=0)
    for di in range(1,len(days)):
        d=days[di]; dprev=days[di-1]
        if d not in daily or dprev not in daily: continue
        if P['period']=='A' and str(d)>='2026-07-01': continue
        if P['period']=='B' and str(d)<'2026-07-01': continue
        L,h=sc.levels_for(d,dprev)
        if not L: continue
        b4=sc.bias_from(h) if len(h)>10 else 0
        dl=dd[dd.index<d].tail(40); bd=sc.bias_from(dl) if len(dl)>10 else 0
        if P['bias']=='4h': allowed={+1:'long',-1:'short',0:'none'}[b4]
        elif P['bias']=='daily': allowed={+1:'long',-1:'short',0:'none'}[bd]
        elif P['bias']=='agree': allowed={+1:'long',-1:'short',0:'none'}[bd] if bd==b4 else 'none'
        else: allowed='both'
        if allowed=='none': continue
        bars=m5[(m5.index.date==d)&(m5.index.time>=pd.Timestamp('09:30').time())&(m5.index.time<pd.Timestamp(P['cut']).time())]
        if len(bars)<20: continue
        pre=m5[(m5.index.date==d)&(m5.index<bars.index[0])].tail(20)
        allb=pd.concat([pre,bars]); o,hi,lo,c=allb.open.values,allb.high.values,allb.low.values,allb.close.values
        idx=allb.index; n0=len(pre); intr=dict(L); used=set(); losses=0; inpos_until=None
        for i in range(n0,len(allb)-1):
            t=idx[i].time()
            if t>=pd.Timestamp(P['sw1']).time(): break
            if t<pd.Timestamp(P['sw0']).time(): continue
            if inpos_until is not None and idx[i]<inpos_until: continue
            if losses>=2: break
            if t>=pd.Timestamp('09:35').time():
                intr['ORH']=hi[n0]; intr['ORL']=lo[n0]
                if P['levels']=='all': intr['SH']=hi[n0:i].max(); intr['SL']=lo[n0:i].min()
            avgb=np.mean(np.abs(c[i-20:i]-o[i-20:i]))
            body=c[i]-o[i]
            for name,lv in list(intr.items()):
                if (name,lv) in used: continue
                if name in('SH','SL'): continue  # a close beyond the session extreme is every trend bar; not a level break
                for side in (('short',) if allowed=='short' else ('long',) if allowed=='long' else ('short','long')):
                    if side=='short':
                        if not (c[i]<lv and c[i-1]>=lv and o[i]>=lv-0.0 and -body>=P['m']*avgb): continue
                    else:
                        if not (c[i]>lv and c[i-1]<=lv and body>=P['m']*avgb): continue
                    stats['n_breaks']+=1
                    k=i
                    gap=(lo[k-1]-hi[k+1]) if side=='short' else (lo[k+1]-hi[k-1])
                    if gap<=0 or gap<P['mingapb']*avgb: used.add((name,lv)); continue
                    stats['n_fvg']+=1
                    if side=='short': zlo,zhi=hi[k+1],lo[k-1]; entry=zlo
                    else: zlo,zhi=hi[k-1],lo[k+1]; entry=zhi
                    if P['stop']=='fvg': stop = zhi+P['stoppad'] if side=='short' else zlo-P['stoppad']
                    elif P['stop']=='bar': stop = hi[k]+P['stoppad'] if side=='short' else lo[k]-P['stoppad']
                    else: # leg origin: extreme of the last legbars before the break bar
                        stop = hi[k-P['legbars']:k+1].max()+P['stoppad'] if side=='short' else lo[k-P['legbars']:k+1].min()-P['stoppad']
                    risk=abs(entry-stop)
                    if risk<=0.5 or (P['maxrisk'] and risk>P['maxrisk']): used.add((name,lv)); continue
                    tgt = entry-P['R']*risk if side=='short' else entry+P['R']*risk
                    t0=idx[k]+pd.Timedelta(minutes=10); tend=pd.Timestamp(f'{d} {P["cut"]}',tz=ET)
                    f1=m1[(m1.index>=t0)&(m1.index<tend)]
                    fill_t=None;res=None
                    for ti,(fo,fh,fl,fc) in enumerate(zip(f1.open,f1.high,f1.low,f1.close)):
                        tt=f1.index[ti]
                        if fill_t is None:
                            if tt>idx[k]+pd.Timedelta(minutes=5*P['retr']): break
                            touched=(fh>entry) if side=='short' else (fl<entry)
                            if touched:
                                fill_t=tt
                                if (fh>=stop) if side=='short' else (fl<=stop): res=('stop',tt);break
                                continue
                            if (fc>zhi) if side=='short' else (fc<zlo): break
                        else:
                            hit_s=(fh>=stop) if side=='short' else (fl<=stop)
                            hit_t=(fl<=tgt) if side=='short' else (fh>=tgt)
                            if hit_s: res=('stop',tt);break
                            if hit_t: res=('target',tt);break
                    used.add((name,lv))
                    if fill_t is None: continue
                    if res is None:
                        last=f1.close.iloc[-1]; pnlR=((entry-last) if side=='short' else (last-entry))/risk; res=('eod',f1.index[-1])
                    else: pnlR=P['R'] if res[0]=='target' else -1.0
                    trades.append(dict(day=str(d),level=name,side=side,brk=str(idx[k].time())[:5],entry=round(entry,1),stop=round(stop,1),risk=round(risk,1),res=res[0],R=round(pnlR,2)))
                    if pnlR<0: losses+=1
                    inpos_until=res[1]
                    break
                else: continue
                break
    tr=pd.DataFrame(trades)
    return dict(P,**stats,trades=len(tr),sumR=round(tr.R.sum(),1) if len(tr) else 0,win=round((tr.R>0).mean(),2) if len(tr) else 0),tr
ET='America/New_York'
grid=json.loads(ARGS[0]) if ARGS and ARGS[0].startswith("[") else (json.loads(open(ARGS[0]).read()) if ARGS and os.path.exists(ARGS[0]) else [{}])
for p in grid:
    s,tr=run(p)
    g=tr[tr.day.isin(GEX)] if len(tr) else tr
    A=tr[tr.day<'2026-07-01'] if len(tr) else tr; B=tr[tr.day>='2026-07-01'] if len(tr) else tr
    print('###',json.dumps(p),'| breaks',s['n_breaks'],'fvg',s['n_fvg'],'| all:',s['trades'],s['sumR'],'win',s['win'],'| A:',len(A),round(A.R.sum(),1) if len(A) else 0,'B:',len(B),round(B.R.sum(),1) if len(B) else 0,'| gex:',len(g),round(g.R.sum(),1) if len(g) else 0)
    if len(g) and '--trades' in ARGS: print(g.to_string())
