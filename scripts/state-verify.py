#!/usr/bin/env python3
"""Fast, focused verification of known Bhu-Naksha configs. Short timeouts, N passes."""
import urllib.request as U, urllib.parse as P, ssl, json, re, sys, time, concurrent.futures as CF
ctx=ssl.create_default_context(); ctx.check_hostname=False; ctx.verify_mode=ssl.CERT_NONE
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36"
T=9
# name, url-base, generation, state-code   (discovered by prior probing)
CFG=[
 ("Andhra Pradesh","https://bhunaksha.ap.gov.in/bhunakshalpm","classic","28"),
 ("Assam","https://bhunaksha.assam.gov.in","classic","18"),
 ("Bihar","https://bhunaksha.bihar.gov.in","classic","10"),
 ("Chandigarh","https://bhunaksha.chd.gov.in","classic","04"),
 ("Chhattisgarh","https://bhunaksha.cg.nic.in","classic","22"),
 ("Goa","https://bhunaksha.goa.gov.in/bhunaksha","classic","30"),
 ("Kerala","https://emaps.kerala.gov.in","classic","32"),
 ("Lakshadweep","https://bhunaksha.utl.gov.in/bhunaksha","classic","31"),
 ("Odisha","https://bhunakshaodisha.nic.in/bhunaksha","classic","21"),
 ("Punjab","https://gisbhunaksha.punjab.gov.in","classic","03"),
 ("Rajasthan","https://bhunaksha.rajasthan.gov.in/Viewmap","classic","08"),
 ("Sikkim","https://bhunaksha.sikkimlrdm.gov.in","classic","11"),
 ("Tamil Nadu","https://collabland-tn.gov.in","classic","33"),
 ("Tripura","https://bhunaksha.tripura.gov.in/bhunaksha","classic","16"),
 ("Haryana","https://maps.revenueharyana.gov.in","angular","06"),
 ("Himachal Pradesh","https://bhunakshahp.nic.in","angular","02"),
 ("Jammu & Kashmir","https://bhunaksha.jk.gov.in","angular","01"),
 ("Jharkhand","https://jharbhunaksha.jharkhand.gov.in","angular","20"),
 ("Maharashtra","https://mahabhunakasha.mahabhumi.gov.in","angular","27"),
 ("Uttar Pradesh","https://upbhunaksha.gov.in","angular","09"),
]
def rq(url,data=None,ref=None):
    r=U.Request(url,data=data.encode() if data is not None else None,headers={"User-Agent":UA})
    if ref: r.add_header("Referer",ref)
    if data is not None: r.add_header("Content-Type","application/x-www-form-urlencoded")
    try:
        x=U.urlopen(r,timeout=T,context=ctx); return x.getcode(), x.read().decode('utf-8','replace')
    except Exception as e:
        c=getattr(e,'code',None)
        if c:
            try: return c,e.read().decode('utf-8','replace')[:150]
            except: return c,""
        return 0,str(e)[:45]
