import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_REGION_ID, VISUALIZATION_REGION_ID, region as configuredRegion } from './regions.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const BUILDING_SCHEMA_VERSION=2;
export const RICHARDSON_PILOT={locationId:'richardson-tx',coverageLabel:'Central Richardson rectangular building-footprint study area (not an official city boundary)',bbox:[-96.731,32.950,-96.727,32.954],crs:'WGS84 / EPSG:4326',boundarySource:'Configured rectangular pilot study area'};
/** @deprecated Use buildingPathsFor(DEFAULT_REGION_ID) instead.
 * Retained only for backward compatibility with scripts that have not yet migrated
 * to the region system. Do not add new callers. */
export const buildingPaths={raw:path.join(root,'data/buildings/raw/overture-richardson-tx.geojson'),cache:path.join(root,'data/buildings/cache/richardson-tx-buildings.json')};
// The cache file for the default region retains the legacy filename
// "richardson-tx-buildings.json" for backward compatibility.
// Do not rename it without migrating the existing cache file.
// All canonical region IDs are defined in regions.js.
export function buildingPathsFor(regionId=DEFAULT_REGION_ID){const id=regionId==='richardson-tx'?DEFAULT_REGION_ID:regionId;const legacy=id===DEFAULT_REGION_ID?'richardson-tx':id;return {raw:path.join(root,`data/buildings/raw/overture-${id}.geojson`),cache:path.join(root,`data/buildings/cache/${legacy}-buildings.json`)};}
// "richardson-tx" is accepted as a legacy alias for the default region.
// All canonical region IDs are defined in regions.js.
export function resolveRegion(id=DEFAULT_REGION_ID){try{return configuredRegion(id==='richardson-tx'?DEFAULT_REGION_ID:id);}catch{throw new Error(`Unsupported location ID or region: ${id}`);}}
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const coordinate=c=>Array.isArray(c)&&c.length>=2&&finite(c[0])&&finite(c[1])&&c[0]>=-180&&c[0]<=180&&c[1]>=-90&&c[1]<=90;
function ringValid(r){return Array.isArray(r)&&r.length>=4&&r.every(coordinate)&&r[0][0]===r.at(-1)[0]&&r[0][1]===r.at(-1)[1];}
function polygonValid(p){return Array.isArray(p)&&p.length>0&&p.every(ringValid);}
export function geometryValid(g){return g?.type==='Polygon'?polygonValid(g.coordinates):g?.type==='MultiPolygon'&&Array.isArray(g.coordinates)&&g.coordinates.length>0&&g.coordinates.every(polygonValid);}
export function validBbox(b){return Array.isArray(b)&&b.length===4&&b.every(finite)&&b[0]>=-180&&b[2]<=180&&b[1]>=-90&&b[3]<=90&&b[0]<b[2]&&b[1]<b[3];}
function bboxOf(g){const points=(g.type==='Polygon'?g.coordinates:g.coordinates.flat()).flat();return [Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];}
export function intersectsBbox(g,bbox){const [a,b,c,d]=bboxOf(g),[x,y,z,w]=bbox;return a<z&&c>x&&b<w&&d>y;}
export function intersectsPilot(g,pilot=RICHARDSON_PILOT){return intersectsBbox(g,pilot.bbox);}
function pointInRing([x,y],ring){let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [xi,yi]=ring[i],[xj,yj]=ring[j];if((yi>y)!==(yj>y)&&x<((xj-xi)*(y-yi))/(yj-yi)+xi)hit=!hit;}return hit;}
export function representativePoint(g){const ring=g.type==='Polygon'?g.coordinates[0]:g.coordinates[0][0],[a,b,c,d]=bboxOf(g),candidate=[Number(((a+c)/2).toFixed(7)),Number(((b+d)/2).toFixed(7))];return pointInRing(candidate,ring)?candidate:ring[0];}
function sourceMetadata(metadata={}){return {provider:'Overture Maps',dataset:'buildings/building',datasetRelease:metadata.datasetRelease??null,acquiredAt:metadata.acquiredAt??null};}
export function coverageFromRegion(region){return {locationId:region.id,coverageLabel:region.name,bbox:region.bbox,crs:region.crs??'WGS84 / EPSG:4326',boundarySource:region.source};}
export function normalizeBuilding(feature,{source=sourceMetadata(),bbox}={}){if(!feature?.properties?.id)throw new Error('Missing provider source ID');if(!geometryValid(feature.geometry))throw new Error('Invalid Polygon or MultiPolygon geometry');const bound=bbox??RICHARDSON_PILOT.bbox;if(!intersectsBbox(feature.geometry,bound))throw new Error('Geometry does not intersect pilot boundary');const p=feature.properties,properties={name:p.names?.primary??p.name,buildingClass:p.class,heightMeters:finite(p.height)?p.height:undefined,floors:finite(p.num_floors)?p.num_floors:undefined};const missingFields=Object.entries(properties).filter(([,value])=>value===undefined).map(([key])=>key);return {id:`overture:${p.id}`,providerId:p.id,source:{...source,sourceId:p.id},geometry:feature.geometry,representativePoint:representativePoint(feature.geometry),properties,dataQuality:{geometryValid:true,missingFields,warnings:[]}};}
async function acquisitionMetadata(rawPath){const metadataPath=rawPath.replace(/\.geojson$/,'.metadata.json');try{return JSON.parse(await readFile(metadataPath,'utf8'));}catch(error){if(error.code==='ENOENT')return {};throw new Error(`Invalid acquisition metadata: ${error.message}`);}}
export async function normalizeRaw({rawPath,regionId,pilot=RICHARDSON_PILOT}={}){const resolved=regionId?resolveRegion(regionId):null;const coverage=resolved?coverageFromRegion(resolved):pilot;const sourcePath=rawPath??buildingPathsFor(resolved?.id??DEFAULT_REGION_ID).raw;const input=JSON.parse(await readFile(sourcePath,'utf8'));if(input.type!=='FeatureCollection'||!Array.isArray(input.features))throw new Error('Raw source is not a GeoJSON FeatureCollection');const metadata=await acquisitionMetadata(sourcePath),source=sourceMetadata(metadata),seen=new Set(),features=[],rejected=[];for(const feature of input.features){try{const normalized=normalizeBuilding(feature,{source,bbox:coverage.bbox});if(seen.has(normalized.providerId))throw new Error('Duplicate provider source ID');seen.add(normalized.providerId);features.push(normalized);}catch(error){rejected.push({sourceId:feature?.properties?.id??null,reason:error.message});}}return {schemaVersion:BUILDING_SCHEMA_VERSION,locationId:coverage.locationId,coverage,source:{...source,rawPath:path.relative(root,sourcePath),status:'validated_snapshot'},rawRecordCount:input.features.length,acceptedRecordCount:features.length,rejectedRecordCount:rejected.length,featureCount:features.length,rejectedCount:rejected.length,rejected,features};}
function snapshotValid(snapshot){return snapshot?.schemaVersion===BUILDING_SCHEMA_VERSION&&Array.isArray(snapshot.features)&&snapshot.features.every(feature=>feature?.providerId&&geometryValid(feature.geometry));}
export async function writeSnapshot(snapshot,cachePath=buildingPathsFor(DEFAULT_REGION_ID).cache){if(!snapshotValid(snapshot))throw new Error('Refusing to write an invalid building snapshot');await mkdir(path.dirname(cachePath),{recursive:true});const temporary=`${cachePath}.tmp`;await writeFile(temporary,JSON.stringify(snapshot));await rename(temporary,cachePath);return snapshot;}
export async function loadSnapshot(cachePath=buildingPathsFor(DEFAULT_REGION_ID).cache){try{await access(cachePath);const snapshot=JSON.parse(await readFile(cachePath,'utf8'));if(!snapshotValid(snapshot))throw new Error('Invalid or corrupted building cache');return {...snapshot,source:{...snapshot.source,status:'cached'}};}catch(error){throw new Error(`No valid Overture building cache is available (${error.code??error.message}). Run data:buildings:fetch, then data:buildings:validate; synthetic footprint fallback is disabled.`);}}
export async function buildCache(options={}){const snapshot=await normalizeRaw(options);return writeSnapshot(snapshot,options.cachePath??buildingPathsFor(options.regionId??DEFAULT_REGION_ID).cache);}
function parseBbox(value){if(value===undefined||value===null||value==='')return null;const bbox=Array.isArray(value)?value:value.split(',').map(Number);if(!validBbox(bbox))throw new Error('Invalid bbox; expected west,south,east,north WGS84 coordinates');return bbox;}
// Accepts locationId only. "richardson-tx" maps to the default region via resolveRegion().
// Do not pass regionId separately; that parameter has been removed to prevent conflicting inputs.
export async function buildingResponse({locationId,offset=0,limit=100,geojson=false,bbox,cachePath}={}){
  const candidates=locationId?[locationId]:[VISUALIZATION_REGION_ID,DEFAULT_REGION_ID];
  let region,snapshot,lastError;
  for(const id of candidates){
    try{
      region=resolveRegion(id);
      snapshot=await loadSnapshot(cachePath??buildingPathsFor(region.id).cache);
      lastError=null;
      break;
    }catch(error){
      lastError=error;
      if(cachePath)break;
    }
  }
  if(!snapshot)throw lastError??new Error('No valid Overture building cache is available');
  const filter=parseBbox(bbox);offset=Math.max(0,Number(offset)||0);limit=Math.min(Math.max(1,Number(limit)||100),2000);const available=filter?snapshot.features.filter(feature=>intersectsBbox(feature.geometry,filter)):snapshot.features,selected=available.slice(offset,offset+limit),metadata={locationId:region.id,coverage:snapshot.coverage,source:snapshot.source,schemaVersion:snapshot.schemaVersion,totalCount:available.length,offset,limit,cacheStatus:'valid'};return geojson?{type:'FeatureCollection',features:selected.map(feature=>({type:'Feature',id:feature.id,geometry:feature.geometry,properties:{id:feature.id,providerId:feature.providerId,...feature.properties,source:feature.source,dataQuality:feature.dataQuality,representativePoint:feature.representativePoint,realProviderBacked:true}})),metadata}:{...metadata,features:selected,warnings:snapshot.rejectedRecordCount?[`${snapshot.rejectedRecordCount} raw records rejected during validation.`]:[]};
}
