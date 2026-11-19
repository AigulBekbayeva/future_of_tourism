# add region / country areas (km²) to the data files — used to filter ranked lists and to mark small states
import json, pandas as pd
a = pd.read_csv("geo/gid1_area.csv").set_index("GID_1").area_km2
ne = pd.read_csv("geo/ne_area.csv").drop_duplicates("iso").set_index("iso").area
c = json.load(open("../data/climate.json"))
c["area"] = [int(ne.get(i[2:], 0)) if i.startswith("C.") else int(a.get(i, 0)) for i in c["ids"]]
json.dump(c, open("../data/climate.json", "w"), separators=(",", ":"), ensure_ascii=False)
e = json.load(open("../data/economy.json"))
for k, v in e.items(): v["area"] = int(ne.get(k, 0))
json.dump(e, open("../data/economy.json", "w"), separators=(",", ":"), ensure_ascii=False)
