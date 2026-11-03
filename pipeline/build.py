"""Transform a Google Maps Timeline export (on-device format) into compact JSON
for the web app. Everything runs offline: reverse geocoding uses GeoNames.

usage: .venv/bin/python pipeline/build.py Timeline.json web/data
"""
import json
import math
import sys
from bisect import bisect_right
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

HERE = Path(__file__).parent
EARTH_KM = 6371.0088


# ---------------------------------------------------------------- helpers
def parse_ll(s):
    a, b = s.replace("°", "").split(",")
    return float(a), float(b)


def parse_t(s):
    return datetime.fromisoformat(s).timestamp()


def hav(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_KM * math.asin(min(1, math.sqrt(a)))


def xyz(lat, lon):
    lat, lon = np.radians(lat), np.radians(lon)
    return np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], -1)


# ---------------------------------------------------------------- geocoder
class Geo:
    """Pick the most 'meaningful' city near a point: big cities absorb their
    suburbs (score = population / (distance + 3km)^2 within 35km)."""

    def __init__(self):
        countries = {}
        for line in open(HERE / "geonames/countryInfo.txt", encoding="utf8"):
            if line.startswith("#"):
                continue
            f = line.rstrip("\n").split("\t")
            countries[f[0]] = f[4]
        self.countries = countries
        rows = []
        for line in open(HERE / "geonames/cities15000.txt", encoding="utf8"):
            f = line.split("\t")
            if f[7] in ("PPLX", "PPLH"):  # city districts / historical
                continue
            rows.append((int(f[0]), f[1], float(f[4]), float(f[5]), f[8], int(f[14] or 0)))
        self.rows = rows
        self.lat = np.array([r[2] for r in rows])
        self.lon = np.array([r[3] for r in rows])
        self.pop = np.array([max(r[5], 1) for r in rows], dtype=float)
        self.tree = cKDTree(xyz(self.lat, self.lon))

    def lookup(self, lats, lons):
        q = xyz(np.asarray(lats), np.asarray(lons))
        d, idx = self.tree.query(q, k=64)
        dkm = d * EARTH_KM  # chord ~ arc at these scales
        score = np.where(dkm < 35, self.pop[idx] / (dkm + 3) ** 2, 0)
        best = np.argmax(score, axis=1)
        none = score.max(axis=1) == 0
        best[none] = 0  # fall back to nearest
        out = idx[np.arange(len(idx)), best]
        far = dkm[np.arange(len(idx)), best] > 120
        return out, far


