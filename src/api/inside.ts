import { groupingTilesUrl, shapeTilesUrl } from './client';

export type InsideRequest = { maskUrl: string; groupingUrl: string; grouping: string; bbox: number[][] };
/** Feature codes that touch the territory (`inside`), lie fully in it (`whole`), or also reach outside (`partial`). */
export type InsideResult = { inside: Set<number>; whole: Set<number>; partial: Set<number> };

type WorkerReply = { id: number; result?: InsideResult; error?: string };

// One worker handles every check; each request gets an id so replies find their promise.
let worker: Worker | undefined;
const waiting = new Map<number, { resolve: (result: InsideResult) => void; reject: (error: Error) => void }>();
let nextRequestId = 0;

/** Which features of the `grouping` layer lie inside territory `type`/`code` (computed in inside.worker.ts). */
export function codesInside(type: string, code: number, grouping: string, bbox: number[][]): Promise<InsideResult> {
  if (!worker) {
    worker = new Worker(new URL('./inside.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      const request = waiting.get(event.data.id);
      waiting.delete(event.data.id);
      if (event.data.result) request?.resolve(event.data.result);
      else request?.reject(new Error(event.data.error));
    };
  }
  const id = nextRequestId++;
  const request: InsideRequest = { maskUrl: shapeTilesUrl(type, code, type), groupingUrl: groupingTilesUrl(grouping), grouping, bbox };
  worker.postMessage({ ...request, id });
  return new Promise((resolve, reject) => waiting.set(id, { resolve, reject }));
}
