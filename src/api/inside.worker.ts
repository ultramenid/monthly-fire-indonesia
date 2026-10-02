import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { bboxOf, tileX, tileY } from '../lib/geo';
import type { InsideRequest } from './inside';

/*
 * Web worker: which features of a thematic layer lie inside a territory, worked out from the map tiles.
 * Needed for layers whose features carry no admin codes (concessions, peatland…), so the API can't tell us.
 * Runs off the main thread because big layers mean millions of point-in-polygon tests.
 */

type Point = number[];
type Ring = Point[];
type Tile = { z: number; x: number; y: number };

/** Returns a fast "is this point inside the ring?" test. Edges are grouped in horizontal bands so a point only checks its own band. */
function pointInRingTest(ring: Ring) {
  const [west, south, east, north] = bboxOf(ring);
  const bandCount = Math.max(1, Math.min(1024, ring.length >> 2));
  const bandHeight = (north - south) / bandCount || 1;
  const bandOf = (lat: number) => Math.floor((lat - south) / bandHeight);
  const edgesInBand: number[][] = Array.from({ length: bandCount }, () => []);
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const low = Math.min(ring[current][1], ring[previous][1]);
    const high = Math.max(ring[current][1], ring[previous][1]);
    for (let band = Math.max(0, bandOf(low)); band <= Math.min(bandCount - 1, bandOf(high)); band++) edgesInBand[band].push(current);
  }
  return ([lon, lat]: Point) => {
    if (lon < west || lon > east || lat < south || lat > north) return false;
    // ray casting: count how many edges a line going right from the point crosses
    let isInside = false;
    for (const current of edgesInBand[Math.min(bandCount - 1, bandOf(lat))]) {
      const previous = current === 0 ? ring.length - 1 : current - 1;
      const [lon1, lat1] = ring[current];
      const [lon2, lat2] = ring[previous];
      const crossesLat = lat1 > lat !== lat2 > lat;
      if (crossesLat && lon < ((lon2 - lon1) * (lat - lat1)) / (lat2 - lat1) + lon1) isInside = !isInside;
    }
    return isInside;
  };
}

const polygonsOf = (geometry: GeoJSON.Geometry): Ring[][] => {
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
};

/** Tiles covering the bbox, at the most detailed zoom (≤ 12) that needs at most 6 tiles. */
function tilesFor(bbox: number[][]): Tile[] {
  const [west, south, east, north] = bboxOf(bbox);
  for (let z = 12; ; z--) {
    const [firstX, lastX, firstY, lastY] = [tileX(west, z), tileX(east, z), tileY(north, z), tileY(south, z)];
    if ((lastX - firstX + 1) * (lastY - firstY + 1) <= 6 || z === 4) {
      const tiles: Tile[] = [];
      for (let x = firstX; x <= lastX; x++) for (let y = firstY; y <= lastY; y++) tiles.push({ z, x, y });
      return tiles;
    }
  }
}

async function featuresInTile(urlTemplate: string, { z, x, y }: Tile) {
  const response = await fetch(urlTemplate.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)));
  if (!response.ok) return [];
  const layer = new VectorTile(new PbfReader(new Uint8Array(await response.arrayBuffer()))).layers.default;
  if (!layer) return [];
  return Array.from({ length: layer.length }, (_, index) => layer.feature(index).toGeoJSON(x, y, z));
}

// Full extent of every feature, from the 6 zoom-4 tiles covering Indonesia (loaded once per layer). Tiles near the
// territory can't see far-away parts of a multi-part shape (one rhino habitat spans Sumatra to Borneo).
const extentsByLayer = new Map<string, Promise<Map<number, number[]>>>();
function featureExtents(grouping: string, groupingUrl: string) {
  if (!extentsByLayer.has(grouping)) extentsByLayer.set(grouping, loadExtents(groupingUrl));
  return extentsByLayer.get(grouping)!;
}
async function loadExtents(groupingUrl: string) {
  const extents = new Map<number, number[]>();
  const indonesiaTiles = [12, 13, 14].flatMap((x) => [7, 8].map((y) => ({ z: 4, x, y })));
  const features = (await Promise.all(indonesiaTiles.map((tile) => featuresInTile(groupingUrl, tile)))).flat();
  for (const feature of features) {
    const code = Number(feature.properties?.code);
    const extent = extents.get(code) ?? [Infinity, Infinity, -Infinity, -Infinity];
    for (const [lon, lat] of polygonsOf(feature.geometry).flat(2)) {
      extent[0] = Math.min(extent[0], lon);
      extent[1] = Math.min(extent[1], lat);
      extent[2] = Math.max(extent[2], lon);
      extent[3] = Math.max(extent[3], lat);
    }
    extents.set(code, extent);
  }
  return extents;
}

