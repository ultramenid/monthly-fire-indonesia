import { Fragment } from 'react';
import { Undo2 } from 'lucide-react';
import { useTerritory, useVillageDistrict } from './api';
import { useI18n } from './i18n';
import { selectTerritory } from './state';

type TerritoryRef = { type: string; code: number };

// First digit of a province code → its island (region) code, following BPS numbering.
const REGION_BY_PROVINCE_DIGIT: Record<string, number> = { 1: 1, 2: 1, 3: 2, 5: 4, 6: 3, 7: 5, 8: 6, 9: 7 };

/**
 * Parent territories worked out from nested BPS codes, e.g. regency 6104 → province 61 → region 3.
 * Village codes aren't nested, so for a village the caller passes its district code.
 */
function ancestorsOf({ type, code }: TerritoryRef, villageDistrict?: number | null): TerritoryRef[] {
  const digits = String(code);
  const provinceAndRegion = (provinceCode: string): TerritoryRef[] => [
    { type: 'region', code: REGION_BY_PROVINCE_DIGIT[provinceCode[0]] },
    { type: 'province', code: Number(provinceCode) },
  ];
  switch (type) {
    case 'province':
      return provinceAndRegion(digits).slice(0, 1);
    case 'regency':
      return provinceAndRegion(digits.slice(0, 2));
    case 'district':
      return [...provinceAndRegion(digits.slice(0, 2)), { type: 'regency', code: Number(digits.slice(0, 4)) }];
    case 'village':
      if (!villageDistrict) return [];
      return [...ancestorsOf({ type: 'district', code: villageDistrict }), { type: 'district', code: villageDistrict }];
    default:
      return [];
  }
}

function Crumb({ territory }: { territory: TerritoryRef }) {
  const { data } = useTerritory(territory.type, territory.code);
  return (
    <button className="font-normal text-muted hover:text-fg hover:underline" onClick={() => selectTerritory(territory.type, territory.code)}>
      {data?.name ?? '…'}
    </button>
  );
}

const Separator = () => <span className="text-muted">/</span>;

export function Breadcrumb({ type, code, name, parentLabel }: TerritoryRef & { name: string; parentLabel?: string | null }) {
  const { labels } = useI18n();
  const isCountry = type === 'country';
  const villageDistrict = useVillageDistrict(code, type === 'village').data;
  const ancestors = ancestorsOf({ type, code }, villageDistrict);
  const trail: TerritoryRef[] = isCountry ? [] : [{ type: 'country', code: 1 }, ...ancestors];
  const parent = trail.at(-1);
  // Thematic areas (parks, concessions…) have no code-based parents; the API's parentLabel names one instead.
  const labelOnlyParent = !isCountry && ancestors.length === 0 && parentLabel && parentLabel !== 'Indonesia' ? parentLabel : null;

  return (
    <nav className="flex min-h-8 items-center gap-2 overflow-x-auto border-b bg-bg px-4 py-1 font-bold whitespace-nowrap" aria-label="breadcrumb">
      {parent && (
        <button className="grid text-fg" aria-label={labels.back} onClick={() => selectTerritory(parent.type, parent.code)}>
          <Undo2 size={16} />
        </button>
      )}
      {trail.map((territory) => (
        <Fragment key={`${territory.type}:${territory.code}`}>
          <Crumb territory={territory} />
          <Separator />
        </Fragment>
      ))}
      {labelOnlyParent && (
        <>
          <span className="font-normal text-muted">{labelOnlyParent}</span>
          <Separator />
        </>
      )}
      <span className="text-accent-icon">{name}</span>
    </nav>
  );
}
