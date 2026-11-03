"""Generate a completely made-up Google Maps Timeline export, for demos and
screenshots. The person, places and trips are invented; only the cities are real.

Story: someone moves Chicago (2015) -> Brooklyn (2018) -> Seattle (2021),
commutes, has favourite cafés, sits out 2020 at home, and travels a fair bit.

usage: python examples/fake_timeline.py out/Timeline.json out/nominatim_cache.json
"""
import json
import math
import random
import sys
from datetime import date, datetime, timedelta, timezone

random.seed(42)


def P(lat, lon, name="", cat="place", typ="house", road="", hood="", city=""):
    return dict(lat=round(lat, 4), lon=round(lon, 4), name=name, cat=cat, type=typ, road=road, hood=hood, city=city)


CHAPTERS = [
    dict(city="Chicago", start=date(2015, 9, 6), end=date(2018, 7, 20), tz=(-300, -360), commute="IN_SUBWAY",
         airport=P(41.9742, -87.9073, "O'Hare International Airport", "aeroway", "aerodrome", "Airport Blvd", city="Chicago"),
         home=P(41.9214, -87.6513, road="W Armitage Ave", hood="Lincoln Park", city="Chicago"),
         work=P(41.8837, -87.6325, "Acme Analytics", "office", "company", "W Madison St", "The Loop", "Chicago"),
         haunts=[P(41.9180, -87.6530, "Halsted Street Coffee", "amenity", "cafe", "N Halsted St", city="Chicago"),
                 P(41.9400, -87.6550, "Lakeview Climbing", "leisure", "sports_centre", "N Clark St", city="Chicago"),
                 P(41.9150, -87.6480, "Fresh Market Co-op", "shop", "supermarket", "W North Ave", city="Chicago"),
                 P(41.9100, -87.6800, road="N Damen Ave", city="Chicago"),
                 P(41.9260, -87.6350, "Lincoln Park", "leisure", "park", "N Stockton Dr", city="Chicago"),
                 P(41.9215, -87.6640, "The Tipsy Fox", "amenity", "bar", "N Lincoln Ave", city="Chicago")]),
    dict(city="New York", start=date(2018, 7, 22), end=date(2021, 6, 12), tz=(-240, -300), commute="IN_SUBWAY",
         airport=P(40.6413, -73.7781, "John F. Kennedy International Airport", "aeroway", "aerodrome", "JFK Expy", city="New York"),
         home=P(40.6710, -73.9814, road="Union St", hood="Park Slope", city="New York"),
         work=P(40.7410, -73.9897, "Northwind Labs", "office", "company", "W 23rd St", "Flatiron", "New York"),
         haunts=[P(40.6745, -73.9772, "Prospect Coffee Roasters", "amenity", "cafe", "7th Ave", city="New York"),
                 P(40.6790, -73.9890, "Gowanus Bouldering", "leisure", "sports_centre", "3rd Ave", city="New York"),
                 P(40.6730, -73.9850, "Slope Grocery", "shop", "supermarket", "5th Ave", city="New York"),
                 P(40.6602, -73.9690, "Prospect Park", "leisure", "park", "West Dr", city="New York"),
                 P(40.6870, -73.9500, road="Lexington Ave", city="New York"),
                 P(40.6840, -73.9776, "Atlantic Terminal", "railway", "station", "Atlantic Ave", city="New York")]),
    dict(city="Seattle", start=date(2021, 6, 14), end=date(2026, 10, 30), tz=(-420, -480), commute="CYCLING",
         airport=P(47.4502, -122.3088, "Seattle-Tacoma International Airport", "aeroway", "aerodrome", "Airport Expy", city="SeaTac"),
         home=P(47.6230, -122.3200, road="E Thomas St", hood="Capitol Hill", city="Seattle"),
         work=P(47.6220, -122.3380, "Cascade Systems", "office", "company", "Westlake Ave N", "South Lake Union", "Seattle"),
         haunts=[P(47.6150, -122.3200, "Pine Street Espresso", "amenity", "cafe", "E Pine St", city="Seattle"),
                 P(47.6510, -122.3500, "Fremont Rock Gym", "leisure", "sports_centre", "N 34th St", city="Seattle"),
                 P(47.6190, -122.3150, "Hill Market", "shop", "supermarket", "15th Ave E", city="Seattle"),
                 P(47.6300, -122.3150, "Volunteer Park", "leisure", "park", "E Prospect St", city="Seattle"),
                 P(47.6600, -122.3500, road="Wallingford Ave N", city="Seattle"),
                 P(47.6080, -122.3400, "Pike Place Market", "shop", "marketplace", "Pike Pl", city="Seattle")]),
]

