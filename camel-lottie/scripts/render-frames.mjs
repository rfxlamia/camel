// Headless verification: render given frames of public/lottie.json to PNGs via
// the same Skottie module the browser player uses (canvaskit-wasm/full, raster
// surface). Usage: node scripts/render-frames.mjs 0 60 120 165 210
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const CanvasKitInit = require("canvaskit-wasm/full");
const wasmPath = resolve(root, "node_modules/canvaskit-wasm/bin/full/canvaskit.wasm");

const frames = (process.argv.slice(2).length ? process.argv.slice(2) : ["0", "60", "120", "165", "210"])
  .map(Number);

const SIZE = 500; // render scale (composition is 1000x1000)

const ck = await CanvasKitInit({ locateFile: () => wasmPath });
const json = readFileSync(resolve(root, "public/lottie.json"), "utf8");

const anim = ck.MakeManagedAnimation(json);
if (!anim) throw new Error("Skottie could not parse lottie.json");

const fps = anim.fps() || 60;
const totalFrames = Math.max(1, Math.round(anim.duration() * fps));
console.log(`fps=${fps} duration=${anim.duration().toFixed(2)}s totalFrames=${totalFrames}`);

const surface = ck.MakeSurface(SIZE, SIZE);
const canvas = surface.getCanvas();

for (const f of frames) {
  canvas.clear(ck.TRANSPARENT);
  anim.seekFrame(f);
  anim.render(canvas, ck.LTRBRect(0, 0, SIZE, SIZE));
  surface.flush();
  const img = surface.makeImageSnapshot();
  const png = img.encodeToBytes();
  const out = resolve(root, `scripts/frame-${f}.png`);
  writeFileSync(out, Buffer.from(png));
  img.delete();
  console.log(`wrote ${out}`);
}

surface.delete();
anim.delete();