def check(cfg):
    name,base,gen,code=cfg
    o={"name":name,"base":base,"gen":gen,"code":code,"ok":False,"dists":0,"levels":"","sample":"","wms":None,"geo":None,"err":""}
    if gen=="angular":
        B=base+"/bhunakshaserver"; ref=base+"/home/"
        c,b=rq(B+"/Levels/stateCode",ref=ref)
        if c!=200 or not b.strip().strip('"').isdigit(): o["err"]=f"stateCode={c}"; return o
        o["code"]=b.strip().strip('"')
        _,lb=rq(B+"/Levels/levelLabels",ref=ref); o["levels"]=lb.strip()[:40]
        c2,d=rq(B+"/masterdata/levelvalue",data=P.urlencode({"codes":"1","level":"1"}),ref=ref)
        if c2==200 and d.strip().startswith("["):
            try:
                j=json.loads(d); o["dists"]=len(j)
                o["sample"]=", ".join(f'{x["code"]}={x["value"]}' for x in j[:2])
            except: pass
        o["ok"]=True; return o
    c,b=rq(base+"/")
    src=b if c==200 else ""
    m=re.search(r'id="state"[^>]*value="(\d+)"',src) or re.search(r'value="(\d+)"[^>]*id="state"',src)
    if m: o["code"]=m.group(1)
    c2,b2=rq(base+"/ScalarDatahandler?"+P.urlencode({"OP":"2","level":"1","selections":"","state":o["code"]}),ref=base+"/")
    if not(c2==200 and ("level_1" in b2 or "<select" in b2)): o["err"]=f"root={c} api={c2}"; return o
    pick = src if 'id="level_1"' in src else b2
    m2=re.search(r'id="level_1".*?</select>',pick,re.S)
    opts=re.findall(r'<option value="([^"]*)"[^>]*>\s*([^<]{0,22})',m2.group(0)) if m2 else []
    o["dists"]=len(opts); o["sample"]=", ".join(f"{a}={c_.strip()}" for a,c_ in opts[:2])
    labs=re.findall(r'([A-Za-z][A-Za-z ]{1,18})&nbsp;:',pick); o["levels"]="/".join(x.strip() for x in labs[:6])[:40]
    c3,_=rq(base+"/WMS?"+P.urlencode({"SERVICE":"WMS","VERSION":"1.1.1","REQUEST":"GetMap","FORMAT":"image/png",
        "LAYERS":"VILLAGE_MAP","transparent":"true","state":o["code"],"gis_code":"x","SRS":"EPSG:4326",
        "BBOX":"0,0,1,1","WIDTH":"32","HEIGHT":"32"}),ref=base+"/")
    c4,_=rq(base+"/rest/MapInfo/getPointsfromPNIU",data=f'state={o["code"]}&pniu=X&gisCode=X',ref=base+"/")
    o["wms"]=(c3==200); o["geo"]=(c4 in (200,204)); o["ok"]=True
    return o
N=int(sys.argv[1]) if len(sys.argv)>1 else 3
hist={}
for p in range(N):
    with CF.ThreadPoolExecutor(max_workers=10) as ex:
        for r in ex.map(check,CFG): hist.setdefault(r["name"],[]).append(r)
    print(f"pass {p+1}/{N} done: {sum(1 for n in hist if hist[n][-1]['ok'])}/{len(CFG)} ok",flush=True)
    if p<N-1: time.sleep(3)
rows=[]
for n,runs in hist.items():
    g=[r for r in runs if r["ok"]]; b=(g[0] if g else runs[0]).copy()
    b["score"]=f"{len(g)}/{len(runs)}"; b["stable"]=(len(g)==len(runs)); rows.append(b)
ok=[r for r in rows if r["ok"]]
print(f"\n{'='*130}\nVERIFIED: {len(ok)}/{len(rows)} states have a working API   ({N} passes)\n{'='*130}")
print(f'{"STATE/UT":<19}{"GEN":<9}{"ST":<5}{"PASS":<7}{"DIST":<6}{"WMS":<5}{"GEO":<5}{"LEVELS":<34}SAMPLE')
print("-"*130)
for r in sorted(ok,key=lambda z:(-int(z["score"][0]),z["name"])):
    w="Y" if r["wms"] else ("-" if r["wms"] is False else "n/a")
    g="Y" if r["geo"] else ("-" if r["geo"] is False else "n/a")
    flag="" if r["stable"] else "  ⚠FLAPPING"
    print(f'{r["name"]:<19}{r["gen"]:<9}{r["code"]:<5}{r["score"]:<7}{r["dists"]:<6}{w:<5}{g:<5}{r["levels"][:32]:<34}{r["sample"][:26]}{flag}')
bad=[r for r in rows if not r["ok"]]
print(f'\nNOT WORKING ({len(bad)}):')
for r in sorted(bad,key=lambda z:z["name"]): print(f'  {r["name"]:<19}{r["base"].split("//")[1][:44]:<46}{r["err"]}')
json.dump(rows,open("/tmp/fast.json","w"),indent=1,ensure_ascii=False)