# (start, nights, [(city, lat, lon, tz)], how you get there)
TRIPS = [
    (date(2016, 4, 14), 4, [("New Orleans", 29.9511, -90.0715, -300)], "fly"),
    (date(2016, 9, 10), 1, [("Milwaukee", 43.0389, -87.9065, -300)], "car"),
    (date(2017, 7, 1), 6, [("Denver", 39.7392, -104.9903, -360), ("Boulder", 40.0150, -105.2705, -360)], "fly"),
    (date(2017, 12, 20), 7, [("Mexico City", 19.4326, -99.1332, -360)], "fly"),
    (date(2018, 3, 9), 4, [("San Francisco", 37.7749, -122.4194, -420)], "fly"),
    (date(2019, 5, 24), 3, [("Boston", 42.3601, -71.0589, -240)], "train"),
    (date(2019, 10, 4), 9, [("London", 51.5072, -0.1276, 60), ("Paris", 48.8566, 2.3522, 120)], "fly"),
    (date(2020, 1, 17), 4, [("Miami", 25.7617, -80.1918, -300)], "fly"),
    (date(2021, 8, 20), 3, [("Portland", 45.5152, -122.6784, -420)], "car"),
    (date(2022, 6, 3), 7, [("San Francisco", 37.7749, -122.4194, -420), ("Yosemite Valley", 37.7456, -119.5936, -420)], "fly"),
    (date(2022, 10, 7), 3, [("Vancouver", 49.2827, -123.1207, -420)], "car"),
    (date(2023, 4, 1), 11, [("Tokyo", 35.6762, 139.6503, 540), ("Kyoto", 35.0116, 135.7681, 540)], "fly"),
    (date(2023, 9, 15), 4, [("Austin", 30.2672, -97.7431, -300)], "fly"),
    (date(2024, 2, 9), 6, [("Mexico City", 19.4326, -99.1332, -360), ("Oaxaca", 17.0732, -96.7266, -360)], "fly"),
    (date(2024, 7, 3), 5, [("Chicago", 41.8781, -87.6298, -300)], "fly"),
    (date(2025, 5, 16), 9, [("Lisbon", 38.7223, -9.1393, 60), ("Porto", 41.1579, -8.6291, 60)], "fly"),
    (date(2025, 8, 22), 3, [("Port Angeles", 48.1181, -123.4307, -420)], "car"),
    (date(2026, 3, 13), 4, [("New York", 40.7128, -74.0060, -240)], "fly"),
    (date(2026, 7, 10), 7, [("Honolulu", 21.3069, -157.8583, -600)], "fly"),
]
TRIP_SPOTS = [("Old Town Market", "shop", "marketplace"), ("Harbour Café", "amenity", "cafe"),
              ("Art Museum", "tourism", "museum"), ("Riverside Park", "leisure", "park"),
              ("Noodle Bar", "amenity", "restaurant"), ("Bookshop", "shop", "books"),
              ("Lookout", "tourism", "viewpoint"), ("Central Station", "railway", "station")]

segments, cache = [], {}
_pid = [0]


