// Build-time only. Converts the camel SVG outline into a Lottie (Bodymovin)
// document with a "draw-on" effect: strokes trace the contours (animated trim
// path), then a fill fades in, then everything fades out for a seamless loop.
// Not shipped in lottie.json — this just emits public/lottie.json + controls.json.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import svgpath from "svgpath";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const svg = readFileSync(resolve(root, "public/noun-camel-1284489.svg"), "utf8");

// Pull every <path d="..."> (ignore the <text> attribution — dropped on purpose).
const dAttrs = [...svg.matchAll(/<path[^>]*\bd="([^"]+)"/g)].map((m) => m[1]);
if (dAttrs.length === 0) throw new Error("No <path> found in SVG");

/** Parse one `d` into subpaths of cubic segments (absolute coords). */
function pathToSubpaths(d) {
  const subpaths = [];
  let cur = null;
  let x = 0, y = 0, sx = 0, sy = 0;

  const flush = () => { if (cur && cur.segs.length) subpaths.push(cur); };

  svgpath(d).abs().unarc().unshort().iterate((seg) => {
    const cmd = seg[0];
    if (cmd === "M") {
      flush();
      x = seg[1]; y = seg[2]; sx = x; sy = y;
      cur = { segs: [], closed: false };
    } else if (cmd === "L") {
      const nx = seg[1], ny = seg[2];
      cur.segs.push({ p0: [x, y], c1: [x, y], c2: [nx, ny], p3: [nx, ny] });
      x = nx; y = ny;
    } else if (cmd === "H") {
      const nx = seg[1];
      cur.segs.push({ p0: [x, y], c1: [x, y], c2: [nx, y], p3: [nx, y] });
      x = nx;
    } else if (cmd === "V") {
      const ny = seg[1];
      cur.segs.push({ p0: [x, y], c1: [x, y], c2: [x, ny], p3: [x, ny] });
      y = ny;
    } else if (cmd === "C") {
      const c1 = [seg[1], seg[2]], c2 = [seg[3], seg[4]], p3 = [seg[5], seg[6]];
      cur.segs.push({ p0: [x, y], c1, c2, p3 });
      x = p3[0]; y = p3[1];
    } else if (cmd === "Q") {
      const qc = [seg[1], seg[2]], p3 = [seg[3], seg[4]];
      const c1 = [x + (2 / 3) * (qc[0] - x), y + (2 / 3) * (qc[1] - y)];
      const c2 = [p3[0] + (2 / 3) * (qc[0] - p3[0]), p3[1] + (2 / 3) * (qc[1] - p3[1])];
      cur.segs.push({ p0: [x, y], c1, c2, p3 });
      x = p3[0]; y = p3[1];
    } else if (cmd === "Z" || cmd === "z") {
      if (cur) {
        cur.closed = true;
        if (x !== sx || y !== sy) {
          cur.segs.push({ p0: [x, y], c1: [x, y], c2: [sx, sy], p3: [sx, sy] });
        }
        x = sx; y = sy;
      }
    }
  });
  flush();
  return subpaths;
}

/** Convert one subpath (cubic segments) into a Lottie bezier shape value. */
function subpathToBezier(sp) {
  const segs = sp.segs;
  const v = [];
  for (let k = 0; k < segs.length; k++) v.push(segs[k].p0);
  if (!sp.closed) v.push(segs[segs.length - 1].p3);

  const m = v.length;
  const iT = Array.from({ length: m }, () => [0, 0]);
  const oT = Array.from({ length: m }, () => [0, 0]);

  // out-tangent of vertex k from segment k's first control point.
  for (let k = 0; k < segs.length && k < m; k++) {
    oT[k] = [segs[k].c1[0] - v[k][0], segs[k].c1[1] - v[k][1]];
  }
  // in-tangent of vertex k from segment (k-1)'s second control point.
  for (let k = 1; k < m; k++) {
    iT[k] = [segs[k - 1].c2[0] - v[k][0], segs[k - 1].c2[1] - v[k][1]];
  }
  if (sp.closed) {
    const last = segs[segs.length - 1];
    iT[0] = [last.c2[0] - v[0][0], last.c2[1] - v[0][1]];
  }
  return { c: sp.closed, v, i: iT, o: oT };
}

// Group subpaths per original <path> (needed so fill winding/holes render right).
const pathGroups = dAttrs.map((d) => pathToSubpaths(d).map(subpathToBezier));
const allBeziers = pathGroups.flat();

// Report geometry bounds for a sanity check during the build.
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const b of allBeziers) {
  for (const [px, py] of b.v) {
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }
}
console.log(`paths=${dAttrs.length} subpaths=${allBeziers.length} ` +
  `bbox=[${minX.toFixed(0)},${minY.toFixed(0)} .. ${maxX.toFixed(0)},${maxY.toFixed(0)}]`);

const W = 1000, H = 1000, FR = 60, OP = 240;

