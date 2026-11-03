/* Turns a Google Maps Timeline export into everything the story needs.
   Runs entirely in the browser (in a worker), so the file never leaves the device.
   A line-by-line port of pipeline/build.py. */

const EARTH_KM = 6371.0088;
const R = Math.PI / 180;

const parseLL = (s) => { const [a, b] = s.replace(/°/g, "").split(","); return [+a, +b]; };
const parseT = (s) => Date.parse(s) / 1000;
const dayOf = (localTs) => new Date(localTs * 1000).toISOString().slice(0, 10);
const round = (x, n = 0) => { const f = 10 ** n; return Math.round(x * f) / f; };
function hav(la1, lo1, la2, lo2) {
  const a = Math.sin(((la2 - la1) * R) / 2) ** 2 + Math.cos(la1 * R) * Math.cos(la2 * R) * Math.sin(((lo2 - lo1) * R) / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}
class Counter extends Map {
  add(k, v = 1) { this.set(k, (this.get(k) || 0) + v); return this; }
  mostCommon(n) { const a = [...this.entries()].sort((x, y) => y[1] - x[1]); return n == null ? a : a.slice(0, n); }
}
const lowerBound = (arr, x) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= x) lo = m + 1; else hi = m; } return lo; };

/* ---------------------------------------------------------------- geocoder
   Picks the most meaningful city near a point: big cities absorb their suburbs
   (score = population / (distance + 3 km)^2 within 35 km). */
class Geo {
  constructor(g) {
    this.g = g; this.countries = g.countries;
    this.cells = new Map();
    for (let i = 0; i < g.name.length; i++) {
      const k = `${Math.floor(g.lat[i] * 2)},${Math.floor(g.lon[i] * 2)}`;
      if (!this.cells.has(k)) this.cells.set(k, []);
      this.cells.get(k).push(i);
    }
    this.memo = new Map();
  }
  scan(lat, lon, rl) {
    const cy = Math.floor(lat * 2), cx = Math.floor(lon * 2);
    const rx = Math.min(720, Math.ceil(rl / Math.max(0.05, Math.cos(lat * R))));
    const out = [];
    for (let y = cy - rl; y <= cy + rl; y++) for (let x = cx - rx; x <= cx + rx; x++) {
      const c = this.cells.get(`${y},${((x + 360) % 720 + 720) % 720 - 360}`);
      if (c) out.push(...c);
    }
    return out;
  }
  lookup(lat, lon) {
    const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
    const hit = this.memo.get(key);
    if (hit) return hit;
    const g = this.g;
    let best = -1, bestScore = 0, near = -1, nearD = Infinity;
    for (const rl of [1, 4, 12]) {
      for (const i of this.scan(lat, lon, rl)) {
        const d = hav(lat, lon, g.lat[i], g.lon[i]);
        if (d < nearD) { nearD = d; near = i; }
        if (d < 35) { const s = Math.max(g.pop[i], 1) / (d + 3) ** 2; if (s > bestScore) { bestScore = s; best = i; } }
      }
      if (near >= 0) break;
    }
    const i = best >= 0 ? best : near;
    const res = [i, i < 0 || hav(lat, lon, g.lat[i], g.lon[i]) > 120];
    this.memo.set(key, res);
    return res;
  }
  row(i) { const g = this.g; return { name: g.name[i], cc: g.cc[i], lat: g.lat[i], lon: g.lon[i], pop: g.pop[i] }; }
}

