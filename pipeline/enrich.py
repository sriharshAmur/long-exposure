"""Give homes and frequent places real names using OpenStreetMap's Nominatim
(free, 1 request per second). Results are cached so each coordinate is only
ever looked up once. Your own names in pipeline/home_names.json win.

usage: .venv/bin/python pipeline/enrich.py web/data/data.json [max_places] [--cache FILE] [--names FILE] [--offline]
"""
import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
CACHE = HERE / "cache" / "nominatim.json"
OFFLINE = False
UA = "long-exposure-timeline/1.0 (personal, non-commercial)"


def load_cache():
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    return json.loads(CACHE.read_text()) if CACHE.exists() else {}


def reverse(cache, lat, lon):
    k = f"{lat:.5f},{lon:.5f}"
    if k in cache:
        return cache[k]
    if OFFLINE:
        return None
    q = urllib.parse.urlencode(dict(format="jsonv2", lat=lat, lon=lon, zoom=18, addressdetails=1,
                                    namedetails=0, **{"accept-language": "en"}))
    req = urllib.request.Request(f"https://nominatim.openstreetmap.org/reverse?{q}", headers={"User-Agent": UA})
    for attempt in range(3):
        try:
            r = json.load(urllib.request.urlopen(req, timeout=20))
            break
        except Exception as e:  # network hiccup or rate limit: back off
            print("  retry", k, e)
            time.sleep(5 * (attempt + 1))
    else:
        return None
    a = r.get("address", {})
    out = dict(
        name=r.get("name") or "",
        cat=r.get("category", ""), type=r.get("type", ""),
        road=a.get("road") or a.get("pedestrian") or a.get("footway") or "",
        hood=a.get("neighbourhood") or a.get("residential") or a.get("quarter") or a.get("suburb") or "",
        suburb=a.get("suburb") or a.get("city_district") or "",
        city=a.get("city") or a.get("town") or a.get("village") or "",
    )
    cache[k] = out
    CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=0))
    time.sleep(1.1)
    return out


def main(path, max_places=220, names=HERE / "home_names.json"):
    data = json.loads(Path(path).read_text())
    cache = load_cache()
    overrides = {}
    hn = Path(names)
    if hn.exists():
        overrides = {int(k): v for k, v in json.loads(hn.read_text()).items() if not k.startswith("_")}

    for i, h in enumerate(data["homes"], 1):
        o = reverse(cache, h["lat"], h["lon"]) or {}
        h["osm"] = o
        mine = overrides.get(i, {})
        h["name"] = mine.get("name") or o.get("road") or o.get("hood") or h["city"]
        h["hood"] = mine.get("hood") or o.get("hood") or o.get("suburb") or ""
        print(f"home {i}: {h['name']}  ({o.get('road')}, {o.get('hood')}, {o.get('suburb')})")

    todo = [p for p in data["places"] if p["sem"] not in ("HOME", "INFERRED_HOME")][:max_places]
    print(f"looking up {sum(1 for p in todo if f'{p['lat']:.5f},{p['lon']:.5f}' not in cache)} new places")
    for p in todo:
        o = reverse(cache, p["lat"], p["lon"])
        if o:
            p["osm"] = o
    Path(path).write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("data")
    ap.add_argument("max_places", nargs="?", type=int, default=220)
    ap.add_argument("--cache", default=str(CACHE))
    ap.add_argument("--names", default=str(HERE / "home_names.json"))
    ap.add_argument("--offline", action="store_true", help="only use the cache, never call Nominatim")
    a = ap.parse_args()
    CACHE, OFFLINE = Path(a.cache), a.offline
    main(a.data, a.max_places, a.names)
