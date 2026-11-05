/* Long Exposure: years of Google Maps Timeline, told as a scrolling story. */

const C = {
  ink: "#131b36", deep: "#0b1129", raised: "#1a2446", line: "#2a3561",
  sodium: "#f2a947", sodiumMark: "#cf7f22", contrail: "#7ccbea", contrailMark: "#2e97c9",
  star: "#eef0f7", dust: "#a3abc9", haze: "#6f79a0",
};
const EARTH = 40075, MOON = 384400;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const narrow = () => matchMedia("(max-width: 860px)").matches;

const $ = (s) => document.querySelector(s);
const fmt = (n) => Math.round(n).toLocaleString("en-GB");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const D = (k) => new Date(k + "T00:00:00Z");
const key = (d) => d.toISOString().slice(0, 10);
const dayLong = (k) => { const d = D(k); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const monthYear = (k) => { const d = D(k); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const daysBetween = (a, b) => Math.round((D(b) - D(a)) / 864e5);
const duration = (days) => {
  if (days < 45) return `${days} days`;
  const m = Math.round(days / 30.44);
  if (m < 18) return `${m} months`;
  const y = days / 365.25;
  return `${(Math.round(y * 2) / 2).toString().replace(".5", "½")} years`;
};
const haversine = (la1, lo1, la2, lo2) => {
  const r = Math.PI / 180, a = Math.sin(((la2 - la1) * r) / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(((lo2 - lo1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
};
const pct = (x) => `${Math.round(x * 100)}%`;
const list = (a) => a.length < 2 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a.at(-1)}`;

function svg(tag, attrs = {}, parent) {
  const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}
function html(tag, attrs = {}, inner = "") {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  n.innerHTML = inner;
  return n;
}

/* ------------------------------------------------------------ tooltip */
const tip = $("#tip");
function showTip(e, content) {
  tip.innerHTML = content;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let x = e.clientX + 14, y = e.clientY + 14;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
  if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
  tip.style.left = x + "px"; tip.style.top = y + "px";
}
const hideTip = () => (tip.hidden = true);
function hover(node, content) {
  node.addEventListener("pointermove", (e) => showTip(e, typeof content === "function" ? content() : content));
  node.addEventListener("pointerleave", hideTip);
}

/* ------------------------------------------------------------ load */
// js/main.js decides where the data comes from (a dropped file, a saved visit, a local build or the demo)
const LE = globalThis.__LE;
const data = LE.data;
if (LE.mode === "demo") document.body.classList.add("is-demo");
let tracksP = null;
const tracks = () => (tracksP ??= LE.tracks());

const S = data.summary;
const homes = data.homes;
const cities = data.cities;
const dayKeys = Object.keys(data.days).sort();
const years = Object.keys(data.heat).sort();

homes.forEach((h, i) => {
  if (h.from) return;
  h.from = h.core[0];
  const prev = homes[i - 1];
  if (prev && prev.cc !== h.cc) {
    const arrive = dayKeys.find((k) => k > prev.core[1] && data.days[k].c.length && cities[data.days[k].c[0]].cc === h.cc);
    if (arrive && arrive < h.from) h.from = arrive;
  }
});
function homeOn(k) {
  let h = homes[0];
  for (const x of homes) if (x.from <= k) h = x;
  return h;
}
/* places: names and kinds from OpenStreetMap, when the enrich step has run */
const placeById = Object.fromEntries((data.places || []).map((p) => [p.id, p]));
const KINDS = [
  ["Work and study", (o, p) => /WORK/.test(p.sem) || o.cat === "office" || ["university", "college", "school", "office", "coworking_space", "research_institute", "kindergarten"].includes(o.type)],
  ["Stations and airports", (o) => ["railway", "aeroway", "public_transport"].includes(o.cat) || ["bus_station", "station", "platform", "halt", "aerodrome", "terminal"].includes(o.type)],
  ["Groceries and shops", (o) => o.cat === "shop" || o.type === "marketplace"],
  ["Food and drink", (o) => ["restaurant", "cafe", "fast_food", "bar", "pub", "biergarten", "food_court", "ice_cream", "nightclub"].includes(o.type)],
  ["Sport and outdoors", (o) => o.cat === "leisure" || o.cat === "natural" || ["sports_centre", "fitness_centre", "swimming_pool", "pitch", "stadium"].includes(o.type)],
  ["Sights and hotels", (o) => ["tourism", "historic"].includes(o.cat) || ["place_of_worship", "theatre", "cinema", "arts_centre", "events_venue", "casino"].includes(o.type)],
  ["Health", (o) => ["hospital", "doctors", "pharmacy", "dentist", "clinic"].includes(o.type)],
  ["Other people's homes, probably", (o) => ["house", "residential", "apartments", "detached", "terrace", "semidetached_house", "dormitory"].includes(o.type) || (["building", "place", "highway"].includes(o.cat) && !o.name)],
];
const OTHER_KIND = "Everywhere else";
// Nominatim sometimes snaps to a lamp post or a road: treat those as "a spot on <road>"
const NOISE = new Set(["siren", "toilets", "bench", "parking", "bicycle_parking", "waste_basket", "parking_space", "vending_machine", "post_box", "street_lamp", "yes", "parking_entrance", "drinking_water", "recycling", "charging_station", "atm", "telephone"]);
function osmOf(p) {
  const o = p.osm || {};
  if (o.cat === "highway" && o.type === "residential") return { ...o, name: "", cat: "place", type: "house" };
  if (o.cat === "highway" || o.cat === "emergency" || NOISE.has(o.type)) return { ...o, name: "", cat: "spot", type: "spot" };
  if (o.name && (o.name.length < 3 || /^[\d\s\-ab]+$/i.test(o.name))) return { ...o, name: "" }; // platform "1", gate "4b"
  return o;
}
function placeKind(p) {
  const o = osmOf(p);
  for (const [k, test] of KINDS) if (test(o, p)) return k;
  return OTHER_KIND;
}
function placeName(p) {
  const o = osmOf(p);
  if (o.name) return o.name;
  if (/WORK/.test(p.sem)) return o.road ? `Work, ${o.road}` : `Work in ${p.city}`;
  if (o.road) return `Somewhere on ${o.road}`;
  return `A spot in ${p.city}`;
}
const habit = (p) => p.n >= 6 && p.wd_share >= 0.3 ? `usually ${WEEKDAYS[p.wd]}s around ${String(p.hr).padStart(2, "0")}:00` : "";
const hrs = (h) => h >= 72 ? `${fmt(h)} hours (${fmt(h / 24)} days)` : `${fmt(h)} hours`;
const hrsShort = (h) => `${fmt(h)} h`;
const haunts = (data.places || []).filter((p) => !/HOME/.test(p.sem));

const flightDays = new Set(data.hops.filter((h) => h.fly).map((h) => h.day));
function classify(k) {
  const d = data.days[k];
  if (!d) return "none";
  if (flightDays.has(k) || (d.m && d.m.FLYING)) return "fly";
  const h = homeOn(k);
  const cs = d.c.map((i) => cities[i]);
  if (!cs.length) return "home";
  if (cs.some((c) => c.cc !== h.cc)) return "abroad";
  if (cs[0].name !== h.city) return "away";
  return "home";
}

/* ------------------------------------------------------------ map */
const map = new maplibregl.Map({
  container: "map",
  style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  bounds: [[-125, 5], [90, 60]],
  attributionControl: { compact: true },
  dragRotate: false, pitchWithRotate: false,
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
map.touchZoomRotate.disableRotation();

function tint() {
  for (const l of map.getStyle().layers) {
    const id = l.id;
    try {
      if (l.type === "background") map.setPaintProperty(id, "background-color", C.ink);
      else if (l.type === "fill") map.setPaintProperty(id, "fill-color", /water/.test(id) ? C.deep : /building/.test(id) ? "#18213f" : "#151e3b");
      else if (l.type === "line") {
        const c = /water|river/.test(id) ? C.deep : /boundary|admin/.test(id) ? "#34417a" : "#1f2a50";
        map.setPaintProperty(id, "line-color", c);
      } else if (l.type === "symbol") {
        map.setPaintProperty(id, "text-color", /place|country|city/.test(id) ? "#7983ab" : "#545e88");
        map.setPaintProperty(id, "text-halo-color", C.ink);
      }
    } catch { /* some layers have no such paint */ }
  }
}

function greatCircle(a, b, n = 64) {
  const r = Math.PI / 180;
  const toV = ([lo, la]) => [Math.cos(la * r) * Math.cos(lo * r), Math.cos(la * r) * Math.sin(lo * r), Math.sin(la * r)];
  const A = toV(a), B = toV(b);
  const w = Math.acos(Math.min(1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2]));
  if (w < 1e-6) return [a, b];
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, s1 = Math.sin((1 - t) * w) / Math.sin(w), s2 = Math.sin(t * w) / Math.sin(w);
    const x = s1 * A[0] + s2 * B[0], y = s1 * A[1] + s2 * B[1], z = s1 * A[2] + s2 * B[2];
    let lon = Math.atan2(y, x) / r;
    if (out.length) { const prev = out.at(-1)[0]; while (lon - prev > 180) lon -= 360; while (lon - prev < -180) lon += 360; } // stay continuous across the date line
    out.push([lon, Math.atan2(z, Math.hypot(x, y)) / r]);
  }
  return out;
}

const fc = (features) => ({ type: "FeatureCollection", features });
const heatFC = fc(years.flatMap((y) => {
  const a = data.heat[y], f = [];
  for (let i = 0; i < a.length; i += 3) {
    const j1 = (Math.sin(i * 12.9898 + +y) * 43758.5453) % 1, j2 = (Math.sin(i * 78.233 + +y) * 12543.1234) % 1;
    f.push({ type: "Feature", properties: { y: +y, n: a[i + 2] }, geometry: { type: "Point", coordinates: [a[i] + j1 * 0.0006, a[i + 1] + j2 * 0.0004] } });
  }
  return f;
}));
const arcFC = fc(data.hops.map((h) => ({
  type: "Feature", properties: { y: +h.day.slice(0, 4), fly: h.fly },
  geometry: { type: "LineString", coordinates: greatCircle(h.a, h.b) },
})));
const homeFC = fc(homes.map((h, i) => ({ type: "Feature", properties: { i }, geometry: { type: "Point", coordinates: [h.lon, h.lat] } })));

const mapReady = new Promise((res) => map.on("load", res));
await mapReady;
tint();
map.addSource("heat", { type: "geojson", data: heatFC });
map.addSource("arcs", { type: "geojson", data: arcFC });
map.addSource("homes", { type: "geojson", data: homeFC });
map.addSource("focus", { type: "geojson", data: fc([]) });
map.addSource("focus-pts", { type: "geojson", data: fc([]) });

map.addLayer({
  id: "arcs", type: "line", source: "arcs",
  layout: { "line-cap": "round" },
  paint: {
    "line-color": ["case", ["get", "fly"], C.contrail, C.sodium],
    "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.8, 6, 1.6],
    "line-opacity": 0.42, "line-blur": 0.6,
  },
});
const GLOW_OPACITY = ["interpolate", ["linear"], ["zoom"], 1, 0.16, 6, 0.1, 12, 0.12];
const CORE_OPACITY = ["interpolate", ["linear"], ["zoom"], 1, 0.55, 8, 0.6, 14, 0.8];
map.addLayer({
  id: "heat", type: "circle", source: "heat",
  paint: {
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, ["+", 2, ["*", 1.2, ["ln", ["+", 1, ["get", "n"]]]]], 8, ["+", 6, ["*", 2, ["ln", ["+", 1, ["get", "n"]]]]], 14, 22],
    "circle-color": C.sodium, "circle-blur": 1, "circle-opacity": GLOW_OPACITY,
  },
});
map.addLayer({
  id: "dots", type: "circle", source: "heat",
  paint: {
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 0.6, 8, 1.1, 14, 2.6],
    "circle-color": ["interpolate", ["linear"], ["ln", ["+", 1, ["get", "n"]]], 0, C.sodium, 4, "#ffe2a8", 7, "#fff7e6"],
    "circle-blur": 0.4, "circle-opacity": CORE_OPACITY,
  },
});
map.addLayer({
  id: "homes", type: "circle", source: "homes",
  paint: {
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 3, 12, 6],
    "circle-color": C.ink, "circle-stroke-color": C.star, "circle-stroke-width": 1.5,
  },
});
map.addLayer({
  id: "focus", type: "line", source: "focus",
  layout: { "line-cap": "round", "line-join": "round" },
  paint: { "line-color": ["get", "col"], "line-width": ["interpolate", ["linear"], ["zoom"], 4, 2, 14, 4], "line-opacity": 0.95 },
});
map.addLayer({
  id: "focus-pts", type: "circle", source: "focus-pts",
  paint: { "circle-radius": 4, "circle-color": ["get", "col"], "circle-stroke-color": C.ink, "circle-stroke-width": 2 },
});

let dimmed = false;
function dimLife(on) {
  if (on === dimmed) return;
  dimmed = on;
  map.setPaintProperty("heat", "circle-opacity", on ? 0.02 : GLOW_OPACITY);
  map.setPaintProperty("dots", "circle-opacity", on ? 0.15 : CORE_OPACITY);
  map.setPaintProperty("arcs", "line-opacity", on ? 0.12 : 0.42);
}
function arcsBright(on) { map.setPaintProperty("arcs", "line-opacity", on ? 0.75 : 0.42); }
function setYear(y) {
  const f = y == null ? null : ["<=", ["get", "y"], y];
  map.setFilter("heat", f); map.setFilter("dots", f); map.setFilter("arcs", f);
}
function onlyYear(y) {
  const f = y == null ? null : ["==", ["get", "y"], y];
  map.setFilter("heat", f); map.setFilter("dots", f); map.setFilter("arcs", f);
}
function clearFocus() {
  map.getSource("focus").setData(fc([]));
  map.getSource("focus-pts").setData(fc([]));
}

const padding = () => narrow()
  ? { top: 40, bottom: 40, left: 30, right: 30 }
  : { top: 70, bottom: 70, left: $("#story").offsetWidth + 50, right: 90 };
function fit(bbox, opts = {}) {
  const [w, s, e, n] = bbox;
  map.fitBounds([[w, s], [e, n]], { padding: 24, maxZoom: opts.maxZoom ?? 12, duration: reduceMotion ? 0 : opts.duration ?? 2200, essential: true });
}
function flyTo(lon, lat, zoom, opts = {}) {
  map.flyTo({ center: [lon, lat], zoom, duration: reduceMotion ? 0 : opts.duration ?? 2400, essential: true, curve: 1.5 });
}
const bboxOf = (pts) => {
  let w = 180, s = 90, e = -180, n = -90;
  for (const [lo, la] of pts) { w = Math.min(w, lo); e = Math.max(e, lo); s = Math.min(s, la); n = Math.max(n, la); }
  const pad = 0.02;
  return [w - pad, s - pad, e + pad, n + pad];
};
// the story column covers the left of the map: keep the camera's centre in the visible part
map.setPadding(padding());
addEventListener("resize", () => map.setPadding(padding()));
const worldBox = bboxOf(cities.filter((c) => c.days > 0).map((c) => [c.lon, c.lat]));

/* pins: HTML markers with real typography */
let pins = [];
function setPins(items) {
  pins.forEach((p) => p.remove());
  pins = items.map(({ lon, lat, label, sub, flip, small }) => {
    const el = html("div", { class: `pin${flip ? " flip" : ""}${small ? " small" : ""}` }, `<i></i><span>${label}${sub ? `<small>${sub}</small>` : ""}</span>`);
    return new maplibregl.Marker({ element: el, anchor: flip ? "right" : "left" }).setLngLat([lon, lat]).addTo(map);
  });
}

/* ------------------------------------------------------------ hero */
const yearDial = $("#year-dial"), yearNum = $("#year-num");
const kmTotal = S.km_total;
$("#hero-lede").innerHTML =
  `Since ${dayLong(S.first)} your phone has noted where you were <strong>${fmt(S.observations)}</strong> times. ` +
  `Here they all are at once, every point a little light left on the map.`;
const spanYears = Math.round(daysBetween(S.first, S.last) / 365.25);
const NUM = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen", "Twenty"];
$("#hero-title").textContent = `${NUM[spanYears] ?? spanYears} ${spanYears === 1 ? "year" : "years"}, in one long exposure`;
document.title = `Long Exposure: ${spanYears} years of where you've been`;
const facts = [
  [fmt(S.days_with_data), "days on record"],
  [fmt(S.cities), "towns and cities"],
  [S.countries, "countries"],
  [fmt(kmTotal), "kilometres travelled"],
  [`${(kmTotal / EARTH).toFixed(1)}×`, "around the Earth"],
  [homes.length, "front doors"],
];
$("#hero-facts").innerHTML = facts.map(([v, l]) => `<div><dt>${l}</dt><dd>${v}</dd></div>`).join("");

let replaying = false;
async function replay() {
  if (replaying) return;
  replaying = true;
  yearDial.classList.remove("off"); yearDial.classList.add("lit");
  if (reduceMotion) { setYear(null); yearNum.textContent = years.at(-1); replaying = false; return; }
  for (const y of years) {
    if (!data.heat[y] || data.heat[y].length < 30) continue; // skip near-empty years
    setYear(+y); yearNum.textContent = y;
    await new Promise((r) => setTimeout(r, 620));
  }
  setYear(null);
  replaying = false;
}
$("#replay").addEventListener("click", () => { fit(worldBox, { maxZoom: 4 }); replay(); });

/* ------------------------------------------------------------ density */
{
  const months = Object.keys(data.density);
  // fill missing months so the silence shows as silence
  const all = [];
  for (let d = D(months[0] + "-01"); key(d).slice(0, 7) <= months.at(-1); d.setUTCMonth(d.getUTCMonth() + 1)) all.push(key(d).slice(0, 7));
  const vals = all.map((m) => data.density[m]?.n ?? 0);
  // longest run of near-empty months: the quiet stretch
  let best = [0, 0], run = 0;
  all.forEach((m, i) => {
    run = (data.density[m]?.days ?? 0) < 5 ? run + 1 : 0;
    if (run > best[1] - best[0]) best = [i - run + 1, i + 1];
  });
  const hasQuiet = best[1] - best[0] >= 3;
  const quiet = hasQuiet ? [all[best[0]], all[best[1] - 1]] : [all[0], all[0]];
  const quietDays = dayKeys.filter((k) => k.slice(0, 7) >= quiet[0] && k.slice(0, 7) <= quiet[1]).length;
  const gap = [quietDays, quiet[0] + "-01", quiet[1] + "-01"];
  const gaps = data.gaps;
  const gy = Object.keys(gaps).filter((y) => data.density[`${y}-06`] || data.density[`${y}-01`]);
  const busiest = all[vals.indexOf(Math.max(...vals))];
  const firstFull = (hasQuiet && Object.keys(gaps).find((y) => y > quiet[1].slice(0, 4))) || Object.keys(gaps)[0];
  const yearsDense = Object.entries(gaps).filter(([y]) => y >= firstFull);
  const tight = yearsDense.reduce((a, b) => (b[1].p90_min < a[1].p90_min ? b : a));
  const coverage = (y) => {
    const n = dayKeys.filter((k) => k.startsWith(y)).length;
    const total = y === S.last.slice(0, 4) ? daysBetween(`${y}-01-01`, S.last) + 1 : 365;
    return n / total;
  };
  $("#density-prose").innerHTML = `
    ${hasQuiet ? `<p>Google didn't record your life evenly. It started on <strong>${dayLong(S.first)}</strong>, kept a patchy watch until ${monthYear(all[Math.max(best[0] - 1, 0)] + "-01")}, and then went almost silent. From <strong>${monthYear(gap[1])}</strong> to <strong>${monthYear(gap[2])}</strong>, ${best[1] - best[0]} months in all, only <strong>${gap[0]} days</strong> left any trace. Whatever happened then, the map doesn't know.</p>`
      : `<p>It started on <strong>${dayLong(S.first)}</strong> and never really stopped: ${pct(dayKeys.length / (daysBetween(S.first, S.last) + 1))} of all days since then have at least one point.</p>`}
    <p>From ${firstFull} it settles into a steady habit. In a typical moment your phone checked in every <strong>${gaps[firstFull]?.median_min ?? "few"} minutes</strong>, and by ${tight[0]}, nine out of ten gaps were shorter than <strong>${Math.round(tight[1].p90_min)} minutes</strong>. The busiest month on record was <strong>${monthYear(busiest + "-01")}</strong>.</p>
    ${S.kinds.raw ? `<p>On top of that, your phone still holds <strong>${fmt(S.kinds.raw)}</strong> raw GPS fixes from the last few weeks, the unedited version before Google turns points into places and journeys. They're on the map but not in this chart.</p>` : ""}`;

  const W = 470, H = 170, pad = { l: 34, r: 4, t: 10, b: 22 };
  const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
  const max = Math.max(...vals);
  const bw = (W - pad.l - pad.r) / all.length;
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const g = svg("g", { class: "grid" }, s);
  const tick = Math.pow(10, Math.floor(Math.log10(max)));
  const step = max / tick > 5 ? tick * 2 : tick;
  for (let v = 0; v <= max; v += step) {
    svg("line", { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), opacity: v ? 0.5 : 1 }, g);
    const t = svg("text", { x: pad.l - 6, y: y(v) + 4, "text-anchor": "end", class: "lbl" }, s); t.textContent = v >= 1000 ? `${v / 1000}k` : v;
  }
  all.forEach((m, i) => {
    const v = vals[i];
    const grp = svg("g", { class: "hoverable" }, s);
    if (v) svg("rect", { class: "bar", x: pad.l + i * bw + 0.5, width: Math.max(bw - 1, 1), y: y(v), height: y(0) - y(v), rx: 1 }, grp);
    const hit = svg("rect", { class: "hit", x: pad.l + i * bw, width: bw, y: pad.t, height: H - pad.t - pad.b }, grp);
    const dd = data.density[m];
    hover(hit, `<b>${monthYear(m + "-01")}</b><br>${v ? `${fmt(v)} points<br><span>${dd.days} days with data</span>` : "<span>No data</span>"}`);
    hit.addEventListener("pointerenter", () => onlyYear(+m.slice(0, 4)));
    hit.addEventListener("pointerleave", () => onlyYear(null));
    if (m.endsWith("-01") && +m.slice(0, 4) % 2 === 0) {
      const t = svg("text", { x: pad.l + i * bw, y: H - 6, class: "lbl" }, s); t.textContent = m.slice(0, 4);
    }
  });
  // annotate the silence
  const gi = best[0], gj = best[1];
  if (hasQuiet && gj - gi > 6) {
    const cx = pad.l + ((gi + gj) / 2) * bw;
    const t = svg("text", { x: cx, y: y(max * 0.35), "text-anchor": "middle", class: "annot" }, s);
    t.textContent = "the quiet years";
  }
  $("#density-chart").append(s);
  const cap = html("p", { class: "caption" }, "Location points per month. Hover a month to light up only that year on the map.");
  $("#density-chart").append(cap);
}

/* ------------------------------------------------------------ homes */
let activeBtn = null;
function press(btn) {
  if (activeBtn) activeBtn.setAttribute("aria-pressed", "false");
  activeBtn = btn;
  if (btn) btn.setAttribute("aria-pressed", "true");
}
{
  const t0 = D(S.first.slice(0, 4) + "-01-01"), t1 = D(S.last.slice(0, 4) + "-12-31");
  const xp = (k) => ((D(k) - t0) / (t1 - t0)) * 100;
  const byCity = {};
  homes.forEach((h) => (byCity[h.city] = (byCity[h.city] || 0) + 1));
  const longest = homes.reduce((a, b) => (daysBetween(...b.core) > daysBetween(...a.core) ? b : a));
  const perYear = {};
  homes.forEach((h) => { for (let y = +h.core[0].slice(0, 4); y <= +h.core[1].slice(0, 4); y++) perYear[y] = (perYear[y] || 0) + 1; });
  const [busyY, busyN] = Object.entries(perYear).reduce((a, b) => (b[1] > a[1] ? b : a));
  const cityNames = Object.keys(byCity);
  const current = homes.at(-1);
  const mi = homes.findIndex((h, i) => i && h.cc !== homes[i - 1].cc);
  const move = mi > 0 ? { day: homes[mi].from, from_: homes[mi - 1].city, to: homes[mi].city, toCountry: data.countries.find((c) => c.cc === homes[mi].cc)?.name,
    km: haversine(homes[mi - 1].lat, homes[mi - 1].lon, homes[mi].lat, homes[mi].lon) } : null;
  $("#homes-prose").innerHTML = `
    <p>Google worked out where you slept from the rhythm of your nights. It counts <strong>${homes.length} homes</strong>: ${cityNames.length === 1 ? cityNames[0] : list(cityNames.map((c) => `${byCity[c]} in ${c}`))}.</p>
    <p>${move ? `The big jump came on <strong>${dayLong(move.day)}</strong>, when ${move.from_} gave way to ${move.toCountry}: ${fmt(move.km)} km between one front door and the next.` : ""} ${busyY} was the restless year: <strong>${busyN} different front doors</strong> in twelve months. The place you stayed longest was your home in ${longest.city} from ${monthYear(longest.core[0])} to ${monthYear(longest.core[1])}, about <strong>${duration(daysBetween(...longest.core))}</strong>.</p>`;
  const ol = $("#homes-list");
  let openLife = null;
  homes.forEach((h, i) => {
    const li = document.createElement("li");
    const until = h === current ? "now" : monthYear(h.core[1]);
    const b = html("button", { type: "button", "aria-pressed": "false", "aria-expanded": "false" }, `
      <span class="where">${h.name || h.city}<small>${[h.hood, h.name && h.city && !(h.hood || "").includes(h.city) ? h.city : ""].filter(Boolean).join(", ")}</small></span>
      <span class="span">${monthYear(h.from)} to ${until}</span>
      <span class="track"><i style="left:${xp(h.from)}%;width:${xp(h === current ? S.last : h.core[1]) - xp(h.from)}%"></i></span>
      <span class="note">${duration(daysBetween(h.from, h === current ? S.last : h.core[1]))}, ${fmt(h.days)} nights recorded</span>`);
    const life = html("div", { class: "life", hidden: "" }, lifeHTML(h));
    b.addEventListener("click", () => {
      const opening = openLife !== life;
      if (openLife) { openLife.hidden = true; openLife.previousElementSibling.setAttribute("aria-expanded", "false"); }
      openLife = opening ? life : null;
      life.hidden = !opening; b.setAttribute("aria-expanded", String(opening));
      press(b); clearFocus();
      const tops = (h.life?.top || []).map(([id]) => placeById[id]).filter(Boolean).slice(0, 5);
      const pinsList = [{ lon: h.lon, lat: h.lat, label: h.name || `Home ${i + 1}`, sub: `home ${i + 1}, ${monthYear(h.from)} to ${until}` },
        ...tops.map((p) => ({ lon: p.lon, lat: p.lat, label: placeName(p), sub: hrsShort(h.life.top.find(([id]) => id === p.id)[1]), small: true }))];
      setPins(pinsList);
      const near = pinsList.filter((p) => haversine(p.lat, p.lon, h.lat, h.lon) < 40);
      if (near.length > 1) fit(bboxOf(near.map((p) => [p.lon, p.lat])), { maxZoom: 15 });
      else flyTo(h.lon, h.lat, 14.5);
    });
    li.append(b, life); ol.append(li);
  });
}

function lifeHTML(h) {
  const L = h.life;
  if (!L) return "";
  const km = (ms) => ms.reduce((a, m) => a + (L.km[m] || 0), 0);
  const abroad = L.countries.filter(([cc]) => cc !== h.cc).map(([cc, n]) => `${data.countries.find((c) => c.cc === cc)?.name ?? cc} (${n} ${n === 1 ? "day" : "days"})`);
  const tops = L.top.map(([id, hh]) => [placeById[id], hh]).filter(([p]) => p);
  const maxH = Math.max(1, ...tops.map(([, hh]) => hh));
  const stats = [
    [fmt(L.days), "days on record"],
    [fmt(L.new_cities), "new towns and cities"],
    [fmt(L.trips), L.trips === 1 ? "trip away" : "trips away"],
    [`${fmt(km(["CYCLING"]))} km`, "cycled"],
    [`${fmt(km(["WALKING", "RUNNING"]))} km`, "on foot"],
    [`${fmt(km(["FLYING"]))} km`, "flown"],
  ];
  return `
    <dl class="life-stats">${stats.map(([v, l]) => `<div><dt>${l}</dt><dd>${v}</dd></div>`).join("")}</dl>
    ${abroad.length ? `<p class="life-abroad">Escaped to ${list(abroad)}.</p>` : `<p class="life-abroad">No trips abroad from here.</p>`}
    ${tops.length ? `<p class="life-h">Where the time went, outside these four walls</p>
    <ol class="mini">${tops.map(([p, hh]) => `<li><span class="mn">${placeName(p)}<small>${placeKind(p)}, ${p.city}</small></span><span class="mb"><i style="width:${(hh / maxH) * 100}%"></i></span><span class="mv">${hrsShort(hh)}</span></li>`).join("")}</ol>` : ""}`;
}

/* ------------------------------------------------------------ movement */
{
  const groups = [
    ["Flying", ["FLYING"], true],
    ["Train, metro and tram", ["IN_TRAIN", "IN_SUBWAY", "IN_TRAM"]],
    ["Car, bus and bike-taxi", ["IN_PASSENGER_VEHICLE", "IN_VEHICLE", "IN_BUS", "MOTORCYCLING"]],
    ["Cycling", ["CYCLING"]],
    ["On foot", ["WALKING", "RUNNING"]],
    ["Ferries and slopes", ["IN_FERRY", "SKIING"]],
  ];
  const yrs = Object.keys(data.dist);
  const allYears = [];
  for (let y = +yrs[0]; y <= +yrs.at(-1); y++) allYears.push(String(y));
  const sumG = (y, modes) => modes.reduce((a, m) => a + (data.dist[y]?.[m] || 0), 0);
  const air = S.modes_total.FLYING || 0;
  const bike = S.modes_total.CYCLING || 0;
  const walk = (S.modes_total.WALKING || 0) + (S.modes_total.RUNNING || 0);
  const train = (S.modes_total.IN_TRAIN || 0);
  const topYear = allYears.reduce((a, y) => (Object.values(data.dist[y] || {}).reduce((p, q) => p + q, 0) > Object.values(data.dist[a] || {}).reduce((p, q) => p + q, 0) ? y : a));
  const topYearKm = Object.values(data.dist[topYear]).reduce((p, q) => p + q, 0);
  const persona = S.persona?.travelModeAffinities?.[0]?.mode;
  const personaName = { WALKING: "a walker", CYCLING: "a cyclist", IN_TRAIN: "a train person", IN_PASSENGER_VEHICLE: "a driver" }[persona];
  const bikeYears = allYears.filter((y) => (data.dist[y]?.CYCLING || 0) > 0);
  $("#move-prose").innerHTML = `
    <p>All of it adds up to <strong>${fmt(kmTotal)} km</strong>: ${(kmTotal / EARTH).toFixed(1)} times around the equator, or ${pct(kmTotal / MOON)} of the way to the Moon. <strong>${pct(air / kmTotal)}</strong> of that was in the air, so the blue arcs on the map carry most of the distance while the amber light holds most of the life.</p>
    <p>On the ground, trains took you <strong>${fmt(train)} km</strong>. You cycled <strong>${fmt(bike)} km</strong>${bikeYears.length ? `, almost all of it after ${bikeYears.find((y) => data.dist[y].CYCLING > 100) || bikeYears[0]}${homes.at(-1).cc === "NL" ? ", which is very Dutch of you" : ""}` : ""}, and walked or ran another <strong>${fmt(walk)} km</strong>. ${topYear} was the year of motion, at ${fmt(topYearKm)} km.${personaName ? ` Even so, Google's own profile of you says you're ${personaName} first.` : ""}</p>
    <p class="caption">Each panel has its own scale, so read the shapes, not the heights between panels.</p>`;
  const wrap = $("#move-chart");
  for (const [name, modes, isAir] of groups) {
    const vals = allYears.map((y) => sumG(y, modes));
    const total = vals.reduce((a, b) => a + b, 0);
    if (total < 1) continue;
    const div = html("div", { class: "multiple" }, `<h4>${name}<span>${fmt(total)} km</span></h4>`);
    const W = 220, H = 74, pb = 14;
    const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `${name} distance per year` });
    const max = Math.max(...vals);
    const bw = W / allYears.length;
    svg("line", { x1: 0, x2: W, y1: H - pb, y2: H - pb, stroke: C.line }, s);
    allYears.forEach((y, i) => {
      const h = max ? ((H - pb - 6) * vals[i]) / max : 0;
      const g = svg("g", { class: "hoverable" }, s);
      if (vals[i] > 0) svg("rect", { class: isAir ? "bar air" : "bar", x: i * bw + 1, width: bw - 2, y: H - pb - Math.max(h, 1.5), height: Math.max(h, 1.5), rx: 1.5 }, g);
      const hit = svg("rect", { class: "hit", x: i * bw, width: bw, y: 0, height: H }, g);
      hover(hit, `<b>${y}</b><br>${fmt(vals[i])} km <span>${name.toLowerCase()}</span>`);
    });
    for (const i of [0, allYears.length - 1]) {
      const t = svg("text", { x: i * bw + (i ? bw : 0), y: H - 2, class: "lbl", "text-anchor": i ? "end" : "start" }, s);
      t.textContent = allYears[i];
    }
    div.append(s); wrap.append(div);
  }
}

/* ------------------------------------------------------------ rhythm */
{
  const allMonths = Object.entries(data.months)
    .map(([m, v]) => { const t = (v.home || 0) + (v.work || 0) + (v.out || 0) + (v.move || 0); return { m, t, share: (v.home || 0) / t, work: (v.work || 0) / t }; });
  let months = allMonths.filter((x) => x.t > 300 && x.m >= "2017");
  if (!months.length) months = allMonths.filter((x) => x.t > 0); // sparse timelines: better a noisy line than none
  const peak = months.reduce((a, b) => (b.share > a.share ? b : a));
  const avg = (arr) => arr.reduce((a, b) => a + b.share, 0) / arr.length;
  const pre = months.filter((x) => x.m >= "2017" && x.m < "2020-03");
  const lock = months.filter((x) => x.m >= "2020-03" && x.m < "2021-07");
  const recent = months.filter((x) => x.m >= String(+S.last.slice(0, 4) - 1));
  const wk = data.week.map((h) => { const t = (h.home || 0) + (h.work || 0) + (h.out || 0) + (h.move || 0); return t ? 1 - (h.home || 0) / t : 0; });
  const peakHour = wk.indexOf(Math.max(...wk));
  const wkday = wk.slice(0, 120).reduce((a, b) => a + b, 0) / 120, wkend = wk.slice(120).reduce((a, b) => a + b, 0) / 48;
  $("#rhythm-prose").innerHTML = `
    <p>Of all the hours Google could account for, the share spent at home tells its own story. ${pre.length && lock.length ? `Before 2020 it hovered around <strong>${pct(avg(pre))}</strong>. From March 2020 to mid-2021 it climbed to <strong>${pct(avg(lock))}</strong>, peaking` : "It peaked"} in <strong>${monthYear(peak.m + "-01")}</strong> at ${pct(peak.share)}.${recent.length ? ` Over the last year or so it sits at ${pct(avg(recent))}.` : ""}</p>
    <p>Your most out-of-the-house hour of the week is <strong>${WEEKDAYS[Math.floor(peakHour / 24)]} around ${String(peakHour % 24).padStart(2, "0")}:00</strong>. ${wkend > wkday ? "Weekends pull you out more than weekdays do." : "Weekdays get you out more than weekends do."}</p>`;

  // home share line
  const W = 470, H = 160, pad = { l: 34, r: 6, t: 12, b: 22 };
  const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
  const t0 = D(months[0].m + "-01"), t1 = D(months.at(-1).m + "-01");
  const x = (m) => pad.l + ((D(m + "-01") - t0) / (t1 - t0)) * (W - pad.l - pad.r);
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v);
  const g = svg("g", { class: "grid" }, s);
  for (const v of [0, 0.25, 0.5, 0.75, 1]) {
    svg("line", { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), opacity: v ? 0.5 : 1 }, g);
    const t = svg("text", { x: pad.l - 6, y: y(v) + 4, "text-anchor": "end", class: "lbl" }, s); t.textContent = pct(v);
  }
  for (let yr = +months[0].m.slice(0, 4) + 1; yr <= +months.at(-1).m.slice(0, 4); yr += 2) {
    const t = svg("text", { x: x(`${yr}-01`), y: H - 6, class: "lbl", "text-anchor": "middle" }, s); t.textContent = yr;
  }
  // break the line across gaps longer than 3 months
  let dStr = "", prev = null;
  for (const p of months) {
    const jump = !prev || (D(p.m + "-01") - D(prev.m + "-01")) / 864e5 > 95;
    dStr += `${jump ? "M" : "L"}${x(p.m).toFixed(1)},${y(p.share).toFixed(1)}`;
    prev = p;
  }
  // lockdown band
  if (lock.length) svg("rect", { x: x("2020-03"), width: x("2021-06") - x("2020-03"), y: pad.t, height: H - pad.t - pad.b, fill: C.sodium, opacity: 0.06 }, s);
  if (lock.length) { const t = svg("text", { x: x("2020-03") + 4, y: H - pad.b - 6, class: "annot" }, s); t.textContent = "lockdowns"; }
  svg("path", { d: dStr, fill: "none", stroke: C.sodiumMark, "stroke-width": 2, "stroke-linejoin": "round" }, s);
  const cross = svg("line", { y1: pad.t, y2: H - pad.b, stroke: C.dust, "stroke-width": 1, opacity: 0 }, s);
  const dot = svg("circle", { r: 4, fill: C.sodium, stroke: C.ink, "stroke-width": 2, opacity: 0 }, s);
  const hit = svg("rect", { class: "hit", x: pad.l, y: 0, width: W - pad.l - pad.r, height: H }, s);
  hit.addEventListener("pointermove", (e) => {
    const r = s.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const p = months.reduce((a, b) => (Math.abs(x(b.m) - px) < Math.abs(x(a.m) - px) ? b : a));
    cross.setAttribute("x1", x(p.m)); cross.setAttribute("x2", x(p.m)); cross.setAttribute("opacity", 0.6);
    dot.setAttribute("cx", x(p.m)); dot.setAttribute("cy", y(p.share)); dot.setAttribute("opacity", 1);
    showTip(e, `<b>${monthYear(p.m + "-01")}</b><br>${pct(p.share)} at home<br><span>${pct(p.work)} at work</span>`);
  });
  hit.addEventListener("pointerleave", () => { hideTip(); cross.setAttribute("opacity", 0); dot.setAttribute("opacity", 0); });
  $("#home-share").append(s);
  $("#home-share").append(html("p", { class: "caption" }, "Share of recorded hours spent at home, per month."));

  // week grid
  const GW = 470, cell = (GW - 40) / 24, GH = cell * 7 + 18;
  const gs = svg("svg", { viewBox: `0 0 ${GW} ${GH}`, role: "img" });
  const maxA = Math.max(...wk);
  const ramp = (v) => { // ink -> sodium, one hue
    const t = Math.pow(v / maxA, 0.9);
    const a = [26, 36, 70], b = [242, 169, 71];
    return `rgb(${a.map((c, i) => Math.round(c + (b[i] - c) * t)).join(",")})`;
  };
  WEEKDAYS.forEach((d, r) => {
    const t = svg("text", { x: 0, y: r * cell + cell * 0.7, class: "lbl" }, gs); t.textContent = d.slice(0, 3);
    for (let h = 0; h < 24; h++) {
      const v = wk[r * 24 + h];
      const rc = svg("rect", { x: 40 + h * cell + 1, y: r * cell + 1, width: cell - 2, height: cell - 2, rx: 2, fill: ramp(v) }, gs);
      hover(rc, `<b>${d} ${String(h).padStart(2, "0")}:00</b><br>${pct(v)} away from home`);
    }
  });
  for (const h of [0, 6, 12, 18]) { const t = svg("text", { x: 40 + h * cell + 1, y: GH - 3, class: "lbl" }, gs); t.textContent = `${String(h).padStart(2, "0")}:00`; }
  $("#week-grid").append(gs);
}

