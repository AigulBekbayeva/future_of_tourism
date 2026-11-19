import json, numpy as np, pandas as pd
from load import rd
M=pd.read_pickle("metrics.pkl"); ids=M["ids"]; b=M["base"]; fut=M["fut"]
iso_unit=pd.Series(M["iso"],index=ids)
OUT="../data/"
import os; os.makedirs(OUT,exist_ok=True)
GADM2NE={"XKO":"KOS","XCA":None}
def r1(a): return [None if (x is None or np.isnan(x)) else round(float(x),1) for x in a]
def ri(a): return [int(round(float(x))) for x in a]
def mi(A): return [ri(row) for row in A]

topo=json.load(open("geo/regions.topo.json"))
props={g["id"]:g["properties"] for g in topo["objects"]["regions"]["geometries"]}
names=[props.get(i,{}).get("name",i) for i in ids]
ctry=[props.get(i,{}).get("country","") for i in ids]
# drop props from topojson geometries to save bytes (names kept in data file)
for g in topo["objects"]["regions"]["geometries"]: g["properties"]={}
json.dump(topo,open(OUT+"regions.topo.json","w"),separators=(",",":"))

climate={"ids":ids,"name":names,"country":ctry,"iso":M["iso"],
 "base":{"sight":r1(b["sight"]),"beach":r1(b["beach"]),"hot":r1(b["hot"]),"T":r1(b["T"]),
         "sight_m":mi(b["sight_m"]),"beach_m":mi(b["beach_m"]),"hot_m":mi(b["hot_m"]),
         "Tm":[r1(x) for x in b["Tm"]],"Pm":mi(b["Pm"])},
 "fut":{}}
for k,f in fut.items():
    d={"dT":r1(f["dT"]),"n":f["n"]}
    for v in ("sight","beach","hot"):
        d[v]=r1(f[v]); d[v+"_lo"]=r1(f[v+"_lo"]); d[v+"_hi"]=r1(f[v+"_hi"]); d[v+"_m"]=mi(f[v+"_m"])
    climate["fut"][k]=d
json.dump(climate,open(OUT+"climate.json","w"),separators=(",",":"),ensure_ascii=False)

# ---------- country aggregates (population-weighted) ----------
area=pd.read_csv("geo/gid1_area.csv").set_index("GID_1")["area_km2"]
pd1=rd("population-density-GID1")["Pop_density"]
w=pd.Series(1.0,index=ids)
for i in ids:
    if not i.startswith("C."):
        w[i]=max(float(np.nan_to_num(pd1.get(i,0)))*float(area.get(i,0)),1.0)
def agg(arr):
    s=pd.Series(arr,index=ids)
    return (s*w).groupby(iso_unit).sum()/w.groupby(iso_unit).sum()
cagg=pd.DataFrame({"any0":agg(b["any"]),"hot0":agg(b["hot"]),"sight0":agg(b["sight"]),"beach0":agg(b["beach"])})
for k,f in fut.items():
    cagg["any_"+k]=agg(f["any"]); cagg["hot_"+k]=agg(f["hot"])
cagg.index=[GADM2NE.get(i,i) for i in cagg.index]
cagg=cagg[cagg.index.notnull()]

# ---------- WDI ----------
W="raw/wdi/indicators/"
def ind(code): return pd.read_csv(W+code+"/data.csv")
rx=ind("st.int.rcpt.xp.zs"); ex=ind("ne.exp.gnfs.zs")
pop=ind("sp.pop.totl"); gdp=ind("ny.gdp.mktp.cd"); gpc=ind("ny.gdp.pcap.cd")
def latest(df,lo=None,hi=None):
    d=df.dropna(subset=["Value"])
    if lo: d=d[d.Year>=lo]
    if hi: d=d[d.Year<=hi]
    d=d.sort_values("Year").groupby("Country Code").tail(1)
    return d.set_index("Country Code")
r=latest(rx,2015,2019)
e=ex.set_index(["Country Code","Year"])["Value"]
rows={}
P=latest(pop); G=latest(gdp); GP=latest(gpc)
for c in set(r.index)|set(P.index):
    rows[c]={}
for c,row in r.iterrows():
    yr=int(row.Year); xs=e.get((c,yr),np.nan)
    rows[c].update(rx_exp=row.Value, rx_year=yr, exp_gdp=xs, rx_gdp=row.Value*xs/100 if not np.isnan(xs) else np.nan)
for c in P.index: rows[c].update(pop=P.loc[c,"Value"], pop_year=int(P.loc[c,"Year"]))
for c in G.index:
    if c in rows: rows[c].update(gdp=G.loc[c,"Value"], gdp_year=int(G.loc[c,"Year"]))
for c in GP.index:
    if c in rows: rows[c].update(gdppc=GP.loc[c,"Value"])
eco=pd.DataFrame(rows).T
eco.index=["KOS" if i=="XKX" else i for i in eco.index]
eco=eco.join(cagg,how="left")
# keep only codes present in NE geometry
ct=json.load(open("geo/countries.topo.json"))
ne_ids={g["id"]:g["properties"] for g in ct["objects"][list(ct["objects"])[0]]["geometries"]}
print("WDI w/o geometry:",[i for i in eco.index if i not in ne_ids and not pd.isna(eco.loc[i,"rx_exp"])])
print("NE w/o WDI:",[i for i in ne_ids if i not in eco.index])
print("NE w/o climate:",[i for i in ne_ids if i not in cagg.index])
eco=eco[eco.index.isin(ne_ids)]
out={}
for c,row in eco.iterrows():
    d={"name":ne_ids[c]["name"],"lx":ne_ids[c]["lx"],"ly":ne_ids[c]["ly"],"cont":ne_ids[c]["cont"]}
    for k,v in row.items():
        if isinstance(v,(float,np.floating)) and np.isnan(v): continue
        if k in ("pop","gdp"): d[k]=int(v)
        elif k.endswith("_year"): d[k]=int(v)
        else: d[k]=round(float(v),2)
    out[c]=d
json.dump(out,open(OUT+"economy.json","w"),separators=(",",":"),ensure_ascii=False)
for g in ct["objects"][list(ct["objects"])[0]]["geometries"]: g["properties"]={}
json.dump(ct,open(OUT+"countries.topo.json","w"),separators=(",",":"))
print(len(out),"countries")
e2=pd.DataFrame(out).T
print(e2.sort_values("rx_gdp",ascending=False)[["name","rx_exp","rx_gdp","rx_year","pop","any0","any_ssp245_2041-2060","hot0","hot_ssp245_2041-2060"]].head(25).to_string())
