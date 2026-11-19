#!/usr/bin/env bash
# Rebuilds everything in ../data from open sources.
# Needs: git, python3 (pandas numpy pyreadr dbfread), node (npx mapshaper).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p raw geo

clone() { # repo dir paths...
  local repo=$1 dir=$2; shift 2
  [ -d "raw/$dir" ] || GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 --filter=blob:none --no-checkout "https://github.com/$repo" "raw/$dir"
  git -C "raw/$dir" checkout HEAD -- "$@"
}
clone pearselab/areadata areadata \
  output/temp-dailymean-GID1-cleaned.RDS output/precip-dailymean-GID1-cleaned.RDS output/relhumid-dailymean-GID1-cleaned.RDS \
  output/temp-dailymean-countries-cleaned.RDS output/precip-dailymean-countries-cleaned.RDS output/relhumid-dailymean-countries-cleaned.RDS \
  output/annual-mean-temperature-forecast-GID1.RDS output/annual-mean-temperature-forecast-countries.RDS \
  output/population-density-GID1.RDS data/name-matching.csv \
  data/gis/gadm-states.shp data/gis/gadm-states.dbf data/gis/gadm-states.shx data/gis/gadm-states.prj
clone datasets/world-development-indicators wdi \
  indicators/st.int.rcpt.xp.zs/data.csv indicators/ne.exp.gnfs.zs/data.csv indicators/sp.pop.totl/data.csv \
  indicators/ny.gdp.mktp.cd/data.csv indicators/ny.gdp.pcap.cd/data.csv
clone nvkelso/natural-earth-vector ne geojson/ne_50m_admin_0_countries.geojson

python3 names.py
python3 compute.py                      # -> metrics.pkl

# geometry
python3 -c "import pandas as pd; M=pd.read_pickle('metrics.pkl'); print(','.join(k[2:] for k in M['ids'] if k.startswith('C.')))" > geo/fallback.txt
FB=$(cat geo/fallback.txt)
npx -y mapshaper -i raw/areadata/data/gis/gadm-states.shp encoding=latin1 \
  -each 'area_km2=Math.round(this.area/1e6)' -o geo/gid1_area.csv \
  -filter-fields GID_0,GID_1,NAME_0,NAME_1 -rename-fields id=GID_1,iso=GID_0,country=NAME_0,name=NAME_1 \
  -simplify 3% weighted keep-shapes -o geo/gid1.json format=geojson precision=0.001
npx -y mapshaper -i raw/ne/geojson/ne_50m_admin_0_countries.geojson \
  -each "keep='$FB'.split(',').indexOf(ADM0_A3)>=0" -filter keep \
  -each 'id="C."+ADM0_A3; iso=ADM0_A3; country=NAME_LONG; name=NAME_LONG' -filter-fields id,iso,country,name \
  -o geo/fb.json format=geojson precision=0.001
npx -y mapshaper -i geo/gid1.json geo/fb.json combine-files -merge-layers name=regions \
  -o geo/regions.topo.json format=topojson quantization=100000 id-field=id
npx -y mapshaper -i raw/ne/geojson/ne_50m_admin_0_countries.geojson \
  -each 'iso=(ISO_A3_EH && ISO_A3_EH!="-99")?ISO_A3_EH:ADM0_A3; name=NAME_LONG; lx=LABEL_X; ly=LABEL_Y; cont=CONTINENT; sub=SUBREGION' \
  -filter 'cont!="Antarctica"' -filter-fields iso,name,lx,ly,cont,sub -simplify 25% weighted keep-shapes \
  -o geo/countries.topo.json format=topojson quantization=100000 id-field=iso
npx -y mapshaper -i raw/ne/geojson/ne_50m_admin_0_countries.geojson \
  -each 'iso=(ISO_A3_EH && ISO_A3_EH!="-99")?ISO_A3_EH:ADM0_A3; area=Math.round(this.area/1e6)' -filter-fields iso,area -o geo/ne_area.csv

python3 build.py                        # -> ../data/*.json
python3 areas.py
echo "done"
