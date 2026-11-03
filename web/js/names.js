// Optional: ask OpenStreetMap's free Nominatim service what is at your homes and most-visited places.
// One request per second, as its usage policy asks. Only these coordinates are sent, nothing else.
const NOISE_CACHE = "le-osm-cache";

export function namingTargets(data, max = 150) {
  const ids = new Set();
  for (const h of data.homes) for (const [id] of h.life?.top || []) ids.add(id);
  for (const y of Object.values(data.years || {})) for (const [id] of y.top || []) ids.add(id);
  const haunts = data.places.filter((p) => !/HOME/.test(p.sem));
  for (const p of haunts.slice(0, max)) ids.add(p.id);
  return { homes: data.homes, places: data.places.filter((p) => ids.has(p.id)) };
}

export async function nameEverything(data, onStep, signal) {
  const cache = JSON.parse(localStorage.getItem(NOISE_CACHE) || "{}");
  const { homes, places } = namingTargets(data);
  const jobs = [...homes.map((h) => ["home", h]), ...places.map((p) => ["place", p])];
  let done = 0;
  for (const [kind, it] of jobs) {
    if (signal?.aborted) break;
    const k = `${it.lat.toFixed(5)},${it.lon.toFixed(5)}`;
    let o = cache[k];
    if (!o) {
      try {
        const q = new URLSearchParams({ format: "jsonv2", lat: it.lat, lon: it.lon, zoom: 18, addressdetails: 1, "accept-language": "en" });
        const r = await (await fetch(`https://nominatim.openstreetmap.org/reverse?${q}`)).json();
        const a = r.address || {};
        o = { name: r.name || "", cat: r.category || "", type: r.type || "",
          road: a.road || a.pedestrian || a.footway || "", hood: a.neighbourhood || a.residential || a.quarter || a.suburb || "",
          suburb: a.suburb || a.city_district || "", city: a.city || a.town || a.village || "" };
        cache[k] = o;
        try { localStorage.setItem(NOISE_CACHE, JSON.stringify(cache)); } catch { /* storage full: fine */ }
      } catch { o = null; }
      await new Promise((r) => setTimeout(r, 1100));
    }
    if (o) {
      it.osm = o;
      if (kind === "home") { it.name = o.road || o.hood || it.city; it.hood = o.hood || o.suburb || ""; }
    }
    onStep?.(++done, jobs.length);
  }
  return data;
}
