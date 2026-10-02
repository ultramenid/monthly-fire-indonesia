import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import type { InsideRequest } from './inside';

/**
 * Web worker: which features of a thematic layer lie inside a territory, worked out from the vector tiles themselves.
 * Needed for layers whose features carry no admin codes (concessions, peatland, …), which the API never links to a territory.
 * Runs off the main thread: big layers mean millions of point-in-polygon tests.
 */

type Ring = number[][];
/** Ring with its edges bucketed by latitude, so a point only tests the edges crossing its own band. */
function indexRing(r: Ring) {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of r) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
  const n = Math.max(1, Math.min(1024, r.length >> 2));
  const h = (y1 - y0) / n || 1;
  const buckets: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [a, b] = [Math.min(r[i][1], r[j][1]), Math.max(r[i][1], r[j][1])];
    for (let k = Math.max(0, Math.floor((a - y0) / h)); k <= Math.min(n - 1, Math.floor((b - y0) / h)); k++) buckets[k].push(i);
  }
  return ([x, y]: number[]) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    let inside = false;
    for (const i of buckets[Math.min(n - 1, Math.floor((y - y0) / h))]) {
      const j = i === 0 ? r.length - 1 : i - 1;
      if (r[i][1] > y !== r[j][1] > y && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) inside = !inside;
    }
    return inside;
  };
}
const polygonsOf = (g: GeoJSON.Geometry): Ring[][] => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);

type Tile = { z: number; x: number; y: number };
/** Tiles covering the bbox at the deepest zoom (≤ 12) that needs at most 6 of them. */
function tilesFor(bbox: number[][]): Tile[] {
  const lons = bbox.map((p) => p[0]);
  const lats = bbox.map((p) => p[1]);
  const tx = (lon: number, n: number) => Math.min(n - 1, Math.floor(((lon + 180) / 360) * n));
  const ty = (lat: number, n: number) => {
    const r = (lat * Math.PI) / 180;
    return Math.min(n - 1, Math.max(0, Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)));
  };
  for (let z = 12; ; z--) {
    const n = 2 ** z;
    const [x0, x1, y0, y1] = [tx(Math.min(...lons), n), tx(Math.max(...lons), n), ty(Math.max(...lats), n), ty(Math.min(...lats), n)];
    if ((x1 - x0 + 1) * (y1 - y0 + 1) <= 6 || z === 4) {
      const out: Tile[] = [];
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push({ z, x, y });
      return out;
    }
  }
}

async function features(template: string, { z, x, y }: Tile) {
  const r = await fetch(template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)));
  if (!r.ok) return [];
  const layer = new VectorTile(new PbfReader(new Uint8Array(await r.arrayBuffer()))).layers.default;
  return layer ? Array.from({ length: layer.length }, (_, i) => layer.feature(i).toGeoJSON(x, y, z)) : [];
}

// Whole-feature extents from the 6 zoom-4 tiles over Indonesia, once per layer: tiles near the territory can't see far-away
// parts of a multi-part shape (one rhino habitat spans Sumatra to Borneo). Tiny features drop out at z4; they are local anyway.
const extents = new Map<string, Promise<Map<number, number[]>>>();
function extentsOf(grouping: string, groupingUrl: string) {
  if (!extents.has(grouping))
    extents.set(
      grouping,
      (async () => {
        const out = new Map<number, number[]>();
        const tiles = [12, 13, 14].flatMap((x) => [7, 8].map((y) => ({ z: 4, x, y })));
        for (const f of (await Promise.all(tiles.map((t) => features(groupingUrl, t)))).flat()) {
          const c = Number(f.properties?.code);
          const e = out.get(c) ?? [Infinity, Infinity, -Infinity, -Infinity];
          for (const [x, y] of polygonsOf(f.geometry).flat(2)) {
            e[0] = Math.min(e[0], x);
            e[1] = Math.min(e[1], y);
            e[2] = Math.max(e[2], x);
            e[3] = Math.max(e[3], y);
          }
          out.set(c, e);
        }
        return out;
      })(),
    );
  return extents.get(grouping)!;
}

/**
 * Features of `grouping` inside territory type/code: `inside` touch it, `whole` lie entirely within it (so their burned
 * area is the territory's too), `partial` also reach outside. Shape tiles are the mask *outside* the territory.
 */
// ponytail: vertex sampling misses a shape that swallows the whole territory without a vertex inside; fine for concessions.
async function codesInside({ maskUrl, groupingUrl, grouping, bbox }: InsideRequest) {
  const tiles = tilesFor(bbox);
  const [[mask, feats], extent] = await Promise.all([
    Promise.all([maskUrl, groupingUrl].map(async (url) => (await Promise.all(tiles.map((t) => features(url, t)))).flat())),
    extentsOf(grouping, groupingUrl),
  ]);
  const maskPolys = mask.flatMap((f) => polygonsOf(f.geometry)).map(([outer, ...holes]) => [indexRing(outer), ...holes.map(indexRing)]);
  // tiles carry a buffer past their edge where the mask may be missing, so only trust points inside the bbox
  const [w, s, e, n] = [Math.min(...bbox.map((p) => p[0])), Math.min(...bbox.map((p) => p[1])), Math.max(...bbox.map((p) => p[0])), Math.max(...bbox.map((p) => p[1]))];
  const inBox = ([x, y]: number[]) => x >= w && x <= e && y >= s && y <= n;
  const masked = (pt: number[]) => maskPolys.some(([outer, ...inner]) => outer(pt) && !inner.some((h) => h(pt)));
  // outside even when nudged ~200 m every way: vertices on a shared border (a habitat drawn along the park edge) don't count
  const D = 0.002;
  const clearlyOutside = ([x, y]: number[]) =>
    [[x, y], [x + D, y], [x - D, y], [x, y + D], [x, y - D]].every((q) => !inBox(q) || masked(q));
  // sampled vertices per feature code: [inside, outside]
  const count = new Map<number, [number, number]>();
  for (const f of feats) {
    const c = Number(f.properties?.code);
    const n = count.get(c) ?? [0, 0];
    // every part: a multi-part shape (e.g. the one rhino habitat spanning Sumatra) has parts far away
    const pts = polygonsOf(f.geometry).flatMap((p) => p.flat());
    const step = Math.max(1, Math.floor(pts.length / 48));
    for (let i = 0; i < pts.length; i += step) {
      if (inBox(pts[i]) && !masked(pts[i])) n[0]++;
      else if (clearlyOutside(pts[i])) n[1]++;
    }
    count.set(c, n);
  }
  const inside = new Set([...count].filter(([, [i]]) => i > 0).map(([c]) => c));
  // > 10% clearly outside; a few stray vertices don't make a shape partial
  // z4 geometry is simplified, so only an extent clearly past the territory's bbox (~5 km) counts
  const T = 0.05;
  const beyond = (x?: number[]) =>
    !!x && (x[0] < w - T || x[1] < s - T || x[2] > e + T || x[3] > n + T);
  const partial = new Set([...count].filter(([c, [i, o]]) => i > 0 && (o / (i + o) > 0.1 || beyond(extent.get(c)))).map(([c]) => c));
  return { inside, partial, whole: new Set([...inside].filter((c) => !partial.has(c))) };
}

self.onmessage = async (e: MessageEvent<InsideRequest & { id: number }>) => {
  try {
    self.postMessage({ id: e.data.id, result: await codesInside(e.data) });
  } catch (err) {
    self.postMessage({ id: e.data.id, error: String(err) });
  }
};
