// Runs the heavy lifting off the main thread. The file is read here and never sent anywhere.
import { processTimeline } from "./process.js";

self.onmessage = async ({ data: file }) => {
  try {
    const say = (msg) => self.postMessage({ type: "progress", msg });
    say(file.size > 50e6 ? `Opening a ${Math.round(file.size / 1e6)} MB file. Big ones take a minute` : "Opening the file");
    let raw;
    try { raw = JSON.parse(await file.text()); } catch (e) { throw e instanceof SyntaxError ? new Error("That file isn't valid JSON. Pick the Timeline.json you exported from Google Maps.") : e; }
    say("Loading the world's cities");
    const geo = await fetch(new URL("../geo/cities.json", import.meta.url)).then((r) => r.json()).catch(() => { throw new Error("Couldn't load the list of world cities. Check your connection and try again."); });
    const out = processTimeline(raw, geo, say);
    self.postMessage({ type: "done", ...out });
  } catch (e) {
    // our own messages are plain Errors; anything else means the file had a shape we didn't expect
    self.postMessage({ type: "error", msg: e?.name === "Error" ? e.message : `Something in this file didn't look like a Google Maps Timeline export, so it couldn't be read (${e?.message || e}).` });
  }
};
