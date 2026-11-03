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

async function start(data, tracks, mode) {
  globalThis.__LE = { data, tracks: typeof tracks === "function" ? tracks : () => Promise.resolve(tracks), mode };
  $("#landing").classList.add("gone");
  document.body.classList.remove("on-landing");
  await import("../app.js");
  setTimeout(() => $("#landing").remove(), 900);
}

async function startDemo() {
  const data = await (await fetch("demo/data.json")).json();
  start(data, () => fetch("demo/tracks.json").then((r) => r.json()), "demo");
}

function show(step) {
  for (const el of document.querySelectorAll("[data-step]")) el.hidden = el.dataset.step !== step;
}

function processFile(file) {
  show("working");
  $("#work-msg").textContent = "Opening the file";
  const w = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  w.onmessage = ({ data: m }) => {
    if (m.type === "progress") $("#work-msg").textContent = m.msg;
    if (m.type === "error") { w.terminate(); show("drop"); $("#drop-error").textContent = m.msg; $("#drop-error").hidden = false; }
    if (m.type === "done") { w.terminate(); askNames(m.data, m.tracks); }
  };
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
