// Decides where the story's data comes from: a file you drop in, your last visit, a local build, or the demo.
import { nameEverything, namingTargets } from "./names.js";

const $ = (s) => document.querySelector(s);
const DB = "long-exposure", STORE = "story";

function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idb(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => { const tx = d.transaction(STORE, mode); const q = fn(tx.objectStore(STORE)); tx.oncomplete = () => res(q?.result); tx.onerror = () => rej(tx.error); });
}
const saveStory = (v) => idb("readwrite", (s) => s.put(v, "me")).catch(() => {});
const loadStory = () => idb("readonly", (s) => s.get("me")).catch(() => null);
export const forgetStory = () => idb("readwrite", (s) => s.delete("me"));

// MapLibre is only needed once a story opens, so it stays off the landing page's critical path
const MAPLIBRE = new URL("../vendor/maplibre-gl-4.7.1/", import.meta.url);
let maplibreP = null;
function loadMaplibre() {
  const add = (tag, attrs, before) => new Promise((res, rej) => {
    const el = Object.assign(document.createElement(tag), attrs, { onload: res, onerror: () => rej(new Error(`Couldn't load ${attrs.src || attrs.href}`)) });
    before ? before.before(el) : document.head.append(el);
  });
  // the stylesheet goes before style.css so our overrides of the map controls still win
  return (maplibreP ??= Promise.all([
    add("link", { rel: "stylesheet", href: new URL("maplibre-gl.css", MAPLIBRE).href }, document.querySelector('link[href="style.css"]')),
    add("script", { src: new URL("maplibre-gl.js", MAPLIBRE).href }),
  ]).catch((e) => { maplibreP = null; throw e; }));
}

async function start(data, tracks, mode) {
  globalThis.__LE = { data, tracks: typeof tracks === "function" ? tracks : () => Promise.resolve(tracks), mode, maplibre: loadMaplibre };
  if (!$("#landing").hidden) document.body.classList.add("from-landing");
  $("#landing").classList.add("gone");
  document.body.classList.remove("on-landing");
  try { await import("../app.js"); } catch (e) {
    // a story that can't be drawn would otherwise leave a blank map
    console.error(e);
    $("#landing").hidden = false; $("#landing").classList.remove("gone"); document.body.classList.add("on-landing");
    return showError("Something in this timeline tripped up the story. Reload the page to try again.");
  }
  setTimeout(() => $("#landing").remove(), 900);
}

async function startDemo() {
  // fetch the story code alongside the data; app.js asks for MapLibre once the hero text is on screen
  document.head.append(Object.assign(document.createElement("link"), { rel: "modulepreload", href: new URL("../app.js", import.meta.url).href }));
  const data = await (await fetch("demo/data.json")).json();
  start(data, () => fetch("demo/tracks.json").then((r) => r.json()), "demo");
}

function show(step) {
  for (const el of document.querySelectorAll("[data-step]")) el.hidden = el.dataset.step !== step;
}

function showError(msg) {
  show("drop"); $("#drop-error").textContent = msg; $("#drop-error").hidden = false;
}

function processFile(file) {
  loadMaplibre().catch(() => {});
  show("working");
  $("#work-msg").textContent = "Opening the file";
  const w = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  w.onmessage = ({ data: m }) => {
    if (m.type === "progress") $("#work-msg").textContent = m.msg;
    if (m.type === "error") { w.terminate(); showError(m.msg); }
    if (m.type === "done") { w.terminate(); askNames(m.data, m.tracks); }
  };
  // fires when the worker can't start or dies, usually from running out of memory on a huge file
  w.onerror = () => { w.terminate(); showError("Your browser couldn't finish reading this file. If it's very large, try again in a desktop browser with fewer tabs open."); };
  w.postMessage(file);
}

function askNames(data, tracks) {
  const n = namingTargets(data);
  const total = n.homes.length + n.places.length;
  $("#names-count").textContent = total;
  $("#names-mins").textContent = Math.max(1, Math.round((total * 1.1) / 60));
  $("#names-summary").textContent = `${data.summary.days_with_data.toLocaleString("en-GB")} days, ${data.summary.cities} towns and cities, ${data.summary.countries} countries.`;
  show("names");
  const finish = async () => { await saveStory({ data, tracks, saved: Date.now() }); start(data, tracks, "mine"); };
  $("#names-skip").onclick = finish;
  $("#names-go").onclick = async () => {
    show("naming");
    const ac = new AbortController();
    $("#naming-stop").onclick = () => ac.abort();
    await nameEverything(data, (i, t) => {
      $("#naming-bar").style.width = `${(i / t) * 100}%`;
      $("#naming-msg").textContent = `${i} of ${t} places named`;
    }, ac.signal);
    finish();
  };
}

async function boot() {
  const q = new URLSearchParams(location.search);
  if (q.has("demo") || q.get("data") === "demo") return startDemo();

  // a local build from the Python pipeline (web/data/), for people running it on their own machine
  const local = await fetch("data/data.json").catch(() => null);
  if (local?.ok && !q.has("upload")) return start(await local.json(), () => fetch("data/tracks.json").then((r) => r.json()), "local");

  document.body.classList.add("on-landing");
  $("#landing").hidden = false;
  show("drop");
  const saved = await loadStory();
  if (saved) {
    $("#saved").hidden = false;
    $("#saved-when").textContent = new Date(saved.saved).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    $("#open-saved").onclick = () => start(saved.data, saved.tracks, "mine");
    $("#forget-saved").onclick = async () => { await forgetStory(); $("#saved").hidden = true; };
  }
  const input = $("#file");
  input.onchange = () => input.files[0] && processFile(input.files[0]);
  const zone = $("#dropzone");
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("over"));
  zone.addEventListener("drop", (e) => { e.preventDefault(); zone.classList.remove("over"); const f = e.dataTransfer.files[0]; if (f) processFile(f); });
  $("#try-demo").onclick = startDemo;
}

boot();
