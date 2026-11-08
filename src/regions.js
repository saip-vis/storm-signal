import regions from '../config/regions.json' with { type: 'json' };
export const REGIONS=regions;
export const DEFAULT_REGION_ID='richardson-central-test';
export const VISUALIZATION_REGION_ID='richardson-north-central-study';
export function region(id=DEFAULT_REGION_ID){const value=REGIONS[id];if(!value)throw new Error(`Unknown geographic region: ${id}`);return {...value,crs:'WGS84 / EPSG:4326'};}
