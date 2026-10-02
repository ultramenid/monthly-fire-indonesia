import { groupingTilesUrl, shapeTilesUrl } from './api';

export type InsideRequest = { maskUrl: string; groupingUrl: string; grouping: string; bbox: number[][] };
export type InsideResult = { inside: Set<number>; whole: Set<number>; partial: Set<number> };

// one worker for every check; replies are matched to requests by id
let worker: Worker | undefined;
const pending = new Map<number, { resolve: (r: InsideResult) => void; reject: (e: Error) => void }>();
let nextId = 0;

/** Features of `grouping` touching / wholly inside / partly outside territory type/code (computed in inside.worker.ts). */
export function codesInside(type: string, code: number, grouping: string, bbox: number[][]): Promise<InsideResult> {
  if (!worker) {
    worker = new Worker(new URL('./inside.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; result?: InsideResult; error?: string }>) => {
      const p = pending.get(e.data.id);
      pending.delete(e.data.id);
      if (e.data.result) p?.resolve(e.data.result);
      else p?.reject(new Error(e.data.error));
    };
  }
  const id = nextId++;
  const req: InsideRequest = { maskUrl: shapeTilesUrl(type, code, type), groupingUrl: groupingTilesUrl(grouping), grouping, bbox };
  worker.postMessage({ ...req, id });
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
