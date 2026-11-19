import json, numpy as np, pandas as pd
from load import rd
import warnings; warnings.filterwarnings("ignore")

# ---------- inputs ----------
T1,R1,P1=[rd(f"{v}-dailymean-GID1-cleaned") for v in ("temp","relhumid","precip")]
T0,R0,P0=[rd(f"{v}-dailymean-countries-cleaned") for v in ("temp","relhumid","precip")]
F1=rd("annual-mean-temperature-forecast-GID1"); F0=rd("annual-mean-temperature-forecast-countries")
names=pd.read_csv("gid1_names.csv")
gid1_iso=set(names.GID_0)

ne=json.load(open("raw/ne/geojson/ne_50m_admin_0_countries.geojson"))
nen={}
for f in ne["features"]:
    p=f["properties"]
    for n in ("NAME","NAME_LONG","ADMIN","NAME_EN","FORMAL_EN","NAME_SORT","GEOUNIT","SUBUNIT"):
        if p.get(n): nen[str(p[n]).replace(" ","_")]=p["ADM0_A3"]
k2=dict(zip(names.NAME_0.str.replace(" ","_"),names.GID_0))
def iso_of(k): return k2.get(k) or nen.get(k)

# country-level rows only for countries without admin-1 polygons
drop={"Antarctica","Caspian_Sea","Bouvet_Island","Heard_Island_and_McDonald_Islands","South_Georgia_and_the_South_Sandwich_Islands","French_Southern_Territories","Clipperton_Island","Paracel_Islands","Spratly_Islands"}
c_rows=[k for k in T0.index if k not in drop and iso_of(k) and iso_of(k) not in gid1_iso]
print("country-level fallback units:",len(c_rows))

def stack(A1,A0):
    a0=A0.loc[c_rows].copy(); a0.index=["C."+iso_of(k) for k in c_rows]
    return pd.concat([A1,a0])
T=stack(T1,T0); R=stack(R1,R0); P=stack(P1,P0)
F0c=F0.reindex(c_rows); F0c.index=["C."+iso_of(k) for k in c_rows]
F=pd.concat([F1,F0c]).reindex(T.index)
dates=pd.to_datetime(T.columns); months=dates.month.values; nyears=len(set(dates.year))

# ---------- bias adjustment ----------
base_cols=[c for c in F.columns if c.endswith("ssp245_2021-2040")]
wc_base=F[base_cols].median(axis=1)
offset=(wc_base-T.mean(axis=1))
# fallback: national median offset, else 0
iso=pd.Series([i.split(".")[0] if not i.startswith("C.") else i[2:] for i in T.index],index=T.index)
nat_off=offset.groupby(iso).transform("median")
offset=offset.fillna(nat_off).fillna(0)
Tadj=T.values+offset.values[:,None]
RH=np.clip(R.values,1,100)
PR=np.clip(P.values*24000,0,None)  # mm/day

def humidex(Tc):
    e=RH/100*6.105*np.exp(17.27*Tc/(237.7+Tc))
    return Tc+0.5555*(e-10)

PROFILES={"sight":(15,24),"beach":(23,30),"any":(15,30)}
RAIN_MAX=5.0
HOT=42.0   # daily-mean humidex threshold for heat stress

def metrics(dT):
    TT=Tadj+dT[:,None]
    HX=humidex(TT)
    dry=PR<=RAIN_MAX
    hot=HX>=HOT
    out={}
    for k,(lo,hi) in PROFILES.items():
        ok=(TT>=lo)&(TT<=hi)&dry&~hot
        out[k]=ok.sum(1)/nyears
        out[k+"_m"]=np.stack([ok[:,months==m].sum(1)/nyears for m in range(1,13)],1)
    out["hot"]=hot.sum(1)/nyears
    out["hot_m"]=np.stack([hot[:,months==m].sum(1)/nyears for m in range(1,13)],1)
    out["T"]=TT.mean(1)
    out["Tm"]=np.stack([TT[:,months==m].mean(1) for m in range(1,13)],1)
    out["Pm"]=np.stack([PR[:,months==m].sum(1)/nyears for m in range(1,13)],1)
    return out

base=metrics(np.zeros(len(T)))

SCEN=["ssp126","ssp245","ssp585"]; PER=["2041-2060","2081-2100"]
models=sorted(set(c.split("_")[0] for c in F.columns))
fut={}
for s in SCEN:
    for p in PER:
        runs=[]; dts=[]
        for m in models:
            a=f"{m}_{s}_{p}"; b=f"{m}_{s}_2021-2040"
            if a in F and b in F:
                dT=(F[a]-F[b]).values
                dT=np.where(np.isnan(dT),np.nanmedian(dT),dT)
                dts.append(dT); runs.append(metrics(dT))
        dmed=np.median(np.stack(dts),0)
        med=metrics(dmed)
        res={"dT":dmed,"n":len(runs)}
        for k in ("sight","beach","any","hot"):
            arr=np.stack([r[k] for r in runs])
            res[k]=np.median(arr,0); res[k+"_lo"]=arr.min(0); res[k+"_hi"]=arr.max(0)
            res[k+"_m"]=med[k+"_m"]
        fut[f"{s}_{p}"]=res
        print(s,p,"models",len(runs),"median dT global",np.round(np.median(dmed),2))

np.save("ids.npy",np.array(T.index))
pd.to_pickle({"ids":list(T.index),"iso":iso.tolist(),"base":base,"fut":fut,"offset":offset.values,"c_rows":{"C."+iso_of(k):k for k in c_rows}},"metrics.pkl")