/* ------------------------------------------------------------ places */
const placeTotals = {};
{
  const named = haunts.filter((p) => p.osm);
  if (!named.length) $("[data-stop=places]").remove();
  else {
    const byKind = {};
    for (const p of named) byKind[placeKind(p)] = (byKind[placeKind(p)] || 0) + p.hours;
    const kinds = Object.entries(byKind).sort((a, b) => b[1] - a[1]);
    const chains = {};
    for (const p of named) { const nm = osmOf(p).name; if (nm) { const c = (chains[nm] ??= { n: 0, hours: 0, branches: 0 }); c.n += p.n; c.hours += p.hours; c.branches++; } }
    const chain = Object.entries(chains).filter(([, c]) => c.branches > 1).sort((a, b) => b[1].n - a[1].n)[0];
    const top = named[0];
    const station = named.filter((p) => placeKind(p) === "Stations and airports").sort((a, b) => b.n - a.n)[0];
    const friends = byKind["Other people's homes, probably"] || 0;
    const loyal = named.filter((p) => p.n >= 10).sort((a, b) => daysBetween(b.first, b.last) - daysBetween(a.first, a.last))[0];
    $("#places-prose").innerHTML = `
      <p>Outside home, the place that has had the most of your time is <strong>${placeName(top)}</strong>: ${hrs(top.hours)} over ${fmt(top.n)} visits, from ${monthYear(top.first)} to ${monthYear(top.last)}.</p>
      <p>${chain ? `Your most visited name is <strong>${chain[0]}</strong>, with ${fmt(chain[1].n)} visits spread across ${chain[1].branches} different branches. ` : ""}${station ? `Your most-used station is <strong>${placeName(station)}</strong> (${fmt(station.n)} visits). ` : ""}${friends ? `And you've spent around <strong>${hrs(friends)}</strong> at addresses that look like someone else's home, so probably friends' sofas.` : ""}</p>
      ${loyal ? `<p>The longest-running habit is <strong>${placeName(loyal)}</strong>, which you were still going back to ${duration(daysBetween(loyal.first, loyal.last))} after your first visit.</p>` : ""}`;

    // hours by kind
    const W = 470, row = 24, H = kinds.length * row;
    const sv = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Hours by kind of place" });
    const maxK = kinds[0][1];
    kinds.forEach(([k, h], i) => {
      const g = svg("g", { class: "hoverable" }, sv);
      const t = svg("text", { x: 0, y: i * row + 15, class: "lbl kindlbl" }, g); t.textContent = k;
      const bw = Math.max(2, ((W - 250) * h) / maxK);
      svg("rect", { class: "bar", x: 190, y: i * row + 6, width: bw, height: 11, rx: 2 }, g);
      const v = svg("text", { x: 190 + bw + 6, y: i * row + 15, class: "lbl" }, g); v.textContent = hrsShort(h);
      const hit = svg("rect", { class: "hit", x: 0, y: i * row, width: W, height: row }, g);
      const ex = named.filter((p) => placeKind(p) === k).slice(0, 3).map(placeName);
      hover(hit, `<b>${k}</b><br>${hrs(h)}<br><span>${ex.join(", ")}</span>`);
    });
    $("#kind-chart").append(sv);

    // the top list
    const ul = $("#place-list");
    for (const p of named.slice(0, 15)) {
      const li = document.createElement("li");
      const b = html("button", { type: "button", "aria-pressed": "false" }, `
        <span class="pn">${placeName(p)}</span><span class="ph">${hrsShort(p.hours)}</span>
        <span class="pm">${placeKind(p)}, ${p.city}. ${fmt(p.n)} visits${habit(p) ? `, ${habit(p)}` : ""}.</span>`);
      b.addEventListener("click", () => { press(b); clearFocus(); flyTo(p.lon, p.lat, 15.5); setPins([{ lon: p.lon, lat: p.lat, label: placeName(p), sub: `${monthYear(p.first)} to ${monthYear(p.last)}` }]); });
      li.append(b); ul.append(li);
    }
  }
}

/* ------------------------------------------------------------ year by year */
let showYear = () => {};
{
  const ys = Object.keys(data.years || {});
  const bar = $("#year-tabs");
  const card = $("#year-card");
  const heatBox = (y) => {
    const a = data.heat[y] || [];
    const lo = [], la = [];
    for (let i = 0; i < a.length; i += 3) { lo.push(a[i]); la.push(a[i + 1]); }
    lo.sort((x, z) => x - z); la.sort((x, z) => x - z);
    const q = (arr, f) => arr[Math.min(arr.length - 1, Math.floor(arr.length * f))];
    return [q(lo, 0.01), q(la, 0.01), q(lo, 0.99), q(la, 0.99)];
  };
  showYear = (y) => {
    [...bar.children].forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.y === y)));
    const Y = data.years[y];
    const km = Object.values(Y.km).reduce((a, b) => a + b, 0);
    const modes = Object.entries(Y.km).slice(0, 3).map(([m, k]) => `${fmt(k)} km ${MODE_NAMES[m] || ""}`);
    const homeCC = homeOn(`${y}-07-01`).cc;
    const abroad = Y.countries.filter(([cc]) => cc !== homeCC);
    const yHomes = homes.filter((h) => h.from.slice(0, 4) <= y && (h === homes.at(-1) ? "9999" : h.core[1].slice(0, 4)) >= y);
    const tops = Y.top.map(([id, hh]) => [placeById[id], hh]).filter(([p]) => p).slice(0, 5);
    const maxH = Math.max(1, ...tops.map(([, hh]) => hh));
    const cname = (cc) => data.countries.find((c) => c.cc === cc)?.name ?? cc;
    card.innerHTML = `
      <p class="yc-lede">${yHomes.length ? `Home was ${list([...new Set(yHomes.map((h) => h.name || h.city))])}. ` : ""}${abroad.length ? `You were abroad on ${fmt(abroad.reduce((a, [, n]) => a + n, 0))} days: ${list(abroad.map(([cc, n]) => `${cname(cc)} (${n})`))}.` : "You didn't leave the country."}</p>
      <dl class="life-stats">
        <div><dt>days on record</dt><dd>${fmt(Y.days)}</dd></div>
        <div><dt>towns and cities</dt><dd>${fmt(Y.cities)}</dd></div>
        <div><dt>seen for the first time</dt><dd>${fmt(Y.new_cities)}</dd></div>
        <div><dt>kilometres moved</dt><dd>${fmt(km)}</dd></div>
        <div><dt>trips away</dt><dd>${fmt(Y.trips)}</dd></div>
        <div><dt>countries</dt><dd>${Y.countries.length}</dd></div>
      </dl>
      ${modes.length ? `<p class="life-abroad">Mostly ${list(modes)}.</p>` : ""}
      ${tops.length ? `<p class="life-h">The places of ${y}</p><ol class="mini">${tops.map(([p, hh]) => `<li><span class="mn">${placeName(p)}<small>${placeKind(p)}, ${p.city}</small></span><span class="mb"><i style="width:${(hh / maxH) * 100}%"></i></span><span class="mv">${hrsShort(hh)}</span></li>`).join("")}</ol>` : ""}`;
    clearFocus(); setPins([]);
    onlyYear(+y);
    fit(heatBox(y), { maxZoom: 11 });
  };
  for (const y of ys) {
    const b = html("button", { type: "button", "data-y": y, "aria-pressed": "false" }, y);
    b.addEventListener("click", () => showYear(y));
    bar.append(b);
  }
}

/* ------------------------------------------------------------ countries */
const countryBoxes = {};
{
  const cs = data.countries;
  for (const c of cs) countryBoxes[c.cc] = bboxOf(cities.filter((x) => x.cc === c.cc).map((x) => [x.lon, x.lat]));
  const stayed = cs.filter((c) => c.stayed);
  const homeCCs = new Set(homes.map((h) => h.cc));
  const abroad = cs.filter((c) => !homeCCs.has(c.cc));
  const newPerYear = {};
  cs.forEach((c) => (newPerYear[c.first.slice(0, 4)] = (newPerYear[c.first.slice(0, 4)] || []).concat(c.name)));
  const [bestY, bestList] = Object.entries(newPerYear).reduce((a, b) => (b[1].length > a[1].length ? b : a));
  const longestAbroad = abroad.reduce((a, b) => (b.days > a.days ? b : a), abroad[0]);
  const newest = cs.at(-1);
  const passed = cs.filter((c) => !c.stayed);
  $("#world-prose").innerHTML = `
    <p><strong>${cs.length} countries</strong>, listed in the order you first set foot (or wheel) in them. You properly stopped in ${stayed.length}${passed.length ? `. ${list(passed.map((c) => c.name))} only show up in passing, from a train window, a transfer, or high above` : ""}.</p>
    <p><strong>${bestY}</strong> was the big year for new stamps: ${list(bestList)}.${longestAbroad ? ` Outside the countries you've lived in, you spent the most days in <strong>${longestAbroad.name}</strong> (${longestAbroad.days}).` : ""} The newest addition is <strong>${newest.name}</strong>, first seen on ${dayLong(newest.first)}.</p>`;
  const maxD = Math.max(...cs.map((c) => c.days));
  const ol = $("#country-list");
  for (const c of cs) {
    const li = document.createElement("li");
    const b = html("button", { type: "button", "aria-pressed": "false" }, `
      <span class="cname">${c.name}${c.stayed ? "" : "<small>passed through</small>"}</span>
      <span class="cdays">${fmt(c.days)} ${c.days === 1 ? "day" : "days"}</span>
      <span class="cbar"><i style="width:${Math.max(1.5, Math.sqrt(c.days / maxD) * 100)}%"></i></span>
      <span class="cmeta">First on ${dayLong(c.first)}. ${list(c.top.slice(0, 4))}${c.cities > 4 ? ` and ${c.cities - 4} more` : ""}.</span>`);
    b.addEventListener("click", () => { press(b); clearFocus(); setPins([]); fit(countryBoxes[c.cc], { maxZoom: 9 }); });
    li.append(b); ol.append(li);
  }
}

/* ------------------------------------------------------------ trips */
{
  const homeCCs = new Set(homes.map((h) => h.cc));
  const trips = data.trips.filter((t) => t.km >= 250 || t.ccs.some((c) => !homeCCs.has(c))).reverse();
  if (!trips.length) $("[data-stop=trips]").remove();
  else {
    const longest = trips.reduce((a, b) => (daysBetween(b.start, b.end) > daysBetween(a.start, a.end) ? b : a));
    const farthest = trips.reduce((a, b) => (b.km > a.km ? b : a));
    const perYear = {};
    trips.forEach((t) => (perYear[t.start.slice(0, 4)] = (perYear[t.start.slice(0, 4)] || 0) + 1));
    const [ty, tn] = Object.entries(perYear).reduce((a, b) => (b[1] > a[1] ? b : a));
    $("#trips-prose").innerHTML = `
      <p>Google bundled your time away into <strong>${trips.length} trips</strong> worth remembering. The farthest reached <strong>${fmt(farthest.km)} km</strong> from home (${list(farthest.cities.slice(0, 3))}, ${monthYear(farthest.start)}), and the longest lasted <strong>${daysBetween(longest.start, longest.end) + 1} days</strong>. ${ty} was the most packed, with ${tn} of them.</p>
      <p class="caption">Pick a trip to trace it on the map.</p>`;
    const ul = $("#trip-list");
    for (const t of trips) {
      const n = daysBetween(t.start, t.end) + 1;
      const s = D(t.start), e = D(t.end);
      const sameMonth = s.getUTCMonth() === e.getUTCMonth();
      const when = n === 1 ? `${s.getUTCDate()} ${MONTHS[s.getUTCMonth()]}` : sameMonth ? `${s.getUTCDate()}–${e.getUTCDate()} ${MONTHS[s.getUTCMonth()]}` : `${s.getUTCDate()} ${MONTHS[s.getUTCMonth()]}–${e.getUTCDate()} ${MONTHS[e.getUTCMonth()]}`;
      const li = document.createElement("li");
      const b = html("button", { type: "button", "aria-pressed": "false" }, `
        <span class="when"><b>${s.getUTCFullYear()}</b>${when}</span>
        <span class="what">${list(t.cities.slice(0, 3))}<span>${n === 1 ? "A day" : `${n} days`}, up to ${fmt(t.km)} km from home</span></span>`);
      b.addEventListener("click", () => {
        press(b); setPins([]);
        const segs = [];
        for (let i = 1; i < t.path.length; i++) {
          const a = t.path[i - 1], c = t.path[i];
          const far = Math.hypot(a[0] - c[0], a[1] - c[1]) > 3;
          segs.push({ type: "Feature", properties: { col: far ? C.contrail : C.sodium }, geometry: { type: "LineString", coordinates: far ? greatCircle(a, c, 24) : [a, c] } });
        }
        map.getSource("focus").setData(fc(segs));
        map.getSource("focus-pts").setData(fc([]));
        if (t.bbox) fit(t.bbox, { maxZoom: 11 });
      });
      li.append(b); ul.append(li);
    }
  }
}

/* ------------------------------------------------------------ edges */
{
  const sp = data.sup;
  const items = [];
  const place = (p) => `${p.city}, ${data.countries.find((c) => c.cc === p.cc)?.name ?? p.cc}`;
  for (const k of ["north", "south", "east", "west"]) {
    const p = sp[k];
    items.push({ what: p.label, place: place(p), sub: `${Math.abs(p.lat).toFixed(2)}°${p.lat >= 0 ? "N" : "S"}, ${Math.abs(p.lon).toFixed(2)}°${p.lon >= 0 ? "E" : "W"} on ${dayLong(p.day)}`, go: () => { flyTo(p.lon, p.lat, 9); setPins([{ lon: p.lon, lat: p.lat, label: p.label }]); } });
  }
  if (sp.farthest) items.push({ wide: true, what: "The farthest you've been from any of your homes", place: `${place(sp.farthest)}, ${fmt(sp.farthest.km)} km away`, sub: dayLong(sp.farthest.day), go: () => openDay(sp.farthest.day) });
  if (sp.longest_day) items.push({ what: "Most ground covered in one day", place: `${fmt(sp.longest_day.km)} km`, sub: `${dayLong(sp.longest_day.day)}, ${sp.longest_day.cities.slice(0, 2).join(" to ")}`, go: () => openDay(sp.longest_day.day) });
  if (sp.most_cities_day) items.push({ what: "Most places in one day", place: `${sp.most_cities_day.cities.length} towns and cities`, sub: `${dayLong(sp.most_cities_day.day)}, ${sp.most_cities_day.cities.slice(0, 3).join(", ")}`, go: () => openDay(sp.most_cities_day.day) });
  if (sp.longest_ride) items.push({ what: "Longest bike ride", place: `${sp.longest_ride.km} km`, sub: `${Math.floor(sp.longest_ride.mins / 60)} h ${sp.longest_ride.mins % 60} min on ${dayLong(sp.longest_ride.day)}`, go: () => openDay(sp.longest_ride.day) });
  if (sp.longest_walk) items.push({ what: "Longest walk", place: `${sp.longest_walk.km} km`, sub: `${Math.floor(sp.longest_walk.mins / 60)} h ${sp.longest_walk.mins % 60} min on ${dayLong(sp.longest_walk.day)}`, go: () => openDay(sp.longest_walk.day) });
  if (sp.longest_away) items.push({ wide: true, what: "Longest run of days away from every home city", place: `${sp.longest_away.days} days`, sub: `${dayLong(sp.longest_away.start)} to ${dayLong(sp.longest_away.end)}`, go: () => openDay(sp.longest_away.start) });
  const span = [sp.west.lon, sp.east.lon], lat = [sp.south.lat, sp.north.lat];
  $("#edges-prose").innerHTML = `<p>Draw a box around everywhere you've been and it runs from <strong>${sp.west.city}</strong> in the west to <strong>${sp.east.city}</strong> in the east, ${fmt((span[1] - span[0]) * 111 * Math.cos(((lat[0] + lat[1]) / 2) * Math.PI / 180))} km or so of longitude, and from <strong>${sp.south.city}</strong> up to <strong>${sp.north.city}</strong>. Tap any of these to go there.</p>`;
  const box = $("#edges");
  for (const it of items) {
    const b = html("button", { type: "button", class: it.wide ? "wide" : "" }, `<span class="e-what">${it.what}</span><span class="e-place">${it.place}</span><span class="e-sub">${it.sub}</span>`);
    b.addEventListener("click", it.go);
    box.append(b);
  }
}

/* ------------------------------------------------------------ calendar wall */
const CLS = {
  none: { fill: "#1a2446", label: "No record" },
  home: { fill: "#4d3f37", label: "Home town" },
  away: { fill: "#a9733a", label: "Elsewhere in the country" },
  abroad: { fill: "#ffc970", label: "Abroad" },
  fly: { fill: C.contrail, label: "Flying" },
};
const dayRects = {};
let selectedRect = null;
{
  const counts = { home: 0, away: 0, abroad: 0, fly: 0 };
  for (const k of dayKeys) counts[classify(k)]++;
  $("#wall-prose").innerHTML = `<p>${fmt(dayKeys.length)} days, one square each. <strong>${fmt(counts.away)}</strong> took you out of your home town, <strong>${fmt(counts.abroad)}</strong> were spent abroad, and on <strong>${fmt(counts.fly)}</strong> you were in the air. Pick any day to see where it went, hour by hour.</p>`;
  $("#wall-legend").innerHTML = Object.values(CLS).map((c) => `<span><i style="background:${c.fill}"></i>${c.label}</span>`).join("");
  const cal = $("#calendar");
  const y0 = +S.first.slice(0, 4), y1 = +S.last.slice(0, 4);
  const cell = 7, gap = 1.5, step = cell + gap;
  for (let y = y0; y <= y1; y++) {
    const row = html("div", { class: "cal-year" }, `<span>${y}</span>`);
    const s = svg("svg", { viewBox: `0 0 ${53 * step} ${7 * step}`, role: "row", "aria-label": String(y) });
    const jan1 = D(`${y}-01-01`);
    const off = (jan1.getUTCDay() + 6) % 7;
    for (let d = new Date(jan1); d.getUTCFullYear() === y; d.setUTCDate(d.getUTCDate() + 1)) {
      const k = key(d);
      if (k < S.first || k > S.last) continue;
      const idx = Math.round((d - jan1) / 864e5) + off;
      const c = classify(k);
      const r = svg("rect", { x: Math.floor(idx / 7) * step, y: (idx % 7) * step, width: cell, height: cell, rx: 1.5, fill: CLS[c].fill }, s);
      if (c !== "none") {
        dayRects[k] = r;
        r.setAttribute("tabindex", "-1");
        hover(r, () => {
          const dd = data.days[k];
          const names = dd.c.slice(0, 3).map((i) => cities[i].name);
          return `<b>${dayLong(k)}</b><br>${names.join(", ") || "<span>Somewhere unnamed</span>"}${dd.km > 1 ? `<br><span>${fmt(dd.km)} km moved</span>` : ""}`;
        });
        r.addEventListener("click", () => openDay(k));
      }
    }
    row.append(s); cal.append(row);
  }
  $("#random-day").addEventListener("click", () => {
    const pool = dayKeys.filter((k) => ["away", "abroad", "fly"].includes(classify(k)));
    openDay(pool[Math.floor(Math.random() * pool.length)]);
  });

  // on this day
  const now = new Date(), md = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  $("#otd-title").textContent = `On ${now.getDate()} ${MONTHS[now.getMonth()]}, over the years`;
  const ul = $("#otd");
  for (let y = y1; y >= y0; y--) {
    const k = `${y}-${md}`;
    const dd = data.days[k];
    const li = document.createElement("li");
    if (dd && dd.c.length) {
      const b = html("button", { type: "button" }, `<span class="y">${y}</span><span class="p">${list(dd.c.slice(0, 3).map((i) => cities[i].name))}</span>`);
      b.addEventListener("click", () => openDay(k));
      li.append(b);
    } else {
      li.innerHTML = `<button type="button" disabled><span class="y">${y}</span><span class="p none">No record</span></button>`;
    }
    ul.append(li);
  }
}

/* ------------------------------------------------------------ day view */
const TIME_STOPS = [[0, [122, 62, 18]], [6, [207, 127, 34]], [10, [242, 169, 71]], [14, [255, 227, 176]], [18, [124, 203, 234]], [24, [46, 95, 168]]];
function timeColor(mins) {
  const h = mins / 60;
  for (let i = 1; i < TIME_STOPS.length; i++) {
    const [h1, c1] = TIME_STOPS[i], [h0, c0] = TIME_STOPS[i - 1];
    if (h <= h1) { const t = (h - h0) / (h1 - h0); return `rgb(${c0.map((c, j) => Math.round(c + (c1[j] - c) * t)).join(",")})`; }
  }
  return "rgb(46,95,168)";
}
const MODE_NAMES = { WALKING: "walking", CYCLING: "cycling", IN_PASSENGER_VEHICLE: "by car", IN_TRAIN: "by train", IN_BUS: "by bus", FLYING: "flying", IN_SUBWAY: "by metro", IN_TRAM: "by tram", RUNNING: "running", IN_FERRY: "by ferry", MOTORCYCLING: "by motorbike", IN_VEHICLE: "by road", SKIING: "skiing" };
let currentDay = null;
async function openDay(k) {
  if (!k) return;
  currentDay = k;
  const panel = $("#day-panel");
  panel.hidden = false;
  const d = D(k), dd = data.days[k];
  $("#day-weekday").textContent = WEEKDAYS[(d.getUTCDay() + 6) % 7];
  $("#day-date").textContent = dayLong(k);
  $("#day-places").textContent = dd?.c.length ? list(dd.c.slice(0, 5).map((i) => cities[i].name)) : "Somewhere without a name";
  const modes = Object.entries(dd?.m || {}).map(([m, km]) => `${fmt(km)} km ${MODE_NAMES[m] || ""}`);
  $("#day-stats").innerHTML = `
    <div><dt>moved</dt><dd>${fmt(dd?.km || 0)} km</dd></div>
    <div><dt>points</dt><dd>${fmt(dd?.n || 0)}</dd></div>
    <div><dt>cities</dt><dd>${dd?.c.length || 0}</dd></div>`;
  if (modes.length) $("#day-stats").insertAdjacentHTML("beforeend", `<div style="grid-column:1/4"><dt>mostly</dt><dd style="font-size:14px;font-weight:500">${modes.slice(0, 2).join(", ")}</dd></div>`);
  if (selectedRect) selectedRect.classList.remove("sel");
  selectedRect = dayRects[k]; selectedRect?.classList.add("sel");
  setPins([]); press(null);

  const t = (await tracks())[k] || [];
  if (currentDay !== k) return;
  dimLife(true);
  const segs = [], pts = [];
  for (let i = 1; i < t.length; i++) {
    const a = t[i - 1], b = t[i];
    const far = Math.hypot(a[0] - b[0], a[1] - b[1]) > 2;
    segs.push({ type: "Feature", properties: { col: timeColor(b[2]) }, geometry: { type: "LineString", coordinates: far ? greatCircle(a, b, 32) : [a.slice(0, 2), b.slice(0, 2)] } });
  }
  if (t.length) {
    pts.push({ type: "Feature", properties: { col: timeColor(t[0][2]) }, geometry: { type: "Point", coordinates: t[0].slice(0, 2) } });
    pts.push({ type: "Feature", properties: { col: timeColor(t.at(-1)[2]) }, geometry: { type: "Point", coordinates: t.at(-1).slice(0, 2) } });
  }
  map.getSource("focus").setData(fc(segs));
  map.getSource("focus-pts").setData(fc(pts));
  if (t.length) {
    const bb = bboxOf(t);
    if (bb[2] - bb[0] < 0.01 && bb[3] - bb[1] < 0.01) flyTo(t[0][0], t[0][1], 14);
    else fit(bb, { maxZoom: 14.5, duration: 1600 });
  }
}
function closeDay() {
  $("#day-panel").hidden = true; currentDay = null;
  clearFocus(); dimLife(false);
  if (selectedRect) selectedRect.classList.remove("sel");
}
function stepDay(dir) {
  if (!currentDay) return;
  const i = dayKeys.indexOf(currentDay) + dir;
  if (i >= 0 && i < dayKeys.length) openDay(dayKeys[i]);
}
$("#day-close").addEventListener("click", closeDay);
$("#day-prev").addEventListener("click", () => stepDay(-1));
$("#day-next").addEventListener("click", () => stepDay(1));
addEventListener("keydown", (e) => {
  if (!currentDay) return;
  if (e.key === "Escape") closeDay();
  if (e.key === "ArrowLeft") stepDay(-1);
  if (e.key === "ArrowRight") stepDay(1);
});

/* ------------------------------------------------------------ story stops */
const homeBox = bboxOf(homes.map((h) => [h.lon, h.lat]));
const current = homes.at(-1);
const stops = {
  hero: () => { setPins([]); clearFocus(); dimLife(false); setYear(null); fit(worldBox, { maxZoom: 4 }); yearDial.classList.remove("off"); },
  density: () => { setPins([]); clearFocus(); dimLife(false); fit(worldBox, { maxZoom: 4 }); yearDial.classList.add("off"); },
  homes: () => { clearFocus(); dimLife(false); setYear(null); yearDial.classList.add("off"); fit(homeBox, { maxZoom: 6 });
    const firstAbroad = homes.findIndex((h) => h.cc !== homes[0].cc);
    setPins([homes[0], homes[firstAbroad > 0 ? firstAbroad : homes.length - 1]].map((h) => ({ lon: h.lon, lat: h.lat, label: h.city, sub: `from ${monthYear(h.from)}` })));
  },
  move: () => { setPins([]); clearFocus(); dimLife(false); setYear(null); yearDial.classList.add("off"); arcsBright(true); fit(worldBox, { maxZoom: 4 }); },
  rhythm: () => { setPins([]); clearFocus(); dimLife(false); arcsBright(false); yearDial.classList.add("off"); flyTo(current.lon, current.lat, 11.5); },
  places: () => { yearDial.classList.add("off"); clearFocus(); dimLife(false); arcsBright(false);
    const near = haunts.filter((p) => p.osm && haversine(p.lat, p.lon, current.lat, current.lon) < 30).slice(0, 6);
    setPins(near.map((p) => ({ lon: p.lon, lat: p.lat, label: placeName(p), sub: hrsShort(p.hours), small: true })));
    if (near.length) fit(bboxOf([...near.map((p) => [p.lon, p.lat]), [current.lon, current.lat]]), { maxZoom: 14 }); },
  years: () => { yearDial.classList.add("off"); dimLife(false); arcsBright(false); const pressed = document.querySelector("#year-tabs [aria-pressed=true]"); showYear(pressed?.dataset.y || Object.keys(data.years).at(-1)); },
  world: () => { setPins([]); clearFocus(); dimLife(false); arcsBright(true); yearDial.classList.add("off"); fit(worldBox, { maxZoom: 4 }); },
  trips: () => { setPins([]); dimLife(false); arcsBright(false); yearDial.classList.add("off"); fit(worldBox, { maxZoom: 4 }); },
  edges: () => {
    clearFocus(); dimLife(false); yearDial.classList.add("off");
    const sp = data.sup;
    const ps = ["north", "south", "east", "west"].map((k) => ({ lon: sp[k].lon, lat: sp[k].lat, label: sp[k].label.replace("Furthest ", ""), sub: sp[k].city, flip: k === "south" || k === "west" }));
    setPins(ps); fit(bboxOf(ps.map((p) => [p.lon, p.lat])), { maxZoom: 5 });
  },
  wall: () => { setPins([]); yearDial.classList.add("off"); },
};
let activeStop = null;
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const name = e.target.dataset.stop;
    if (name === activeStop) continue;
    activeStop = name;
    press(null);
    if (name !== "wall" && currentDay) closeDay();
    if (name !== "years" && name !== "hero") setYear(null);
    try { stops[name]?.(); } catch (err) { console.error("stop", name, err); }
  }
}, { rootMargin: "-45% 0px -45% 0px" });
document.querySelectorAll(".stop").forEach((s) => io.observe(s));

// the opening: light the years up one by one
fit(worldBox, { maxZoom: 4, duration: 0 });
setTimeout(replay, 600);
tracks(); // warm the day tracks in the background
