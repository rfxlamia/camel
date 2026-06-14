// Produce a runtime-portable copy of public/lottie.json for lottie-web /
// lottie-react (the common web players). Two Skottie-isms are normalized here:
//   1. "slots" (`{sid}` refs + a top-level `slots` map) for live color editing —
//      lottie-web does not resolve those, so each slot's default is inlined as a
//      static property and the slots map is dropped.
//   2. The transparent background. Skottie honors a fill color's alpha channel,
//      so the bg rect reads as transparent there; lottie-web ignores color alpha
//      (it uses only the separate fill-opacity), so that same rect would paint a
//      near-white box. The web build has no background control to keep anyway, so
//      the whole background layer is removed — guaranteeing true transparency.
// Output: public/lottie.web.json
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const doc = JSON.parse(readFileSync(resolve(root, "public/lottie.json"), "utf8"));
const slots = doc.slots ?? {};

// Replace every `{ "sid": "x" }` with the slot's static default `{ a:0, k:<v> }`.
function inline(node) {
  if (Array.isArray(node)) return node.map(inline);
  if (node && typeof node === "object") {
    if (typeof node.sid === "string" && slots[node.sid]) {
      return { a: 0, k: slots[node.sid].p.k };
    }
    const out = {};
    for (const [key, val] of Object.entries(node)) out[key] = inline(val);
    return out;
  }
  return node;
}

const portable = inline(doc);
delete portable.slots;

// Drop the background layer so lottie-web renders on a fully transparent canvas.
const before = portable.layers.length;
portable.layers = portable.layers.filter((l) => l.nm !== "background");
const removed = before - portable.layers.length;

writeFileSync(resolve(root, "public/lottie.web.json"), JSON.stringify(portable));
console.log(`Wrote public/lottie.web.json (slots inlined, ${removed} background layer removed)`);