// Nudge distance (~200 m): a vertex on a shared border isn't "outside" just because it sits on the line.
const NUDGE = 0.002;
// How far (in degrees, ~5 km) a feature's extent may pass the territory's bbox; zoom-4 shapes are simplified.
const EXTENT_TOLERANCE = 0.05;
// More than 10% of sampled vertices clearly outside makes a feature "partial".
const OUTSIDE_SHARE = 0.1;

/**
 * Samples up to ~48 vertices per feature and counts how many fall inside / outside the territory.
 * The territory's shape tiles are a mask covering everything *outside* it.
 * Known limit: a shape that swallows the whole territory without a vertex inside it is missed.
 */
async function codesInside({ maskUrl, groupingUrl, grouping, bbox }: InsideRequest) {
  const tiles = tilesFor(bbox);
  const loadFeatures = async (url: string) => (await Promise.all(tiles.map((tile) => featuresInTile(url, tile)))).flat();
  const [maskFeatures, layerFeatures, extents] = await Promise.all([loadFeatures(maskUrl), loadFeatures(groupingUrl), featureExtents(grouping, groupingUrl)]);

  const maskPolygons = maskFeatures.flatMap((feature) => polygonsOf(feature.geometry)).map(([outer, ...holes]) => ({ outer: pointInRingTest(outer), holes: holes.map(pointInRingTest) }));
  const isMasked = (point: Point) => maskPolygons.some(({ outer, holes }) => outer(point) && !holes.some((inHole) => inHole(point)));
  // tiles reach a little past their edge where the mask may be missing, so only trust points inside the bbox
  const [west, south, east, north] = bboxOf(bbox);
  const isInBbox = ([lon, lat]: Point) => lon >= west && lon <= east && lat >= south && lat <= north;
  const isClearlyOutside = ([lon, lat]: Point) =>
    [[lon, lat], [lon + NUDGE, lat], [lon - NUDGE, lat], [lon, lat + NUDGE], [lon, lat - NUDGE]].every((point) => !isInBbox(point) || isMasked(point));

  const counts = new Map<number, { inside: number; outside: number }>();
  for (const feature of layerFeatures) {
    const code = Number(feature.properties?.code);
    const count = counts.get(code) ?? { inside: 0, outside: 0 };
    const vertices = polygonsOf(feature.geometry).flatMap((polygon) => polygon.flat());
    const step = Math.max(1, Math.floor(vertices.length / 48));
    for (let index = 0; index < vertices.length; index += step) {
      if (isInBbox(vertices[index]) && !isMasked(vertices[index])) count.inside++;
      else if (isClearlyOutside(vertices[index])) count.outside++;
    }
    counts.set(code, count);
  }

  const reachesBeyondBbox = (extent?: number[]) =>
    !!extent && (extent[0] < west - EXTENT_TOLERANCE || extent[1] < south - EXTENT_TOLERANCE || extent[2] > east + EXTENT_TOLERANCE || extent[3] > north + EXTENT_TOLERANCE);
  const inside = new Set<number>();
  const partial = new Set<number>();
  for (const [code, count] of counts) {
    if (count.inside === 0) continue;
    inside.add(code);
    if (count.outside / (count.inside + count.outside) > OUTSIDE_SHARE || reachesBeyondBbox(extents.get(code))) partial.add(code);
  }
  return { inside, partial, whole: new Set([...inside].filter((code) => !partial.has(code))) };
}

self.onmessage = async (event: MessageEvent<InsideRequest & { id: number }>) => {
  try {
    self.postMessage({ id: event.data.id, result: await codesInside(event.data) });
  } catch (error) {
    self.postMessage({ id: event.data.id, error: String(error) });
  }
};
