/** Web-mercator tile column holding a longitude at zoom level `zoom`. */
export const tileX = (lon: number, zoom: number) => Math.min(2 ** zoom - 1, Math.floor(((lon + 180) / 360) * 2 ** zoom));

/** Web-mercator tile row holding a latitude at zoom level `zoom`. */
export function tileY(lat: number, zoom: number) {
  const radians = (lat * Math.PI) / 180;
  const row = Math.floor(((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * 2 ** zoom);
  return Math.min(2 ** zoom - 1, Math.max(0, row));
}

/** [west, south, east, north] of a list of [lon, lat] points. */
export function bboxOf(points: number[][]): [number, number, number, number] {
  const lons = points.map((point) => point[0]);
  const lats = points.map((point) => point[1]);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}