def place_id(p):
    k = (p["lat"], p["lon"])
    if k not in place_id.ids:
        _pid[0] += 1
        place_id.ids[k] = f"FakePlace{_pid[0]:05d}"
        cache[f"{p['lat']:.5f},{p['lon']:.5f}"] = {k2: p[k2] for k2 in ("name", "cat", "type", "road", "hood", "city")} | {"suburb": ""}
    return place_id.ids[k]


place_id.ids = {}


def hav(a, b):
    r = math.pi / 180
    x = math.sin((b["lat"] - a["lat"]) * r / 2) ** 2 + math.cos(a["lat"] * r) * math.cos(b["lat"] * r) * math.sin((b["lon"] - a["lon"]) * r / 2) ** 2
    return 12742 * math.asin(math.sqrt(x))


def ts(d, minutes, tz):
    t = datetime(d.year, d.month, d.day, tzinfo=timezone(timedelta(minutes=tz))) + timedelta(minutes=minutes)
    return t.isoformat(timespec="milliseconds")


def ll(p):
    return f"{p['lat']}°, {p['lon']}°"


def visit(d, t0, t1, p, tz, sem="UNKNOWN"):
    segments.append(dict(startTime=ts(d, t0, tz), endTime=ts(d, t1, tz), startTimeTimezoneUtcOffsetMinutes=tz,
                         endTimeTimezoneUtcOffsetMinutes=tz,
                         visit=dict(hierarchyLevel=0, probability=0.9,
                                    topCandidate=dict(placeId=place_id(p), semanticType=sem, probability=0.95,
                                                      placeLocation=dict(latLng=ll(p))))))


def move(d, t0, t1, a, b, tz, mode):
    km = hav(a, b) * (1.0 if mode == "FLYING" else 1.3)
    segments.append(dict(startTime=ts(d, t0, tz), endTime=ts(d, t1, tz), startTimeTimezoneUtcOffsetMinutes=tz,
                         endTimeTimezoneUtcOffsetMinutes=tz,
                         activity=dict(start=dict(latLng=ll(a)), end=dict(latLng=ll(b)), distanceMeters=km * 1000,
                                       topCandidate=dict(type=mode, probability=0.9))))
    if mode == "FLYING":
        return
    n = max(2, int((t1 - t0) / 3))
    pts = []
    for i in range(n + 1):
        f = i / n
        bend = math.sin(f * math.pi) * 0.004 * random.uniform(-1, 1)
        pts.append(dict(point=f"{a['lat'] + (b['lat'] - a['lat']) * f + bend:.6f}°, {a['lon'] + (b['lon'] - a['lon']) * f - bend:.6f}°",
                        time=ts(d, t0 + (t1 - t0) * f, tz)))
    segments.append(dict(startTime=ts(d, t0, tz), endTime=ts(d, t1, tz), timelinePath=pts))


def mode_for(km, ch):
    if km < 1.2:
        return "WALKING"
    if km < 6:
        return random.choice(["CYCLING", "WALKING", ch["commute"]]) if ch["commute"] != "CYCLING" else "CYCLING"
    return random.choice([ch["commute"], "IN_PASSENGER_VEHICLE", "IN_BUS"])


def day_plan(d, ch, stops, tz):
    """stops: list of (place, arrive_min, leave_min, sem). Home bookends are added here."""
    home = ch["home"]
    seq = [(home, 0, stops[0][1] - 25 if stops else 1439, "HOME")] + stops
    if stops:
        seq.append((home, stops[-1][2] + 25, 1439, "HOME"))
    for i, (p, a, b, sem) in enumerate(seq):
        visit(d, a, b, p, tz, sem)
        if i + 1 < len(seq):
            nxt = seq[i + 1]
            km = hav(p, nxt[0])
            move(d, b, nxt[1], p, nxt[0], tz, mode_for(km, ch))


def jitter(c, km):
    return P(c["lat"] + random.uniform(-1, 1) * km / 111, c["lon"] + random.uniform(-1, 1) * km / 75)


