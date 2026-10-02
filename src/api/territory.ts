import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { tileX, tileY } from '../lib/geo';
import { NEVER_STALE, get, groupingTilesUrl, type Names } from './client';

export type Territory = { type: string; code: number; name: string; parentLabel: string | null };
type LocalizedName = { pt: string; id: string; en: string };

export const useYears = () => useQuery({ queryKey: ['years'], queryFn: () => get<number[]>('/statistics/years'), ...NEVER_STALE });

export const useMonths = (year?: number) =>
  useQuery({ queryKey: ['months', year], queryFn: () => get<number[]>(`/statistics/${year}/months`), enabled: !!year, ...NEVER_STALE });

// The API calls the level above provinces "region / Wilayah"; they are island groups, so we call them islands.
const ISLAND: LocalizedName = { pt: 'Ilha', id: 'Pulau', en: 'Island' };

export const useTypeNames = () =>
  useQuery({
    queryKey: ['typeNames'],
    queryFn: async () => {
      const types = await get<(Names & { type: string })[]>('/territories/translations');
      return types.map((item) => (item.type === 'region' ? { ...item, namePt: ISLAND.pt, nameId: ISLAND.id, nameEn: ISLAND.en } : item));
    },
    ...NEVER_STALE,
  });

export const useLandCoverClasses = () =>
  useQuery({ queryKey: ['lcClasses'], queryFn: () => get<(Names & { id: number; color: string })[]>('/land-covers/translations'), ...NEVER_STALE });

export const useGroupings = (type: string, code: number) =>
  useQuery({
    queryKey: ['groupings', type, code],
    queryFn: async () => {
      const groupings = await get<Record<string, LocalizedName>>(`/territories/${type}/${code}/groupings`);
      return groupings.region ? { ...groupings, region: ISLAND } : groupings;
    },
    ...NEVER_STALE,
  });

export const useTerritoryLandCovers = (type: string, code: number) =>
  useQuery({
    queryKey: ['tlc', type, code],
    queryFn: () => get<(Names & { id: number })[]>(`/territories/${type}/${code}/land-covers`),
    ...NEVER_STALE,
  });

export const useBounds = (type: string, code: number, enabled = true) =>
  useQuery({
    queryKey: ['bounds', type, code],
    queryFn: () => get<{ geometry: { coordinates: number[][][] } }>(`/territories/${type}/${code}/bounds`),
    enabled,
    ...NEVER_STALE,
  });

const searchTerritories = (term: string) => get<Territory[]>(`/territories/search/${encodeURIComponent(term)}`);

export const useSearch = (input: string) => {
  // the API matches the exact text, so "TN  Way" (two spaces) would find nothing
  const term = input.trim().replace(/\s+/g, ' ');
  return useQuery({
    queryKey: ['search', term],
    queryFn: () => searchTerritories(term),
    enabled: term.length > 1,
    ...NEVER_STALE,
    placeholderData: keepPreviousData,
  });
};

/** Looks up a territory's name by searching its code (codes are only unique within a type). */
export const useTerritory = (type?: string, code?: number) =>
  useQuery({
    queryKey: ['territory', type, code],
    queryFn: async () => (await searchTerritories(String(code))).find((territory) => territory.type === type) ?? null,
    enabled: !!type && code != null,
    ...NEVER_STALE,
  });

/** A village's district code, read from the village map tiles (village codes don't contain it). */
export const useVillageDistrict = (code: number, enabled: boolean) => {
  const corners = useBounds('village', code, enabled).data?.geometry.coordinates[0];
  return useQuery({
    queryKey: ['villageDistrict', code],
    enabled: enabled && !!corners,
    ...NEVER_STALE,
    queryFn: async () => {
      const zoom = 10;
      const tiles = new Set(corners!.map(([lon, lat]) => `${tileX(lon, zoom)}/${tileY(lat, zoom)}`));
      for (const tile of tiles) {
        const response = await fetch(groupingTilesUrl('village').replace('{z}/{x}/{y}', `${zoom}/${tile}`));
        if (!response.ok) continue;
        const layer = new VectorTile(new PbfReader(new Uint8Array(await response.arrayBuffer()))).layers.default;
        for (let index = 0; index < (layer?.length ?? 0); index++) {
          const properties = layer.feature(index).properties;
          if (Number(properties.code) === code && properties.districtCode != null) return Number(properties.districtCode);
        }
      }
      return null;
    },
  });
};