export function processTimeline(raw, geoData, progress = () => {}) {
  const geo = new Geo(geoData);
  const segs = (raw.semanticSegments || []).slice().sort((a, b) => (a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0));
  if (!segs.length) throw new Error("This file has no timeline segments. Make sure it's the Timeline.json exported from the Google Maps app.");

  const tzKnown = [];
  for (const s of segs) if ("startTimeTimezoneUtcOffsetMinutes" in s) tzKnown.push([parseT(s.startTime), s.startTimeTimezoneUtcOffsetMinutes]);
  tzKnown.sort((a, b) => a[0] - b[0]);
  const tzT = tzKnown.map((x) => x[0]);
  const tzAt = (t) => (tzKnown.length ? tzKnown[Math.max(lowerBound(tzT, t) - 1, 0)][1] : 0);

  progress("Reading your timeline");
  const obs = []; // [t, lat, lon, kind] kind: 0 path, 1 visit, 2 activity, 3 raw
  const visits = [], acts = [], memories = [];
  for (const s of segs) {
    if (s.timelinePath) {
      for (const p of s.timelinePath) { const [la, lo] = parseLL(p.point); obs.push([parseT(p.time), la, lo, 0]); }
    } else if (s.visit) {
      const v = s.visit, tc = v.topCandidate || {};
      if (!tc.placeLocation?.latLng) continue;
      const [la, lo] = parseLL(tc.placeLocation.latLng);
      const t0 = parseT(s.startTime), t1 = parseT(s.endTime);
      visits.push({ t0, t1, tz: s.startTimeTimezoneUtcOffsetMinutes ?? tzAt(t0), lat: la, lon: lo, pid: tc.placeId, sem: tc.semanticType || "UNKNOWN", level: v.hierarchyLevel || 0 });
      obs.push([t0, la, lo, 1], [t1, la, lo, 1]);
    } else if (s.activity) {
      const a = s.activity;
      if (!a.start?.latLng || !a.end?.latLng) continue;
      const [la0, lo0] = parseLL(a.start.latLng), [la1, lo1] = parseLL(a.end.latLng);
      const t0 = parseT(s.startTime), t1 = parseT(s.endTime);
      acts.push({ t0, t1, tz: s.startTimeTimezoneUtcOffsetMinutes ?? tzAt(t0), lat0: la0, lon0: lo0, lat1: la1, lon1: lo1, km: (a.distanceMeters || 0) / 1000, mode: a.topCandidate?.type || "UNKNOWN_ACTIVITY_TYPE" });
      obs.push([t0, la0, lo0, 2], [t1, la1, lo1, 2]);
    } else if (s.timelineMemory?.trip) {
      const tr = s.timelineMemory.trip;
      memories.push({ t0: parseT(s.startTime), t1: parseT(s.endTime), tz: s.startTimeTimezoneUtcOffsetMinutes ?? 0, km: tr.distanceFromOriginKms, dest: (tr.destinations || []).map((d) => d.identifier?.placeId) });
    }
  }
  for (const r of raw.rawSignals || []) if (r.position?.LatLng) { const [la, lo] = parseLL(r.position.LatLng); obs.push([parseT(r.position.timestamp), la, lo, 3]); }
  obs.sort((a, b) => a[0] - b[0]);
  const N = obs.length;

  progress(`Placing ${N.toLocaleString("en-GB")} points on the map`);
  const O_tz = obs.map((o) => tzAt(o[0]));
  const O_local = obs.map((o, i) => o[0] + O_tz[i] * 60);
  const O_day = O_local.map(dayOf);
  const O_city = new Int32Array(N), O_far = new Uint8Array(N);
  for (let i = 0; i < N; i++) { const [c, f] = geo.lookup(obs[i][1], obs[i][2]); O_city[i] = c; O_far[i] = f ? 1 : 0; }

  /* cities */
  const cities = new Map();
  const cityEntry = (ci) => { if (!cities.has(ci)) cities.set(ci, { ...geo.row(ci), days: new Set(), n: 0 }); return cities.get(ci); };
  for (let i = 0; i < N; i++) { if (O_far[i]) continue; const c = cityEntry(O_city[i]); c.days.add(O_day[i]); c.n++; }

  /* homes */
  progress("Finding your homes");
  const clusters = [];
  for (const v of visits.filter((v) => v.sem === "HOME" || v.sem === "INFERRED_HOME")) {
    const c = clusters.find((c) => hav(c.lat, c.lon, v.lat, v.lon) < 0.15);
    if (c) c.v.push(v); else clusters.push({ lat: v.lat, lon: v.lon, v: [v] });
  }
  let homes = [];
  for (const c of clusters) {
    const nights = new Set(c.v.map((v) => dayOf(v.t0 + v.tz * 60)));
    if (nights.size < 5) continue;
    const ts = c.v.map((v) => v.t0).sort((a, b) => a - b);
    const nd = [...nights].sort();
    const core = [nd[Math.floor(nd.length * 0.05)], nd[Math.min(nd.length - 1, Math.floor(nd.length * 0.95))]];
    const ce = cityEntry(geo.lookup(c.lat, c.lon)[0]);
    const hours = c.v.reduce((a, v) => a + v.t1 - v.t0, 0) / 3600;
    homes.push({ lat: round(c.lat, 4), lon: round(c.lon, 4), city: ce.name, cc: ce.cc, country: geo.countries[ce.cc] || ce.cc,
      first: dayOf(ts[0]), last: dayOf(ts.at(-1)), core, days: nights.size, hours: Math.round(hours) });
  }
  homes.sort((a, b) => (a.core[0] < b.core[0] ? -1 : 1));
  const folded = [];
  for (const h of homes) {
    const prev = folded.at(-1);
    if (prev && hav(prev.lat, prev.lon, h.lat, h.lon) < 0.25) {
      prev.core = [prev.core[0], prev.core[1] > h.core[1] ? prev.core[1] : h.core[1]];
      prev.first = prev.first < h.first ? prev.first : h.first; prev.last = prev.last > h.last ? prev.last : h.last;
      prev.days += h.days; prev.hours += h.hours;
    } else folded.push(h);
  }
  homes = folded;
  const homePts = homes.map((h) => [h.lat, h.lon]);
  const homeCityNames = new Set(homes.map((h) => h.city));
  const nearHome = (lat, lon, km) => homePts.some(([la, lo]) => hav(lat, lon, la, lo) < km);

  /* places */
  const places = new Map();
  for (const v of visits) {
    if (v.level !== 0 || !v.pid) continue;
    if (!places.has(v.pid)) places.set(v.pid, { n: 0, hours: 0, days: new Set(), sem: new Counter(), lat: 0, lon: 0, first: null, last: null, wd: new Counter(), hr: new Counter(), yh: new Counter() });
    const p = places.get(v.pid);
    const d = dayOf(v.t0 + v.tz * 60);
    p.n++; p.hours += (v.t1 - v.t0) / 3600; p.days.add(d); p.sem.add(v.sem);
    p.lat = v.lat; p.lon = v.lon; p.first ??= d; p.last = d;
    const loc = new Date((v.t0 + v.tz * 60) * 1000);
    p.wd.add((loc.getUTCDay() + 6) % 7); p.hr.add(loc.getUTCHours()); p.yh.add(d.slice(0, 4), (v.t1 - v.t0) / 3600);
  }
  let placeOut = [];
  for (const [id, p] of places) {
    let sem = p.sem.mostCommon(1)[0][0];
    if (sem !== "HOME" && sem !== "INFERRED_HOME" && nearHome(p.lat, p.lon, 0.12)) sem = "HOME";
    const ce = cityEntry(geo.lookup(p.lat, p.lon)[0]);
    const [wd, wdn] = p.wd.mostCommon(1)[0];
    placeOut.push({ id, lat: round(p.lat, 5), lon: round(p.lon, 5), n: p.n, hours: round(p.hours, 1), days: p.days.size, sem,
      city: ce.name, cc: ce.cc, first: p.first, last: p.last, wd, hr: p.hr.mostCommon(1)[0][0], wd_share: round(wdn / p.n, 2),
      yh: Object.fromEntries([...p.yh].filter(([, h]) => h >= 0.5).map(([y, h]) => [y, round(h, 1)])) });
  }
  placeOut.sort((a, b) => b.hours - a.hours);
  const placeById = new Map(placeOut.map((p) => [p.id, p]));

  /* days */
  progress("Counting the days");
  const days = new Map();
  const dayEntry = (k) => { if (!days.has(k)) days.set(k, { n: 0, cities: new Counter(), km: 0, modes: new Counter() }); return days.get(k); };
  for (let i = 0; i < N; i++) { const d = dayEntry(O_day[i]); d.n++; if (!O_far[i]) d.cities.add(O_city[i]); }
  for (const a of acts) { const d = dayEntry(dayOf(a.t0 + a.tz * 60)); d.km += a.km; d.modes.add(a.mode, a.km); }

  /* long hops between consecutive observations (catches unlabelled flights) */
  let hops = [];
  for (let i = 1; i < N; i++) {
    const km = hav(obs[i - 1][1], obs[i - 1][2], obs[i][1], obs[i][2]);
    if (km > 150) {
      const hrs = Math.max((obs[i][0] - obs[i - 1][0]) / 3600, 0.01);
      hops.push({ t0: obs[i - 1][0], t1: obs[i][0], a: [round(obs[i - 1][2], 3), round(obs[i - 1][1], 3)], b: [round(obs[i][2], 3), round(obs[i][1], 3)], km: Math.round(km), fly: km > 700 || km / hrs > 250, day: O_day[i] });
    }
  }
  const merged = [];
  for (const h of hops) {
    const m = merged.at(-1);
    if (m && h.t0 - m.t1 < 4 * 3600 && m.b[0] === h.a[0] && m.b[1] === h.a[1]) {
      m.b = h.b; m.t1 = h.t1; m.fly = m.fly || h.fly; m.km = Math.round(hav(m.a[1], m.a[0], m.b[1], m.b[0]));
    } else merged.push({ ...h });
  }
  hops = merged.filter((h) => h.km > 150);
  const hopOut = hops.map((h) => {
    const a = geo.row(geo.lookup(h.a[1], h.a[0])[0]), b = geo.row(geo.lookup(h.b[1], h.b[0])[0]);
    return { day: h.day, a: h.a, b: h.b, km: h.km, fly: h.fly, from_: a.name, to: b.name, fcc: a.cc, tcc: b.cc };
  });

  /* cities & countries */
  const cityOut = [], cityIds = new Map();
  for (const [ci, c] of [...cities].sort((a, b) => b[1].days.size - a[1].days.size)) {
    if (!c.days.size) continue;
    const ds = [...c.days].sort();
    cityIds.set(ci, cityOut.length);
    cityOut.push({ name: c.name, cc: c.cc, lat: round(c.lat, 3), lon: round(c.lon, 3), days: ds.length, first: ds[0], last: ds.at(-1), n: c.n });
  }
  const countries = new Map();
  for (const [dk, d] of days) for (const ci of d.cities.keys()) {
    const cc = geo.g.cc[ci];
    if (!countries.has(cc)) countries.set(cc, { days: new Set(), cities: new Set() });
    countries.get(cc).days.add(dk); countries.get(cc).cities.add(ci);
  }
  const stayed = new Set();
  for (const v of visits) if (v.level === 0 && v.t1 - v.t0 > 1800) { const [ci, far] = geo.lookup(v.lat, v.lon); if (!far) stayed.add(geo.g.cc[ci]); }
  const countryOut = [...countries].map(([cc, c]) => {
    const ds = [...c.days].sort();
    const top = [...c.cities].sort((a, b) => cities.get(b).days.size - cities.get(a).days.size);
    return { cc, name: geo.countries[cc] || cc, days: ds.length, first: ds[0], last: ds.at(-1), cities: c.cities.size,
      top: top.slice(0, 6).map((ci) => cities.get(ci).name), years: [...new Set(ds.map((d) => d.slice(0, 4)))].sort(), stayed: stayed.has(cc) };
  }).sort((a, b) => (a.first < b.first ? -1 : 1));

  const dayOut = {};
  for (const dk of [...days.keys()].sort()) {
    const d = days.get(dk);
    const cl = d.cities.mostCommon().map(([ci]) => ci).filter((ci) => cityIds.has(ci)).map((ci) => cityIds.get(ci));
    dayOut[dk] = { n: d.n, c: cl.slice(0, 6), km: round(d.km, 1), m: Object.fromEntries(d.modes.mostCommon(3).filter(([, v]) => v > 0.05).map(([k, v]) => [k, round(v, 1)])) };
  }
  const dayKeys = Object.keys(dayOut);

  /* distance by year & mode */
  const distC = new Map();
  for (const a of acts) { const y = dayOf(a.t0 + a.tz * 60).slice(0, 4); if (!distC.has(y)) distC.set(y, new Counter()); distC.get(y).add(a.mode, a.km); }
  const dist = Object.fromEntries([...distC].sort().map(([y, c]) => [y, Object.fromEntries([...c].map(([m, k]) => [m, round(k, 1)]))]));

  /* rhythm: where the hours go, per month and per hour of the week */
  progress("Working out your rhythm");
  const monthMix = new Map(), weekMix = Array.from({ length: 168 }, () => new Counter());
  const bucket = (local, key, hrs) => {
    const dt = new Date(local * 1000);
    const m = dt.toISOString().slice(0, 7);
    if (!monthMix.has(m)) monthMix.set(m, new Counter());
    monthMix.get(m).add(key, hrs);
    weekMix[((dt.getUTCDay() + 6) % 7) * 24 + dt.getUTCHours()].add(key, hrs);
  };
  const spread = (t0, t1, tz, key) => {
    let t = t0;
    while (t < t1) { const nxt = Math.min(t1, (Math.floor((t + tz * 60) / 3600) + 1) * 3600 - tz * 60); bucket(t + tz * 60, key, (nxt - t) / 3600); t = nxt; }
  };
  for (const v of visits) {
    if (v.level !== 0 || v.t1 - v.t0 > 30 * 86400) continue;
    let key = { HOME: "home", INFERRED_HOME: "home", WORK: "work", INFERRED_WORK: "work" }[v.sem] || "out";
    if (key !== "home" && nearHome(v.lat, v.lon, 0.2)) key = "home";
    spread(v.t0, v.t1, v.tz, key);
  }
  for (const a of acts) if (a.t1 - a.t0 < 2 * 86400) spread(a.t0, a.t1, a.tz, "move");
  const rnd = (c) => Object.fromEntries([...c].map(([k, v]) => [k, round(v, 1)]));
  const months = Object.fromEntries([...monthMix].sort().map(([m, c]) => [m, rnd(c)]));
  const week = weekMix.map(rnd);

  /* data density */
  const density = new Map();
  for (let i = 0; i < N; i++) {
    if (obs[i][3] === 3) continue;
    const m = O_day[i].slice(0, 7);
    if (!density.has(m)) density.set(m, { n: 0, days: new Set(), kinds: [0, 0, 0, 0] });
    const d = density.get(m); d.n++; d.days.add(O_day[i]); d.kinds[obs[i][3]]++;
  }
  const gaps = new Map();
  for (let i = 1; i < N; i++) { const g = obs[i][0] - obs[i - 1][0]; if (g > 0 && g < 2 * 86400) { const y = O_day[i].slice(0, 4); if (!gaps.has(y)) gaps.set(y, []); gaps.get(y).push(g); } }
  const pctile = (arr, q) => { const a = arr.slice().sort((x, y) => x - y); const pos = (a.length - 1) * q, lo = Math.floor(pos); return a[lo] + (a[Math.min(lo + 1, a.length - 1)] - a[lo]) * (pos - lo); };
  const densityOut = Object.fromEntries([...density].sort().map(([m, d]) => [m, { n: d.n, days: d.days.size, path: d.kinds[0], visit: d.kinds[1], act: d.kinds[2], raw: d.kinds[3] }]));
  const gapOut = Object.fromEntries([...gaps].sort().map(([y, g]) => [y, { median_min: round(pctile(g, 0.5) / 60, 1), p90_min: round(pctile(g, 0.9) / 60, 1) }]));

  /* superlatives */
  const sup = {};
  const obsPoint = (i, label) => { const r = geo.row(O_city[i]); return { label, lat: round(obs[i][1], 4), lon: round(obs[i][2], 4), day: O_day[i], city: r.name, cc: r.cc }; };
  let iN = -1, iS = -1, iE = -1, iW = -1, iF = -1, farKm = -1;
  for (let i = 0; i < N; i++) {
    if (O_far[i]) continue;
    const [, la, lo] = obs[i];
    if (iN < 0 || la > obs[iN][1]) iN = i;
    if (iS < 0 || la < obs[iS][1]) iS = i;
    if (iE < 0 || lo > obs[iE][2]) iE = i;
    if (iW < 0 || lo < obs[iW][2]) iW = i;
    if (homePts.length) { const d = Math.min(...homePts.map(([a, b]) => hav(la, lo, a, b))); if (d > farKm) { farKm = d; iF = i; } }
  }
  if (iN >= 0) {
    sup.north = obsPoint(iN, "Furthest north"); sup.south = obsPoint(iS, "Furthest south");
    sup.east = obsPoint(iE, "Furthest east"); sup.west = obsPoint(iW, "Furthest west");
  }
  if (iF >= 0) { sup.farthest = obsPoint(iF, "Farthest from any home"); sup.farthest.km = Math.round(farKm); }
  if (dayKeys.length) {
    const busiest = dayKeys.reduce((a, b) => (dayOut[b].km > dayOut[a].km ? b : a));
    sup.longest_day = { day: busiest, km: dayOut[busiest].km, modes: dayOut[busiest].m, cities: dayOut[busiest].c.map((c) => cityOut[c].name) };
    const most = dayKeys.reduce((a, b) => (dayOut[b].c.length > dayOut[a].c.length ? b : a));
    sup.most_cities_day = { day: most, cities: dayOut[most].c.map((c) => cityOut[c].name) };
  }
  const speed = (a) => a.km / Math.max((a.t1 - a.t0) / 3600, 0.01);
  const best = (list) => list.reduce((a, b) => (!a || b.km > a.km ? b : a), null);
  const walk = best(acts.filter((a) => a.mode === "WALKING" && a.t1 - a.t0 < 6 * 3600 && speed(a) < 7));
  const ride = best(acts.filter((a) => a.mode === "CYCLING" && speed(a) < 25));
  const actSum = (a) => ({ day: dayOf(a.t0 + a.tz * 60), km: round(a.km, 1), mins: Math.round((a.t1 - a.t0) / 60), lat: a.lat0, lon: a.lon0 });
  if (walk) sup.longest_walk = actSum(walk);
  if (ride) sup.longest_ride = actSum(ride);
  let streak = 0, bestStreak = 0, curStart = null, bestRange = null, prev = null;
  for (const dk of dayKeys) {
    const names = new Set(dayOut[dk].c.map((c) => cityOut[c].name));
    const away = names.size && ![...names].some((n) => homeCityNames.has(n));
    const contiguous = prev && (Date.parse(dk) - Date.parse(prev)) / 864e5 === 1;
    if (away) {
      if (streak && contiguous) streak++; else { streak = 1; curStart = dk; }
      if (streak > bestStreak) { bestStreak = streak; bestRange = [curStart, dk]; }
    } else streak = 0;
    prev = dk;
  }
  if (bestRange) sup.longest_away = { days: bestStreak, start: bestRange[0], end: bestRange[1] };

  /* Google's own trip memories */
  const tripOut = [];
  const obsT = obs.map((o) => o[0]);
  for (const m of memories) {
    const i0 = lowerBound(obsT, m.t0 - 1e-9);
    const sel = [];
    for (let i = Math.max(0, i0 - 1); i < N && obs[i][0] <= m.t1; i++) if (obs[i][0] >= m.t0 && !O_far[i]) sel.push(i);
    const cc = new Counter();
    for (const i of sel) cc.add(O_city[i]);
    const top = cc.mostCommon(12).map(([ci]) => geo.row(ci)).filter((r) => !homeCityNames.has(r.name)).slice(0, 5);
    const dests = m.dest.filter((p) => placeById.has(p));
    if (!top.length && !dests.length) continue;
    const pts = sel.filter((_, k) => k % 5 === 0).map((i) => [round(obs[i][2], 3), round(obs[i][1], 3)]);
    const los = sel.map((i) => obs[i][2]), las = sel.map((i) => obs[i][1]);
    tripOut.push({ start: dayOf(m.t0 + m.tz * 60), end: dayOf(m.t1 + m.tz * 60), km: m.km, cities: top.map((r) => r.name), ccs: [...new Set(top.map((r) => r.cc))].sort(),
      bbox: sel.length ? [Math.min(...los), Math.min(...las), Math.max(...los), Math.max(...las)] : null, path: pts.slice(0, 400) });
  }

  /* chapters: life around each home, and year by year */
  progress("Writing your chapters");
  homes.forEach((h, i) => {
    h.from = h.core[0];
    if (i && homes[i - 1].cc !== h.cc) {
      const dk = dayKeys.find((k) => k > homes[i - 1].core[1] && dayOut[k].c.length && cityOut[dayOut[k].c[0]].cc === h.cc);
      if (dk && dk < h.from) h.from = dk;
    }
  });
  const haunts = placeOut.filter((p) => p.sem !== "HOME" && p.sem !== "INFERRED_HOME");
  const keep = new Set(haunts.slice(0, 160).map((p) => p.id));
  const actDays = acts.map((x) => [dayOf(x.t0 + x.tz * 60), x]);
  const visitDays = visits.filter((v) => !v.level && v.pid && placeById.has(v.pid) && !/HOME/.test(placeById.get(v.pid).sem)).map((v) => [dayOf(v.t0 + v.tz * 60), v]);
  const periodStats = (a, b) => {
    const ks = dayKeys.filter((k) => a <= k && k < b);
    const km = new Counter();
    for (const [dk, x] of actDays) if (a <= dk && dk < b) km.add(x.mode, x.km);
    const ccs = new Counter(), cs = new Set();
    for (const k of ks) { for (const c of dayOut[k].c) cs.add(c); if (dayOut[k].c.length) ccs.add(cityOut[dayOut[k].c[0]].cc); }
    return { days: ks.length, km: Object.fromEntries(km.mostCommon().filter(([, v]) => v >= 1).map(([m, v]) => [m, Math.round(v)])),
      countries: ccs.mostCommon(), cities: cs.size, new_cities: [...cs].filter((c) => a <= cityOut[c].first && cityOut[c].first < b).length,
      trips: tripOut.filter((t) => a <= t.start && t.start < b).length };
  };
  const topPlaces = (a, b, n = 6) => {
    const c = new Counter();
    for (const [dk, v] of visitDays) if (a <= dk && dk < b) c.add(v.pid, (v.t1 - v.t0) / 3600);
    return c.mostCommon(n).map(([pid, h]) => { keep.add(pid); return [pid, round(h, 1)]; });
  };
  homes.forEach((h, i) => {
    const end = i + 1 < homes.length ? homes[i + 1].from : "9999";
    h.life = periodStats(h.from, end);
    h.life.top = topPlaces(h.from, end);
  });
  const yearsOut = {};
  for (const y of [...new Set(dayKeys.map((k) => k.slice(0, 4)))].sort()) {
    const st = periodStats(`${y}-01-01`, `${+y + 1}-01-01`);
    if (st.days < 3) continue;
    st.top = topPlaces(`${y}-01-01`, `${+y + 1}-01-01`);
    yearsOut[y] = st;
  }
  const placeExport = placeOut.filter((p) => keep.has(p.id) || /HOME/.test(p.sem)).slice(0, 400);

  /* heat points, per year, on a ~150 m grid */
  progress("Developing the long exposure");
  const grid = new Counter();
  for (let i = 0; i < N; i++) grid.add(`${round(obs[i][1], 3)}|${round(obs[i][2], 3)}|${O_day[i].slice(0, 4)}`);
  const heat = {};
  for (const [k, n] of grid) { const [la, lo, y] = k.split("|"); (heat[y] ??= []).push(+lo, +la, n); }

  /* per-day tracks */
  const tracks = {};
  for (let i = 0; i < N; i++) {
    const mins = Math.floor((((O_local[i] % 86400) + 86400) % 86400) / 60);
    const p = [round(obs[i][2], 4), round(obs[i][1], 4), mins];
    const t = (tracks[O_day[i]] ??= []);
    const last = t.at(-1);
    if (!last || last[0] !== p[0] || last[1] !== p[1]) t.push(p);
  }

  const kinds = [0, 0, 0, 0];
  for (const o of obs) kinds[o[3]]++;
  const modesTotal = new Counter();
  for (const a of acts) modesTotal.add(a.mode, a.km);
  const summary = {
    first: O_day[0], last: O_day.at(-1), observations: N, visits: visits.length, activities: acts.length,
    days_with_data: dayKeys.length, cities: cityOut.length, countries: countryOut.length,
    km_total: Math.round(acts.reduce((a, x) => a + x.km, 0)), places: placeOut.length,
    kinds: { path: kinds[0], visit: kinds[1], act: kinds[2], raw: kinds[3] },
    modes_total: Object.fromEntries(modesTotal.mostCommon().map(([m, k]) => [m, Math.round(k)])),
    persona: raw.userLocationProfile?.persona || {},
  };
  const data = { summary, homes, cities: cityOut, countries: countryOut, days: dayOut, dist, months, week, density: densityOut,
    gaps: gapOut, sup, trips: tripOut, hops: hopOut, places: placeExport, years: yearsOut, heat };
  return { data, tracks };
}
