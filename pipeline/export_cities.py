"""Pack GeoNames cities (pop > 15k) into a compact file the browser can load.
GeoNames data is CC BY 4.0, https://www.geonames.org/

usage: python pipeline/export_cities.py web/geo/cities.json
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).parent
countries = {}
for line in open(HERE / "geonames/countryInfo.txt", encoding="utf8"):
    if not line.startswith("#"):
        f = line.rstrip("\n").split("\t")
        countries[f[0]] = f[4]
name, cc, lat, lon, pop = [], [], [], [], []
for line in open(HERE / "geonames/cities15000.txt", encoding="utf8"):
    f = line.split("\t")
    if f[7] in ("PPLX", "PPLH"):  # city districts and historical places
        continue
    name.append(f[1]); cc.append(f[8]); lat.append(round(float(f[4]), 4)); lon.append(round(float(f[5]), 4)); pop.append(int(f[14] or 0))
json.dump(dict(source="GeoNames cities15000, CC BY 4.0", countries=countries, name=name, cc=cc, lat=lat, lon=lon, pop=pop),
          open(sys.argv[1], "w"), ensure_ascii=False, separators=(",", ":"))
print(len(name), "cities")