const stat = (k) => ({ a: 0, k });
const sh = (bez) => ({ ty: "sh", ks: stat(bez) });
const groupTr = () => ({
  ty: "tr", p: stat([0, 0]), a: stat([0, 0]), s: stat([100, 100]),
  r: stat(0), o: stat(100),
});

// --- Stroke layer: all contours + animated trim path ("the lines drawing"). ---
const strokeGroup = {
  ty: "gr", nm: "outline",
  it: [
    ...allBeziers.map(sh),
    {
      ty: "tm", nm: "draw",
      s: stat(0),
      e: {
        a: 1,
        k: [
          { t: 0, s: [0], i: { x: [0.62], y: [1] }, o: { x: [0.38], y: [0] } },
          { t: 120, s: [100] },
        ],
      },
      o: stat(0), m: 2,
    },
    {
      ty: "st", nm: "stroke",
      c: { sid: "strokeColor" }, o: stat(100), w: { sid: "strokeWidth" },
      lc: 2, lj: 2, ml: 4,
    },
    groupTr(),
  ],
};

const strokeLayer = {
  ty: 4, nm: "camel-stroke", ip: 0, op: OP, st: 0,
  ks: {
    o: {
      a: 1,
      k: [
        { t: 0, s: [100], i: { x: [0.5], y: [1] }, o: { x: [0.5], y: [0] } },
        { t: 210, s: [100], i: { x: [0.5], y: [1] }, o: { x: [0.5], y: [0] } },
        { t: 240, s: [0] },
      ],
    },
    r: stat(0), p: stat([W / 2, H / 2, 0]), a: stat([W / 2, H / 2, 0]),
    s: stat([100, 100, 100]),
  },
  shapes: [strokeGroup],
};

// --- Fill layer: solid camel, fades in once the lines are (mostly) drawn. ---
const fillGroups = pathGroups.map((beziers, idx) => ({
  ty: "gr", nm: `fill-${idx}`,
  it: [
    ...beziers.map(sh),
    { ty: "fl", nm: "fill", c: { sid: "fillColor" }, o: stat(100), r: 1 },
    groupTr(),
  ],
}));

const fillLayer = {
  ty: 4, nm: "camel-fill", ip: 0, op: OP, st: 0,
  ks: {
    o: {
      a: 1,
      k: [
        { t: 110, s: [0], i: { x: [0.5], y: [1] }, o: { x: [0.5], y: [0] } },
        { t: 165, s: [100], i: { x: [0.5], y: [1] }, o: { x: [0.5], y: [0] } },
        { t: 210, s: [100], i: { x: [0.5], y: [1] }, o: { x: [0.5], y: [0] } },
        { t: 240, s: [0] },
      ],
    },
    r: stat(0), p: stat([W / 2, H / 2, 0]), a: stat([W / 2, H / 2, 0]),
    s: stat([100, 100, 100]),
  },
  shapes: fillGroups,
};

// --- Background layer (last = bottom). Slotted color, per skill requirement. ---
const bgLayer = {
  ty: 4, nm: "background", ip: 0, op: OP, st: 0,
  ks: {
    o: stat(100), p: stat([W / 2, H / 2, 0]), a: stat([0, 0, 0]),
    s: stat([100, 100, 100]), r: stat(0),
  },
  shapes: [
    {
      ty: "gr", it: [
        { ty: "rc", p: stat([W / 2, H / 2]), s: stat([W, H]), r: stat(0) },
        { ty: "fl", c: { sid: "bgColor" }, o: stat(100), r: 1 },
        groupTr(),
      ],
    },
  ],
};

const lottie = {
  v: "5.7.0", fr: FR, ip: 0, op: OP, w: W, h: H, nm: "camel-draw-on", assets: [],
  slots: {
    strokeColor: { p: { a: 0, k: [0.349, 0.2078, 0.1608, 1] } }, // accent-800 #593529
    fillColor: { p: { a: 0, k: [0.4745, 0.2941, 0.2314, 1] } },  // accent-700 #794b3b
    strokeWidth: { p: { a: 0, k: 7 } },
    bgColor: { p: { a: 0, k: [0.9216, 0.9686, 1.0, 0] } },        // transparent (loading-UI overlay); alpha up to fill #ebf7ff
  },
  layers: [strokeLayer, fillLayer, bgLayer],
};

writeFileSync(resolve(root, "public/lottie.json"), JSON.stringify(lottie));

const controls = {
  controls: [
    { sid: "strokeColor", label: "Line color" },
    { sid: "fillColor", label: "Fill color" },
    { sid: "strokeWidth", label: "Line width", min: 1, max: 20, step: 1 },
    { sid: "bgColor", label: "Background color" },
  ],
};
writeFileSync(resolve(root, "public/controls.json"), JSON.stringify(controls, null, 2));

console.log("Wrote public/lottie.json and public/controls.json");
