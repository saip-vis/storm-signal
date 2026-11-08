import { readFile } from 'node:fs/promises';
import { geometryValid, intersectsBbox } from '../buildings.js';
import { VISUALIZATION_REGION_ID, region } from '../regions.js';
export const TORNADO_CACHE=new URL('../../data/hazards/noaa-richardson-2019.geojson',import.meta.url);
export const NOAA_DAT='https://services.dat.noaa.gov/arcgis/rest/services/nws_damageassessmenttoolkit/DamageViewer/FeatureServer/2';
export const TORNADO_LIMITATIONS=[
  'Official NWS post-event survey contour; NOAA considers DAT survey data preliminary. This is not a current warning or forecast.',
  'The EF label belongs to this supplied survey contour, not to every building or the maximum rating of the entire tornado.',
  'Present-day cached buildings are intersected with a historical contour. A building may not have existed in 2019; intersection does not establish historical damage.',
  'No tornado damage model, closure probabilities, financial loss, displacement, utility dependencies or recovery estimates are available.'
];
export function normalizeTornadoCollection(collection){
  if(collection?.type!=='FeatureCollection'||!Array.isArray(collection.features)||collection.features.length>10||collection.exceededTransferLimit)throw new Error('Invalid or truncated bounded NOAA collection');
  if(!collection.metadata?.sourceUrl?.startsWith(NOAA_DAT+'/query?')||!Number.isFinite(Date.parse(collection.metadata.acquiredAt)))throw new Error('NOAA acquisition provenance missing');
  const seen=new Set();return collection.features.map(f=>{
    const p=f.properties??{};
    if(!geometryValid(f.geometry)||!intersectsBbox(f.geometry,region(VISUALIZATION_REGION_ID).bbox))throw new Error('Invalid or out-of-region NOAA polygon');
    if(!Number.isInteger(p.objectid)||!p.event_id||!Number.isFinite(p.stormdate)||!/^EF[0-5U]$/.test(p.efscale??''))throw new Error('NOAA identifiers, date or EF contour missing');
    if(seen.has(p.objectid))throw new Error('Duplicate NOAA polygon');seen.add(p.objectid);
    const date=new Date(p.stormdate).toISOString(),localDate=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(p.stormdate));
    return {id:`noaa-dat:${p.objectid}`,name:`${localDate} Dallas/Richardson · ${p.efscale} survey contour`,locationId:VISUALIZATION_REGION_ID,disasterType:'tornado',sourceType:'historical_observed',eventDate:date,eventId:p.event_id,reportedContourRating:p.efscale,eventMaximumRating:null,footprint:f.geometry,source:{provider:'NOAA/NWS Damage Assessment Toolkit',url:collection.metadata.sourceUrl,acquiredAt:collection.metadata.acquiredAt,objectId:p.objectid,globalId:p.globalid,lastEditedAt:p.last_edited_date,originalProperties:p},assumptions:[],limitations:TORNADO_LIMITATIONS};
  });
}
export async function tornadoScenarios(){return normalizeTornadoCollection(JSON.parse(await readFile(TORNADO_CACHE,'utf8')));}
export async function tornadoAvailability(){try{const events=await tornadoScenarios();return {available:events.length>0,events,reason:events.length?null:'No intersecting surveys in the bounded historical snapshot'};}catch(error){return {available:false,events:[],reason:error.message};}}
