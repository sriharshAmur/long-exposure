// Self-check for web/js/process.js: the Android and iPhone layouts of the same timeline give the same story,
// and files it cannot read fail with a readable message. Run `make demo` first, then `make check`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const repo = new URL("..", import.meta.url).pathname;
const { processTimeline } = await import(repo + "web/js/process.js");
const geo = JSON.parse(readFileSync(repo + "web/geo/cities.json", "utf8"));
const android = JSON.parse(readFileSync(process.argv[2] || repo + "examples/out/Timeline.json", "utf8"));
delete android.rawSignals; // iPhone exports have none

const geoS = (ll) => "geo:" + ll.replace(/°/g, "").replace(" ", "");
const words = (s) => s.toLowerCase().replace(/_/g, " ");
const iphone = android.semanticSegments.map((s) => {
  const o = { startTime: s.startTime, endTime: s.endTime };
  if (s.visit) { const tc = s.visit.topCandidate; o.visit = { hierarchyLevel: String(s.visit.hierarchyLevel), probability: "0.9", topCandidate: { placeID: tc.placeId, semanticType: words(tc.semanticType), probability: "0.9", placeLocation: geoS(tc.placeLocation.latLng) } }; }
  else if (s.activity) { const a = s.activity; o.activity = { start: geoS(a.start.latLng), end: geoS(a.end.latLng), distanceMeters: String(a.distanceMeters), topCandidate: { type: words(a.topCandidate.type), probability: "0.9" } }; }
  else if (s.timelinePath) { const t0 = Date.parse(s.startTime); o.timelinePath = s.timelinePath.map((p) => ({ point: geoS(p.point), durationMinutesOffsetFromStartTime: String((Date.parse(p.time) - t0) / 6e4) })); }
  else if (s.timelineMemory) { const tr = s.timelineMemory.trip; o.timelineMemory = { distanceFromOriginKms: String(tr.distanceFromOriginKms), destinations: tr.destinations.map((d) => ({ identifier: d.identifier.placeId })) }; }
  return o;
});

const a = processTimeline(android, geo).data, b = processTimeline(iphone, geo).data;
for (const k of ["summary", "homes", "countries", "trips", "years", "dist", "months", "week", "days"]) {
  const x = structuredClone(a[k]), y = structuredClone(b[k]);
  if (k === "summary") { delete x.persona; delete y.persona; }
  assert.deepEqual(y, x, `iPhone layout differs in ${k}`);
}
assert.ok(a.homes.length >= 1 && a.summary.observations > 1000);

const msg = (raw) => { try { processTimeline(raw, geo); } catch (e) { return e.message; } assert.fail("expected an error"); };
assert.match(msg({ locations: [{ latitudeE7: 1, longitudeE7: 2, timestamp: "2020-01-01T00:00:00Z" }] }), /old Google Takeout/);
assert.match(msg({ timelineObjects: [] }), /old Google Takeout/);
assert.match(msg({}), /no timeline segments/);
assert.match(msg([]), /no timeline segments/);
assert.match(msg({ semanticSegments: android.semanticSegments.slice(0, 20) }), /Couldn't find a home/);
console.log("ok:", a.summary.observations, "points,", a.homes.length, "homes,", a.trips.length, "trips; iPhone layout matches; bad files explained");
