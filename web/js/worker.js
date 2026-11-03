// Runs the heavy lifting off the main thread. The file is read here and never sent anywhere.
import { processTimeline } from "./process.js";

self.onmessage = async ({ data: file }) => {
  try {
    const say = (msg) => self.postMessage({ type: "progress", msg });
    say("Opening the file");
    const raw = JSON.parse(await file.text());
    say("Loading the world's cities");
    const geo = await (await fetch(new URL("../geo/cities.json", import.meta.url))).json();
    const out = processTimeline(raw, geo, say);
    self.postMessage({ type: "done", ...out });
  } catch (e) {
    self.postMessage({ type: "error", msg: e instanceof SyntaxError ? "That file isn't valid JSON. Pick the Timeline.json you exported from Google Maps." : e.message });
  }
};
