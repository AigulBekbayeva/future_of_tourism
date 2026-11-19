import pyreadr, pandas as pd, numpy as np
P="raw/areadata/output/"
def rd(f): return pyreadr.read_r(P+f+".RDS")[None]
def load():
    T1,R1,P1=[rd(f"{v}-dailymean-GID1-cleaned") for v in ("temp","relhumid","precip")]
    T0,R0,P0=[rd(f"{v}-dailymean-countries-cleaned") for v in ("temp","relhumid","precip")]
    F1=rd("annual-mean-temperature-forecast-GID1"); F0=rd("annual-mean-temperature-forecast-countries")
    nm=pd.read_csv("raw/areadata/data/name-matching.csv",usecols=["GID_0","NAME_0"]).drop_duplicates()
    nm["key"]=nm.NAME_0.str.replace(" ","_")
    k2iso=dict(zip(nm.key,nm.GID_0))
    return T1,R1,P1,T0,R0,P0,F1,F0,k2iso