def trip_day(d, city, hotel, spots, tz, first, last):
    """a day away: hotel, two or three spots, back to the hotel"""
    picks = random.sample(spots, k=min(len(spots), random.randint(2, 3)))
    t = 600 if not first else 960
    prev = hotel
    visit(d, 0 if not first else 900, t, hotel, tz)
    for s in picks if not last else picks[:1]:
        move(d, t, t + 20, prev, s, tz, "WALKING" if hav(prev, s) < 2 else "IN_SUBWAY")
        stay = random.randint(60, 150)
        visit(d, t + 20, t + 20 + stay, s, tz)
        t, prev = t + 20 + stay, s
    if not last:
        move(d, t, t + 20, prev, hotel, tz, "WALKING")
        visit(d, t + 20, 1439, hotel, tz)
    return prev


def run_trip(start, nights, stops, how, ch, tzh):
    home, ap = ch["home"], ch["airport"]
    d = start
    # leave home
    visit(d, 0, 420, home, tzh, "HOME")
    per = max(1, nights // len(stops))
    dests = []
    prev_city = None
    for si, (city, lat, lon, tz) in enumerate(stops):
        c = P(lat, lon)
        hotel = P(lat + 0.006, lon - 0.004, f"Hotel {city}", "tourism", "hotel", "Main St", city=city)
        spots = [P(lat + random.uniform(-0.03, 0.03), lon + random.uniform(-0.03, 0.03), f"{city} {n}", cat, typ, "", city=city)
                 for n, cat, typ in random.sample(TRIP_SPOTS, 5)]
        dests.append(place_id(hotel))
        if si == 0:
            if how == "fly":
                move(d, 420, 470, home, ap, tzh, "IN_PASSENGER_VEHICLE")
                visit(d, 470, 560, ap, tzh)
                far = P(lat - 0.12, lon + 0.1, f"{city} Airport", "aeroway", "aerodrome", city=city)
                move(d, 560, 560 + int(hav(ap, far) / 13), ap, far, tzh, "FLYING")
                move(d, 900 - 40, 900, far, hotel, tz, "IN_PASSENGER_VEHICLE")
            else:
                mode = "IN_TRAIN" if how == "train" else "IN_PASSENGER_VEHICLE"
                move(d, 420, 420 + int(hav(home, hotel) / 1.4) + 30, home, hotel, tzh, mode)
        else:
            move(d, 540, 540 + int(hav(prev_city, hotel) / 2), prev_city, hotel, tz, "IN_TRAIN" if hav(prev_city, hotel) < 600 else "FLYING")
        for k in range(per if si < len(stops) - 1 else nights - per * si):
            trip_day(d, city, hotel, spots, tz, first=(k == 0 and si == 0), last=False)
            d += timedelta(days=1)
        prev_city = hotel
    # fly / drive home
    last = prev_city
    if how == "fly":
        far = P(last["lat"] - 0.1, last["lon"] + 0.1, "Departures", "aeroway", "aerodrome")
        move(d, 600, 640, last, far, stops[-1][3], "IN_PASSENGER_VEHICLE")
        move(d, 700, 700 + int(hav(far, ap) / 13), far, ap, tzh, "FLYING")
        move(d, 1200, 1250, ap, home, tzh, "IN_PASSENGER_VEHICLE")
    else:
        move(d, 600, 600 + int(hav(last, home) / 1.4) + 30, last, home, tzh, "IN_PASSENGER_VEHICLE" if how == "car" else "IN_TRAIN")
    visit(d, 1260, 1439, home, tzh, "HOME")
    km = max(int(hav(home, P(s[1], s[2]))) for s in stops)
    segments.append(dict(startTime=ts(start, 420, tzh), endTime=ts(d, 1260, tzh), startTimeTimezoneUtcOffsetMinutes=tzh,
                         endTimeTimezoneUtcOffsetMinutes=tzh,
                         timelineMemory=dict(trip=dict(distanceFromOriginKms=km, destinations=[dict(identifier=dict(placeId=p)) for p in dests]))))
    return d


def main(out, cache_out):
    trips = {t[0]: t for t in TRIPS}
    for ci, ch in enumerate(CHAPTERS):
        d = ch["start"]
        while d <= ch["end"]:
            summer = 3 <= d.month <= 10
            tz = ch["tz"][0] if summer else ch["tz"][1]
            if d in trips:
                _, nights, stops, how = trips[d]
                d = run_trip(d, nights, stops, how, ch, tz) + timedelta(days=1)
                continue
            if d.year == 2016 and random.random() < 0.55:  # an old phone that often forgot to record
                d += timedelta(days=1)
                continue
            pandemic = date(2020, 3, 15) <= d <= date(2021, 5, 31)
            weekend = d.weekday() >= 5
            H = ch["haunts"]
            stops = []
            if pandemic:
                if random.random() < 0.5:
                    p = random.choice([H[2], H[3] if ch["city"] != "New York" else H[3], H[4]])
                    a = random.randint(600, 1000)
                    stops.append((p, a, a + random.randint(30, 90), "UNKNOWN"))
            elif not weekend:
                a = random.randint(500, 560)
                b = random.randint(1020, 1110)
                stops.append((ch["work"], a, b, "WORK"))
                if random.random() < 0.45:
                    p = random.choice(H[:3] + [H[5]])
                    s = b + 30
                    stops.append((p, s, s + random.randint(45, 140), "UNKNOWN"))
            else:
                t = random.randint(600, 720)
                for _ in range(random.randint(1, 3)):
                    roll = random.random()
                    p = random.choice(H) if roll < 0.75 else jitter(P(*map(float, (ch["home"]["lat"], ch["home"]["lon"]))), 6)
                    if roll >= 0.75:
                        p.update(road="", city=ch["city"])
                    stay = random.randint(60, 200)
                    stops.append((p, t, t + stay, "UNKNOWN"))
                    t += stay + random.randint(25, 60)
                    if t > 1300:
                        break
            day_plan(d, ch, stops, tz)
            d += timedelta(days=1)
        # the move to the next city
        if ci + 1 < len(CHAPTERS):
            nxt = CHAPTERS[ci + 1]
            d = ch["end"] + timedelta(days=1)
            tz = ch["tz"][0]
            visit(d, 0, 420, ch["home"], tz, "HOME")
            move(d, 420, 480, ch["home"], ch["airport"], tz, "IN_PASSENGER_VEHICLE")
            move(d, 560, 560 + int(hav(ch["airport"], nxt["airport"]) / 13), ch["airport"], nxt["airport"], tz, "FLYING")
            move(d, 900, 960, nxt["airport"], nxt["home"], nxt["tz"][0], "IN_PASSENGER_VEHICLE")
            visit(d, 960, 1439, nxt["home"], nxt["tz"][0], "HOME")

    segments.sort(key=lambda s: s["startTime"])
    last = CHAPTERS[-1]
    raw = []
    base = datetime(2026, 10, 10, 8, tzinfo=timezone(timedelta(minutes=-420)))
    for i in range(400):
        p = jitter(last["home"], 2)
        raw.append(dict(position=dict(LatLng=ll(p), accuracyMeters=12, source="GPS",
                                      timestamp=(base + timedelta(minutes=45 * i)).isoformat(timespec="milliseconds"))))
    profile = dict(persona=dict(travelModeAffinities=[dict(mode="WALKING", affinity=0.36), dict(mode="CYCLING", affinity=0.22),
                                                     dict(mode="IN_SUBWAY", affinity=0.18), dict(mode="IN_PASSENGER_VEHICLE", affinity=0.12)]))
    json.dump(dict(semanticSegments=segments, rawSignals=raw, userLocationProfile=profile), open(out, "w"), ensure_ascii=False)
    json.dump(cache, open(cache_out, "w"), ensure_ascii=False, indent=0)
    print(f"{len(segments)} segments, {len(cache)} named places -> {out}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
