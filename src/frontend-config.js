import { region, VISUALIZATION_REGION_ID } from './regions.js';
export function dragonflyDestination(value){
  if(!value)return null;
  if(value.startsWith('/')&&!value.startsWith('//')&&!/[\\\s]/.test(value))return value;
  try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}
}
export function frontendConfig(){return {regions:[region(VISUALIZATION_REGION_ID)],dragonflyUrl:dragonflyDestination(process.env.DRAGONFLY_URL)||'/dragonfly/',coverage:'North-central Richardson rectangle in Dallas County; Dallas city, Dallas County and DFW are not fully loaded.'};}
