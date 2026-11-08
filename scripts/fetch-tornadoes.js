import { mkdir, writeFile, rename } from 'node:fs/promises';
import { NOAA_DAT, TORNADO_CACHE, normalizeTornadoCollection } from '../src/hazards/tornado.js';
import { region, VISUALIZATION_REGION_ID } from '../src/regions.js';
const query=new URLSearchParams({f:'geojson',where:"stormdate >= TIMESTAMP '2019-10-20 00:00:00' AND stormdate < TIMESTAMP '2019-10-22 00:00:00'",geometry:region(VISUALIZATION_REGION_ID).bbox.join(','),geometryType:'esriGeometryEnvelope',inSR:'4326',spatialRel:'esriSpatialRelIntersects',outFields:'*',outSR:'4326',resultRecordCount:'10'});
const url=`${NOAA_DAT}/query?${query}`;
const response=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error(`NOAA HTTP ${response.status}`);
const reader=response.body.getReader();let bytes=0,chunks=[];while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>2_000_000){await reader.cancel();throw new Error('NOAA bounded response exceeded 2 MB');}chunks.push(value);}
const collection=JSON.parse(Buffer.concat(chunks).toString());collection.metadata={provider:'NOAA/NWS DAT',sourceUrl:url,acquiredAt:new Date().toISOString(),regionId:VISUALIZATION_REGION_ID,queryLimit:10,coverage:'Only intersecting survey contours for October 20–21, 2019; not a complete tornado archive'};
const events=normalizeTornadoCollection(collection);await mkdir(new URL('../data/hazards/',import.meta.url),{recursive:true});const tmp=new URL(TORNADO_CACHE.href+'.tmp');await writeFile(tmp,JSON.stringify(collection,null,2)+'\n');await rename(tmp,TORNADO_CACHE);console.log(JSON.stringify({imported:events.length,events:events.map(e=>({id:e.id,date:e.eventDate,contour:e.reportedContourRating})),bytes}));
