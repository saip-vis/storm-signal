export const REGIONS={
  'richardson-central-test':{id:'richardson-central-test',name:'Central Richardson regression test area',bbox:[-96.731,32.950,-96.727,32.954],source:'Configured bounded study rectangle; not a municipal boundary',coverageDescription:'Small central Richardson test area for fast acquisition and regression tests.'},
  'richardson-north-central-study':{id:'richardson-north-central-study',name:'North-central Richardson study area',bbox:[-96.755,32.935,-96.705,32.975],source:'Configured bounded study rectangle using City of Richardson vicinity; not a legal city boundary',coverageDescription:'Larger north-central Richardson study rectangle for geographic visualization, deliberately bounded below city scale.'}
};
export const DEFAULT_REGION_ID='richardson-central-test';
export function region(id=DEFAULT_REGION_ID){const value=REGIONS[id];if(!value)throw new Error(`Unknown geographic region: ${id}`);return {...value,crs:'WGS84 / EPSG:4326'};}