# ---------------------------------------------------------------- load
def main(src, outdir):
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    raw = json.load(open(src))
    segs = raw["semanticSegments"]
    segs.sort(key=lambda s: s["startTime"])

    # timezone offsets known from visits/activities; carried to path points
    tz_known = []
    for s in segs:
        if "startTimeTimezoneUtcOffsetMinutes" in s:
            tz_known.append((parse_t(s["startTime"]), s["startTimeTimezoneUtcOffsetMinutes"]))
    tz_known.sort()
    tz_t = [t for t, _ in tz_known]

    def tz_at(t):
        i = bisect_right(tz_t, t) - 1
        return tz_known[max(i, 0)][1]

    obs = []  # (t, lat, lon, kind) kind: 0 path 1 visit 2 activity 3 raw
    visits, acts, memories = [], [], []
    for s in segs:
        if "timelinePath" in s:
            for p in s["timelinePath"]:
                la, lo = parse_ll(p["point"])
                obs.append((parse_t(p["time"]), la, lo, 0))
        elif "visit" in s:
            v = s["visit"]
            tc = v["topCandidate"]
            la, lo = parse_ll(tc["placeLocation"]["latLng"])
            t0, t1 = parse_t(s["startTime"]), parse_t(s["endTime"])
            visits.append(dict(t0=t0, t1=t1, tz=s["startTimeTimezoneUtcOffsetMinutes"], lat=la, lon=lo,
                               pid=tc.get("placeId"), sem=tc.get("semanticType", "UNKNOWN"),
                               level=v.get("hierarchyLevel", 0)))
            obs.append((t0, la, lo, 1))
            obs.append((t1, la, lo, 1))
        elif "activity" in s:
            a = s["activity"]
            la0, lo0 = parse_ll(a["start"]["latLng"])
            la1, lo1 = parse_ll(a["end"]["latLng"])
            t0, t1 = parse_t(s["startTime"]), parse_t(s["endTime"])
            acts.append(dict(t0=t0, t1=t1, tz=s["startTimeTimezoneUtcOffsetMinutes"], lat0=la0, lon0=lo0,
                             lat1=la1, lon1=lo1, km=a.get("distanceMeters", 0) / 1000,
                             mode=a.get("topCandidate", {}).get("type", "UNKNOWN_ACTIVITY_TYPE")))
            obs.append((t0, la0, lo0, 2))
            obs.append((t1, la1, lo1, 2))
        elif "timelineMemory" in s:
            tr = s["timelineMemory"].get("trip")
            if tr:
                memories.append(dict(t0=parse_t(s["startTime"]), t1=parse_t(s["endTime"]),
                                     tz=s["startTimeTimezoneUtcOffsetMinutes"],
                                     km=tr.get("distanceFromOriginKms"),
                                     dest=[d["identifier"]["placeId"] for d in tr.get("destinations", [])]))
    for r in raw.get("rawSignals", []):
        if "position" in r:
            p = r["position"]
            la, lo = parse_ll(p["LatLng"])
            obs.append((parse_t(p["timestamp"]), la, lo, 3))

    obs.sort()
    print(f"observations {len(obs)} visits {len(visits)} activities {len(acts)} trips {len(memories)}")

    O_t = np.array([o[0] for o in obs])
    O_lat = np.array([o[1] for o in obs])
    O_lon = np.array([o[2] for o in obs])
    O_kind = np.array([o[3] for o in obs])
    O_tz = np.array([tz_at(t) for t in O_t])
    O_local = O_t + O_tz * 60

    def day_of(local_ts):
        return datetime.fromtimestamp(local_ts, timezone.utc).strftime("%Y-%m-%d")

    O_day = [day_of(x) for x in O_local]

    geo = Geo()
    O_city, O_far = geo.lookup(O_lat, O_lon)

    # ------------------------------------------------------------ cities
    cities = {}

    def city_entry(ci):
        if ci not in cities:
            gid, name, la, lo, cc, pop = geo.rows[ci]
            cities[ci] = dict(name=name, cc=cc, lat=la, lon=lo, pop=pop, days=set(), first=None, last=None, n=0)
        return cities[ci]

    for i in range(len(obs)):
        if O_far[i]:
            continue
        c = city_entry(int(O_city[i]))
        c["days"].add(O_day[i])
        c["n"] += 1

    # ------------------------------------------------------------ homes
    home_v = [v for v in visits if v["sem"] in ("HOME", "INFERRED_HOME")]
    clusters = []  # [lat, lon, visits]
    for v in home_v:
        for c in clusters:
            if hav(c["lat"], c["lon"], v["lat"], v["lon"]) < 0.15:
                c["v"].append(v)
                break
        else:
            clusters.append(dict(lat=v["lat"], lon=v["lon"], v=[v]))
    homes = []
    for c in clusters:
        nights = {day_of(v["t0"] + v["tz"] * 60) for v in c["v"]}
        if len(nights) < 5:
            continue
        ts = sorted(v["t0"] for v in c["v"])
        nd = sorted(nights)
        core = (nd[int(len(nd) * 0.05)], nd[min(len(nd) - 1, int(len(nd) * 0.95))])
        ci, _ = geo.lookup([c["lat"]], [c["lon"]])
        ce = city_entry(int(ci[0]))
        hours = sum(v["t1"] - v["t0"] for v in c["v"]) / 3600
        homes.append(dict(lat=round(c["lat"], 4), lon=round(c["lon"], 4), city=ce["name"], cc=ce["cc"],
                          country=geo.countries.get(ce["cc"], ce["cc"]),
                          first=day_of(ts[0]), last=day_of(ts[-1]), core=core, days=len(nights), hours=round(hours)))
    homes.sort(key=lambda h: h["core"][0])
    # the same building can get two place ids; fold back-to-back neighbours together
    folded = []
    for h in homes:
        prev = folded[-1] if folded else None
        if prev and hav(prev["lat"], prev["lon"], h["lat"], h["lon"]) < 0.25:
            prev["core"] = [prev["core"][0], max(prev["core"][1], h["core"][1])]
            prev["first"], prev["last"] = min(prev["first"], h["first"]), max(prev["last"], h["last"])
            prev["days"] += h["days"]
            prev["hours"] += h["hours"]
        else:
            folded.append(h)
    homes = folded
    home_pts = [(h["lat"], h["lon"]) for h in homes]
    home_city_names = {h["city"] for h in homes}

    # ------------------------------------------------------------ places (visits)
    places = defaultdict(lambda: dict(n=0, hours=0.0, days=set(), sem=Counter(), lat=0, lon=0, first=None, last=None,
                                      wd=Counter(), hr=Counter(), yh=Counter()))
    for v in visits:
        if v["level"] != 0 or not v["pid"]:
            continue
        p = places[v["pid"]]
        p["n"] += 1
        p["hours"] += (v["t1"] - v["t0"]) / 3600
        d = day_of(v["t0"] + v["tz"] * 60)
        p["days"].add(d)
        p["sem"][v["sem"]] += 1
        p["lat"], p["lon"] = v["lat"], v["lon"]
        p["first"] = p["first"] or d
        p["last"] = d
        loc = datetime.fromtimestamp(v["t0"] + v["tz"] * 60, timezone.utc)
        p["wd"][loc.weekday()] += 1
        p["hr"][loc.hour] += 1
        p["yh"][d[:4]] += (v["t1"] - v["t0"]) / 3600
    pid_list = list(places)
    if pid_list:
        pci, _ = geo.lookup([places[k]["lat"] for k in pid_list], [places[k]["lon"] for k in pid_list])
    place_out = []
    for k, ci in zip(pid_list, pci):
        p = places[k]
        sem = p["sem"].most_common(1)[0][0]
        if sem not in ("HOME", "INFERRED_HOME") and any(hav(p["lat"], p["lon"], la, lo) < 0.12 for la, lo in home_pts):
            sem = "HOME"
        ce = city_entry(int(ci))
        place_out.append(dict(id=k, lat=round(p["lat"], 5), lon=round(p["lon"], 5), n=p["n"],
                              hours=round(p["hours"], 1), days=len(p["days"]), sem=sem,
                              city=ce["name"], cc=ce["cc"], first=p["first"], last=p["last"],
                              wd=p["wd"].most_common(1)[0][0], hr=p["hr"].most_common(1)[0][0],
                              wd_share=round(p["wd"].most_common(1)[0][1] / p["n"], 2),
                              yh={y: round(h, 1) for y, h in p["yh"].items() if h >= 0.5}))
    place_out.sort(key=lambda p: -p["hours"])
    place_by_id = {p["id"]: p for p in place_out}

    # ------------------------------------------------------------ days
    days = defaultdict(lambda: dict(n=0, cities=Counter(), km=0.0, modes=Counter()))
    for i in range(len(obs)):
        d = days[O_day[i]]
        d["n"] += 1
        if not O_far[i]:
            d["cities"][int(O_city[i])] += 1
    for a in acts:
        d = days[day_of(a["t0"] + a["tz"] * 60)]
        d["km"] += a["km"]
        d["modes"][a["mode"]] += a["km"]

    # long hops between consecutive observations (catches unlabelled flights)
    hops = []
    for i in range(1, len(obs)):
        km = hav(O_lat[i - 1], O_lon[i - 1], O_lat[i], O_lon[i])
        if km > 150:
            hrs = max((O_t[i] - O_t[i - 1]) / 3600, 0.01)
            hops.append(dict(t0=O_t[i - 1], t1=O_t[i], a=[round(O_lon[i - 1], 3), round(O_lat[i - 1], 3)],
                             b=[round(O_lon[i], 3), round(O_lat[i], 3)], km=round(km),
                             fly=bool(km > 700 or km / hrs > 250), day=O_day[i]))
    # merge back-to-back hops (A->B->C within a few hours) into one journey
    merged = []
    for h in hops:
        if merged and h["t0"] - merged[-1]["t1"] < 4 * 3600 and merged[-1]["b"] == h["a"]:
            m = merged[-1]
            m["b"], m["t1"], m["fly"] = h["b"], h["t1"], m["fly"] or h["fly"]
            m["km"] = round(hav(m["a"][1], m["a"][0], m["b"][1], m["b"][0]))
        else:
            merged.append(dict(h))
    hops = [h for h in merged if h["km"] > 150]
    for a in acts:
        if a["mode"] == "FLYING":
            pass  # already captured as hops via their endpoints
    hop_a, _ = geo.lookup([h["a"][1] for h in hops], [h["a"][0] for h in hops]) if hops else ([], [])
    hop_b, _ = geo.lookup([h["b"][1] for h in hops], [h["b"][0] for h in hops]) if hops else ([], [])
    hop_out = []
    for h, ca, cb in zip(hops, hop_a, hop_b):
        hop_out.append(dict(day=h["day"], a=h["a"], b=h["b"], km=h["km"], fly=h["fly"],
                            from_=geo.rows[ca][1], to=geo.rows[cb][1],
                            fcc=geo.rows[ca][4], tcc=geo.rows[cb][4]))

    # ------------------------------------------------------------ city & country tables
    city_out = []
    city_ids = {}
    for ci, c in sorted(cities.items(), key=lambda kv: -len(kv[1]["days"])):
        if not c["days"]:
            continue
        ds = sorted(c["days"])
        city_ids[ci] = len(city_out)
        city_out.append(dict(name=c["name"], cc=c["cc"], lat=round(c["lat"], 3), lon=round(c["lon"], 3),
                             days=len(ds), first=ds[0], last=ds[-1], n=c["n"]))
    countries = defaultdict(lambda: dict(days=set(), cities=set()))
    for c in city_out:
        pass
    for dkey, d in days.items():
        for ci in d["cities"]:
            cc = geo.rows[ci][4]
            countries[cc]["days"].add(dkey)
            countries[cc]["cities"].add(ci)
    stayed = set()
    vl = [v for v in visits if v["level"] == 0 and v["t1"] - v["t0"] > 1800]
    if vl:
        vci, vfar = geo.lookup([v["lat"] for v in vl], [v["lon"] for v in vl])
        stayed = {geo.rows[int(ci)][4] for ci, f in zip(vci, vfar) if not f}
    country_out = []
    for cc, c in countries.items():
        ds = sorted(c["days"])
        top = sorted(c["cities"], key=lambda ci: -len(cities[ci]["days"]))
        country_out.append(dict(cc=cc, name=geo.countries.get(cc, cc), days=len(ds), first=ds[0], last=ds[-1],
                                cities=len(c["cities"]), top=[cities[ci]["name"] for ci in top[:6]],
                                years=sorted({d[:4] for d in ds}), stayed=cc in stayed))
    country_out.sort(key=lambda c: c["first"])

    day_out = {}
    for dkey in sorted(days):
        d = days[dkey]
        cl = [city_ids[ci] for ci, _ in d["cities"].most_common() if ci in city_ids]
        day_out[dkey] = dict(n=d["n"], c=cl[:6], km=round(d["km"], 1),
                             m={k: round(v, 1) for k, v in d["modes"].most_common(3) if v > 0.05})

    # ------------------------------------------------------------ distance by year & mode
    dist = defaultdict(Counter)
    for a in acts:
        dist[day_of(a["t0"] + a["tz"] * 60)[:4]][a["mode"]] += a["km"]
    dist = {y: {m: round(k, 1) for m, k in c.items()} for y, c in sorted(dist.items())}

    # ------------------------------------------------------------ rhythm: where is your time
    # per month: hours at home / work / elsewhere / moving ; per weekday*hour: same
    def spread(t0, t1, tz, bucket_fn, key):
        t = t0
        while t < t1:
            nxt = min(t1, (math.floor((t + tz * 60) / 3600) + 1) * 3600 - tz * 60)
            bucket_fn(t + tz * 60, key, (nxt - t) / 3600)
            t = nxt

    month_mix = defaultdict(Counter)
    week_mix = defaultdict(Counter)  # (weekday*24+hour) -> Counter

    def bucket(local, key, hrs):
        dt = datetime.fromtimestamp(local, timezone.utc)
        month_mix[dt.strftime("%Y-%m")][key] += hrs
        week_mix[dt.weekday() * 24 + dt.hour][key] += hrs

    for v in visits:
        if v["level"] != 0 or v["t1"] - v["t0"] > 30 * 86400:
            continue
        key = {"HOME": "home", "INFERRED_HOME": "home", "WORK": "work", "INFERRED_WORK": "work"}.get(v["sem"], "out")
        if key != "home" and any(hav(v["lat"], v["lon"], la, lo) < 0.2 for la, lo in home_pts):
            key = "home"  # older years often lack the HOME label
        spread(v["t0"], v["t1"], v["tz"], bucket, key)
    for a in acts:
        if a["t1"] - a["t0"] < 2 * 86400:
            spread(a["t0"], a["t1"], a["tz"], bucket, "move")
    months = {m: {k: round(v, 1) for k, v in c.items()} for m, c in sorted(month_mix.items())}
    week = [{k: round(v, 1) for k, v in week_mix[i].items()} for i in range(168)]

    # ------------------------------------------------------------ data density
    density = defaultdict(lambda: dict(n=0, days=set(), kinds=Counter()))
    for i in range(len(obs)):
        if O_kind[i] == 3:
            continue  # raw fixes only exist for the last weeks; counted separately
        m = O_day[i][:7]
        density[m]["n"] += 1
        density[m]["days"].add(O_day[i])
        density[m]["kinds"][int(O_kind[i])] += 1
    gaps = defaultdict(list)
    for i in range(1, len(obs)):
        g = O_t[i] - O_t[i - 1]
        if 0 < g < 86400 * 2:
            gaps[O_day[i][:4]].append(g)
    density_out = {m: dict(n=d["n"], days=len(d["days"]), path=d["kinds"][0], visit=d["kinds"][1],
                           act=d["kinds"][2], raw=d["kinds"][3]) for m, d in sorted(density.items())}
    gap_out = {y: dict(median_min=round(float(np.median(g)) / 60, 1), p90_min=round(float(np.percentile(g, 90)) / 60, 1))
               for y, g in sorted(gaps.items())}

    # ------------------------------------------------------------ superlatives
    valid = ~O_far
    sup = {}

    def obs_point(i, label):
        ci = int(O_city[i])
        return dict(label=label, lat=round(float(O_lat[i]), 4), lon=round(float(O_lon[i]), 4), day=O_day[i],
                    city=geo.rows[ci][1], cc=geo.rows[ci][4])

    idx = np.where(valid)[0]
    sup["north"] = obs_point(idx[np.argmax(O_lat[idx])], "Furthest north")
    sup["south"] = obs_point(idx[np.argmin(O_lat[idx])], "Furthest south")
    sup["east"] = obs_point(idx[np.argmax(O_lon[idx])], "Furthest east")
    sup["west"] = obs_point(idx[np.argmin(O_lon[idx])], "Furthest west")
    if home_pts:
        hp = xyz(np.array([h[0] for h in home_pts]), np.array([h[1] for h in home_pts]))
        dd, _ = cKDTree(hp).query(xyz(O_lat[idx], O_lon[idx]))
        j = idx[np.argmax(dd)]
        sup["farthest"] = obs_point(j, "Farthest from any home")
        sup["farthest"]["km"] = round(float(dd.max()) * EARTH_KM)
    busiest = max(day_out.items(), key=lambda kv: kv[1]["km"])
    sup["longest_day"] = dict(day=busiest[0], km=busiest[1]["km"], modes=busiest[1]["m"],
                              cities=[city_out[c]["name"] for c in busiest[1]["c"]])
    most_cities = max(day_out.items(), key=lambda kv: len(kv[1]["c"]))
    sup["most_cities_day"] = dict(day=most_cities[0], cities=[city_out[c]["name"] for c in most_cities[1]["c"]])
    longest_walk = max((a for a in acts if a["mode"] == "WALKING" and a["t1"] - a["t0"] < 6 * 3600 and a["km"] / max((a["t1"] - a["t0"]) / 3600, 0.01) < 7), key=lambda a: a["km"], default=None)
    if longest_walk:
        sup["longest_walk"] = dict(day=day_of(longest_walk["t0"] + longest_walk["tz"] * 60), km=round(longest_walk["km"], 1),
                                   mins=round((longest_walk["t1"] - longest_walk["t0"]) / 60), lat=longest_walk["lat0"], lon=longest_walk["lon0"])
    longest_ride = max((a for a in acts if a["mode"] == "CYCLING" and a["km"] / max((a["t1"] - a["t0"]) / 3600, 0.01) < 25), key=lambda a: a["km"], default=None)
    if longest_ride:
        sup["longest_ride"] = dict(day=day_of(longest_ride["t0"] + longest_ride["tz"] * 60), km=round(longest_ride["km"], 1),
                                   mins=round((longest_ride["t1"] - longest_ride["t0"]) / 60), lat=longest_ride["lat0"], lon=longest_ride["lon0"])
    # longest streak of consecutive days away from all home cities
    streak, best, cur_start, best_range = 0, 0, None, None
    prev = None
    for dkey in sorted(day_out):
        d = day_out[dkey]
        names = {city_out[c]["name"] for c in d["c"]}
        away = names and not (names & home_city_names)
        dt = datetime.strptime(dkey, "%Y-%m-%d")
        contiguous = prev is not None and (dt - prev).days == 1
        if away:
            if streak and contiguous:
                streak += 1
            else:
                streak, cur_start = 1, dkey
            if streak > best:
                best, best_range = streak, (cur_start, dkey)
        else:
            streak = 0
        prev = dt
    if best_range:
        sup["longest_away"] = dict(days=best, start=best_range[0], end=best_range[1])

    # ------------------------------------------------------------ trips (Google's own trip memories)
    trip_out = []
    for m in memories:
        sel = (O_t >= m["t0"]) & (O_t <= m["t1"]) & valid
        cc = Counter(int(c) for c in O_city[sel])
        top = [geo.rows[ci] for ci, _ in cc.most_common(12) if geo.rows[ci][1] not in home_city_names][:5]
        dests = [place_by_id[p] for p in m["dest"] if p in place_by_id]
        if not top and not dests:
            continue
        pts = [[round(float(lo), 3), round(float(la), 3)] for la, lo in zip(O_lat[sel][::5], O_lon[sel][::5])]
        trip_out.append(dict(start=day_of(m["t0"] + m["tz"] * 60), end=day_of(m["t1"] + m["tz"] * 60), km=m["km"],
                             cities=[r[1] for r in top], ccs=sorted({r[4] for r in top}),
                             bbox=[float(O_lon[sel].min()), float(O_lat[sel].min()), float(O_lon[sel].max()), float(O_lat[sel].max())] if sel.any() else None,
                             path=pts[:400]))

    # ------------------------------------------------------------ chapters: life around each home
    for i, h in enumerate(homes):
        h["from"] = h["core"][0]
        if i and homes[i - 1]["cc"] != h["cc"]:
            for dk in sorted(day_out):
                d = day_out[dk]
                if dk > homes[i - 1]["core"][1] and d["c"] and city_out[d["c"][0]]["cc"] == h["cc"]:
                    h["from"] = min(dk, h["from"])
                    break
    haunts = [p for p in place_out if p["sem"] not in ("HOME", "INFERRED_HOME")]
    keep = set(p["id"] for p in haunts[:160])

    def period_stats(a, b):
        """everything between day a (inclusive) and day b (exclusive)"""
        ks = [k for k in day_out if a <= k < b]
        km = Counter()
        for x in acts:
            dk = day_of(x["t0"] + x["tz"] * 60)
            if a <= dk < b:
                km[x["mode"]] += x["km"]
        ccs, cs = Counter(), set()
        for k in ks:
            for c in day_out[k]["c"]:
                cs.add(c)
            if day_out[k]["c"]:
                ccs[city_out[day_out[k]["c"][0]]["cc"]] += 1
        new_cities = sum(1 for c in cs if a <= city_out[c]["first"] < b)
        trips = [t for t in trip_out if a <= t["start"] < b]
        return dict(days=len(ks), km={m: round(v) for m, v in km.most_common() if v >= 1},
                    countries=[[cc, n] for cc, n in ccs.most_common()], cities=len(cs), new_cities=new_cities,
                    trips=len(trips))

    # place hours by period, from the visit list
    def top_places(a, b, n=6):
        c = Counter()
        for v in visits:
            if v["level"] or not v["pid"] or place_by_id.get(v["pid"], {}).get("sem") in (None, "HOME", "INFERRED_HOME"):
                continue
            dk = day_of(v["t0"] + v["tz"] * 60)
            if a <= dk < b:
                c[v["pid"]] += (v["t1"] - v["t0"]) / 3600
        out = []
        for pid, hrs in c.most_common(n):
            keep.add(pid)
            out.append([pid, round(hrs, 1)])
        return out

    for i, h in enumerate(homes):
        end = homes[i + 1]["from"] if i + 1 < len(homes) else "9999"
        h["life"] = period_stats(h["from"], end)
        h["life"]["top"] = top_places(h["from"], end)
    years_out = {}
    for y in sorted({k[:4] for k in day_out}):
        st = period_stats(f"{y}-01-01", f"{int(y) + 1}-01-01")
        if st["days"] < 3:
            continue
        st["top"] = top_places(f"{y}-01-01", f"{int(y) + 1}-01-01")
        years_out[y] = st
    place_export = [p for p in place_out if p["id"] in keep or p["sem"] in ("HOME", "INFERRED_HOME")][:400]

    # ------------------------------------------------------------ heat points (per year, ~150m grid)
    grid = Counter()
    for i in range(len(obs)):
        grid[(round(float(O_lat[i]), 3), round(float(O_lon[i]), 3), O_day[i][:4])] += 1
    heat = defaultdict(list)
    for (la, lo, y), n in grid.items():
        heat[y].extend([lo, la, n])

    # ------------------------------------------------------------ per-day tracks (lazy loaded)
    tracks = defaultdict(list)
    for i in range(len(obs)):
        loc = O_local[i]
        mins = int((loc % 86400) // 60)
        tracks[O_day[i]].append([round(float(O_lon[i]), 4), round(float(O_lat[i]), 4), mins])
    for k, v in tracks.items():
        # dedupe consecutive identical points
        out = [v[0]]
        for p in v[1:]:
            if p[0] != out[-1][0] or p[1] != out[-1][1]:
                out.append(p)
        tracks[k] = out

    summary = dict(
        first=O_day[0], last=O_day[-1], observations=len(obs), visits=len(visits), activities=len(acts),
        days_with_data=len(day_out), cities=len(city_out), countries=len(country_out),
        km_total=round(sum(a["km"] for a in acts)), places=len(place_out),
        kinds=dict(path=int((O_kind == 0).sum()), visit=int((O_kind == 1).sum()),
                   act=int((O_kind == 2).sum()), raw=int((O_kind == 3).sum())),
        modes_total={m: round(k) for m, k in sum((Counter(v) for v in dist.values()), Counter()).most_common()},
        persona=raw.get("userLocationProfile", {}).get("persona", {}),
    )

    data = dict(summary=summary, homes=homes, cities=city_out, countries=country_out, days=day_out,
                dist=dist, months=months, week=week, density=density_out, gaps=gap_out, sup=sup,
                trips=trip_out, hops=hop_out, places=place_export, years=years_out, heat=heat)
    json.dump(data, open(outdir / "data.json", "w"), separators=(",", ":"), ensure_ascii=False)
    json.dump(tracks, open(outdir / "tracks.json", "w"), separators=(",", ":"))
    for f in ("data.json", "tracks.json"):
        print(f, round((outdir / f).stat().st_size / 1e6, 2), "MB")
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
