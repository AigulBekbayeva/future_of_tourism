# GADM level-1 names (the shapefile is latin-1 encoded)
import pandas as pd
from dbfread import DBF
st = pd.DataFrame(iter(DBF("raw/areadata/data/gis/gadm-states.dbf", encoding="latin1")))
st[["GID_0", "NAME_0", "GID_1", "NAME_1"]].to_csv("gid1_names.csv", index=False)
