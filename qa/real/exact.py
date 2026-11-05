import json, math
d=json.load(open(__import__('os').path.join(__import__('os').path.dirname(__file__),'real-2026-11-04.json')))
PUB={k.split('|')[0]:(v['payout']-v['ask'])/v['ask'] for k,v in d['quotes']['R_100'].items() if k.endswith('|10|1')}
MARK={k:(1+v)*0.945-1 for k,v in PUB.items()}
seqs=[[int(c) for c in t['digits']] for t in d['ticks'].values()]
def r2(x): return round(x+1e-9,2)
def win(k,x):
    t,_,b=k.partition(':')
    if t=='DIGITEVEN': return x%2==0
    if t=='DIGITODD': return x%2==1
    return x>int(b) if t=='DIGITOVER' else x<int(b)
class DigitSwitcher:  # exact: Under 5 / Over 5 by loss count & parity; stake +=stake*1.1 after >=2 losses up to 12; TP10 SL1000
    TP,SL=10,1000
    def __init__(s): s.stake=1; s.lc=0
    def order(s,h):
        if not h: return None
        ev=h[-1]%2==0; lc=s.lc
        for n,par,typ in [(8,False,'DIGITUNDER:5'),(7,True,'DIGITUNDER:5'),(6,False,'DIGITUNDER:5'),(5,True,'DIGITUNDER:5'),(4,False,'DIGITOVER:5'),(3,True,'DIGITOVER:5'),(2,False,'DIGITOVER:5'),(1,True,'DIGITOVER:5')]:
            if lc>n and ev==par: return (typ,s.stake)
        if ev: return ('DIGITUNDER:5',s.stake)
        return None
    def res(s,w,a):
        if w: s.lc=0; s.stake=1
        else:
            s.lc+=1
            if s.lc>=2:
                if s.lc<=12: s.stake=r2(s.stake*2.1)
                else: s.stake=1
class GoldPremium:    # exact: last 5 >=80% parity & last matches; stake += stake*1.2 from 1st loss up to 10; TP1000 SL1000
    TP,SL=1000,1000
    def __init__(s): s.stake=1; s.lc=0
    def order(s,h):
        if len(h)<5: return None
        e=sum(x%2==0 for x in h[-5:])*20
        if e>=80 and h[-1]%2==0: return ('DIGITEVEN',s.stake)
        if 100-e>=80 and h[-1]%2==1: return ('DIGITODD',s.stake)
        return None
    def res(s,w,a):
        if w: s.lc=0; s.stake=1
        else:
            s.lc+=1
            s.stake=r2(s.stake*2.2) if s.lc<=10 else 1
class ProfitMaker:    # exact: Over 2, after a loss Over 4 with last stake x2.2, no level cap; TP5 SL1000
    TP,SL=5,1000
    def __init__(s): s.stake=1; s.loss=0
    def order(s,h): return ('DIGITOVER:4' if s.loss else 'DIGITOVER:2', s.stake)
    def res(s,w,a):
        if w: s.stake=1; s.loss=0
        else: s.loss+=1; s.stake=r2(a*2.2)
class DollarPrinter:  # exact: Over 0 if >=90% of last 15 non-zero; after a loss Over 5 (if >=40% of last 15 above 5) with TotalLost*1.25; TP10, no SL
    TP,SL=10,10**9
    def __init__(s): s.s1=True; s.tl=0; s.stake=1
    def order(s,h):
        if len(h)<15: return None
        w=h[-15:]
        if s.s1: return ('DIGITOVER:0',s.stake) if sum(x>0 for x in w)*100/15>=90 else None
        return ('DIGITOVER:5',s.stake) if sum(x>5 for x in w)*100/15>=40 else None
    def res(s,w,a):
        R=s.R
        if not w:
            s.tl+=a
            if s.s1: s.s1=False
        else:
            s.tl-= r2(a*R['DIGITOVER:0' if s.s1 else 'DIGITOVER:5'])
            if s.tl<0: s.tl=0
            if not s.s1: s.s1=True
        s.stake = max(1, r2(s.tl*1.25)) if s.tl>0 else 1
def run(B,R,cap=10000):
    ses=tp=0; net=0; worst=0; maxst=0; busts=0
    for D in seqs:
        b=B(); b.R=R; pl=0
        for i in range(len(D)):
            if pl>=B.TP or pl<=-B.SL or pl<=-cap:
                ses+=1; net+=pl; worst=min(worst,pl); tp+=pl>=B.TP; busts+= pl<=-cap; b=B(); b.R=R; pl=0
            o=b.order(D[max(0,i-30):i])
            if o is None: continue
            k,a=o; a=max(0.35,min(a,cap+pl)); maxst=max(maxst,a)
            w=win(k,D[i]); pl=r2(pl+(r2(a*R[k]) if w else -a)); b.res(w,a)
    return ses,tp,net,worst,maxst,busts
for name,B in [('Digit Switcher',DigitSwitcher),('Gold Premium',GoldPremium),('Profit Maker',ProfitMaker),('Dollar Printer',DollarPrinter)]:
    for pn,R in [('public',PUB),('yours',MARK)]:
        s,t,n,w,m,bu=run(B,R)
        print(f"{name:15s} {pn:6s} TP {B.TP:>4} SL {min(B.SL,10000):>5}  sessions {s:6d} target {t/max(1,s):6.1%}  avg/session {n/max(1,s):9.2f}  worst {w:8.0f}  biggest stake {m:7.0f}  account emptied {bu}")
