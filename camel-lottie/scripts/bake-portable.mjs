// Produce a runtime-portable copy of public/lottie.json for lottie-web /
// lottie-react (the common web players). The authored file uses Skottie "slots"
// (`{sid}` refs + a top-level `slots` map) for live color editing; lottie-web
// does not resolve those, so here we inline each slot's default value as a
// normal static property and drop the slots map. Output: public/lottie.web.json
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

writeFileSync(resolve(root, "public/lottie.web.json"), JSON.stringify(portable));
console.log("Wrote public/lottie.web.json (slots inlined, no slot map)");
