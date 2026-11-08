'use strict';
// =====================================================================
// core.js: helpers, config, renderer/scene, toon helpers, shared game state
// Classic scripts (no modules) so the game also runs by double-clicking index.html.
// =====================================================================
const $=id=>document.getElementById(id),V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),wrap=a=>Math.atan2(Math.sin(a),Math.cos(a)),ease=u=>u*u*(3-2*u),lerp=(a,b,k)=>a+(b-a)*k;
const URLQ=new URLSearchParams(location.search);
// Test hook: ?rseed=N makes Math.random repeatable so autopilot runs can be compared.
if(URLQ.get('rseed')){let s=+URLQ.get('rseed')||1;Math.random=()=>{s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const store={get(k,d){try{return localStorage.getItem(k)||d}catch(e){return d}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}}};

// Houston local time, done properly with the IANA zone (handles CST/CDT, no fixed UTC-6)
function houstonTime(d=new Date()){const p=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'numeric',weekday:'short',hour12:false}).formatToParts(d);
  const g=k=>(p.find(x=>x.type===k)||{}).value;const h=(+g('hour'))%24,m=+g('minute'),wd=g('weekday');return{h,m,hf:h+m/60,wd,weekend:wd==='Sat'||wd==='Sun',label:new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',weekday:'short',hour:'numeric',minute:'2-digit'}).format(d)}}

// local meters <-> lat/lng around downtown Houston (equirectangular, fine at a few km). x east, z south (north = -z).
const ORIGIN={lat:29.7604,lng:-95.3698},M_LAT=110540,M_LNG=111320*Math.cos(ORIGIN.lat*Math.PI/180);
const toLatLng=(x,z)=>({lat:ORIGIN.lat-z/M_LAT,lng:ORIGIN.lng+x/M_LNG});

// =====================================================================
// config: every tuning number lives here, with what it means
// =====================================================================
const CFG={
  S:56,G:13,road:14,     // procedural city: block every 56 m, blocks -13..13 each way (27 x 27, ~1.5 km), street width m
  river:{z:210,amp:70,len:230,half:26}, // procedural bayou: center z = z + amp*sin(x/len), half width m (invented, not real Houston)
  air:{cruise:46,fast:52,slow:14,max:120,ceiling:360,coupling:{tornado:1,hurricane:.5,flood:.6,wildfire:.7,earthquake:1,none:1}},
  truck:{cruise:32,max:40,boost:48,accel:14,brake:18,lane:3.5,avg:21,corner:6,nitro:16,nitroT:2.5,nitroCd:5}, // avg: average road speed the planner assumes incl. corners, m/s. corner: speed through turns. nitro: +m/s for nitroT s, cooldown nitroCd s
  plan:{tau:60,service:4,near:110,nearRoad:160,life:150,maxOpen:9,spawnEvery:18},
  // tau: value of reaching people decays as exp(-t/tau). service: s per stop. near: "right next to you" radius (air, m),
  // nearRoad: same for the truck (road meters). life: reports expire after this many s. All modeled assumptions.
  learn:{perMiss:.18,perReach:.04,speed:.3,board:.4,approach:40,age:1.5},
  // Adaptive urgency (rule-based, NOT machine learning). Each miss adds perMiss (scaled by people missed), each reach removes perReach.
  // At full urgency: +30% cruise speed, 40% faster boarding, approach starts 40 m earlier, older reports weighted up to 2.5x.
  safety:{lookahead:8,margin:60},     // planner forecasts the hazard this many s past arrival+service; extra clearance m
  tornado:{pull:150,danger:170,avoid:230,block:150,speed:30},
  // hurricane, game-scaled: real eyewalls are tens of km wide, here the radius of max wind is 900 m so you can see the storm structure.
  hurricane:{vmax:42,rmax:900,eye0:[-2600,-1400],eyeSpeed:4,riseTime:240,maxLevel:2.6,lit:.12},
  flood:{riseTime:300,maxLevel:4.6,rain:1},       // flash flood: water climbs the (modeled) terrain from the bayou up to maxLevel m
  wildfire:{cell:40,baseSpread:.02,wind:13},      // fire spread probability per s per neighbor (scaled by fuel and wind)
  earthquake:{t0:4,collapse:.05,damage:.16,after:[40,75],tau:40}, // collapse/damage fractions, aftershock gap s, faster survival decay
  roadDepth:.3,                                    // water deeper than this (m) closes a road for the truck
};

// =====================================================================
// renderer, scene, sky, lights
// =====================================================================
const R=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});R.setSize(innerWidth,innerHeight);document.body.prepend(R.domElement);
const SC=new THREE.Scene();
const C=new THREE.PerspectiveCamera(62,innerWidth/innerHeight,.5,6000);
const skyU={top:{value:new THREE.Color(0x1b2c33)},bot:{value:new THREE.Color(0x3d545b)},flash:{value:0}};
const sky=new THREE.Mesh(new THREE.SphereGeometry(4500,24,12),new THREE.ShaderMaterial({uniforms:skyU,side:THREE.BackSide,depthWrite:false,fog:false,
  vertexShader:'varying vec3 vP;void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader:'uniform vec3 top,bot;uniform float flash;varying vec3 vP;void main(){float h=clamp(normalize(vP).y*1.7+.08,0.,1.);vec3 c=mix(bot,top,h);c+=flash*vec3(.5,.58,.72)*(1.-h*.5);gl_FragColor=vec4(c,1.);}'}));
sky.renderOrder=-1;SC.add(sky);
SC.fog=new THREE.Fog(0x3d545b,160,1600);
const hemi=new THREE.HemisphereLight(0xb7d4d8,0x1d2a27,1.1);SC.add(hemi);
const sun=new THREE.DirectionalLight(0xffc98a,1.3);sun.position.set(-300,260,150);SC.add(sun);
const ground=new THREE.Mesh(new THREE.PlaneGeometry(12000,12000),new THREE.MeshLambertMaterial({color:0x2a3631}));ground.rotation.x=-Math.PI/2;SC.add(ground);

// =====================================================================
// toon helpers (cel shading + ink outlines)
// =====================================================================
const gradTex=new THREE.DataTexture(new Uint8Array([72,150,212]),3,1,THREE.LuminanceFormat);gradTex.minFilter=gradTex.magFilter=THREE.NearestFilter;gradTex.needsUpdate=true;
const toonCache={},toon=c=>toonCache[c]||(toonCache[c]=new THREE.MeshToonMaterial({color:c,gradientMap:gradTex}));
// ink outline: back faces pushed out along the normal, drawn dark (inverted hull)
const inkCache={};function inkMat(w){if(inkCache[w])return inkCache[w];const m=new THREE.MeshBasicMaterial({color:0x14181a,side:THREE.BackSide});
  m.onBeforeCompile=sh=>{sh.vertexShader=sh.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed+=normalize(normal)*'+w.toFixed(3)+';')};m.customProgramCacheKey=()=>'ink'+w;return inkCache[w]=m}
function part(geo,mat,parent,pos,rot,scl,ink){const m=new THREE.Mesh(geo,typeof mat==='number'?toon(mat):mat);if(pos)m.position.set(...pos);if(rot)m.rotation.set(...rot);if(scl)m.scale.set(...scl);
  if(ink)m.add(new THREE.Mesh(geo,inkMat(ink)));parent.add(m);return m}
function limb(parent,a,b,r,c,ink){const A=V(...a),Bv=V(...b),d=Bv.clone().sub(A),m=part(new THREE.CylinderGeometry(r,r,d.length(),8),c,parent,null,null,null,ink);
  m.position.copy(A).add(Bv).multiplyScalar(.5);m.quaternion.setFromUnitVectors(V(0,1,0),d.normalize());return m}
function canvasTex(w,h,draw){const cv=document.createElement('canvas');cv.width=w;cv.height=h;draw(cv.getContext('2d'),w,h);const t=new THREE.CanvasTexture(cv);t.anisotropy=4;return t}
const COL={mint:0x8fdcb4,teal:0x2c6f7a,red:0xe0362c,redD:0xb3241d,orange:0xff8a1f,silver:0xbfc8c8,iris:0x1f74a0,pupil:0x0b1820,gold:0xf2b630,white:0xe8eeee,grey:0x9aa4a6,dark:0x22282a,glass:0x4f97b8,yellow:0xffc83a};

// =====================================================================
// shared game state
// =====================================================================
const set={app:'scenario',disaster:store.get('df.disaster','tornado'),mode:store.get('df.mode','air'),quality:store.get('df.quality','medium')};
['disaster','mode','quality'].forEach(k=>{if(URLQ.get(k))set[k]=URLQ.get(k)});
let mode=set.mode,disaster=set.disaster,app='scenario',go=false,paused=true,auto=false,t=0,simT=0,timeScale=1,slowT=0;
const P=V(0,90,560),vel=V(0,0,-30);let yaw=0,pitch=0,spd=30,roll=0,fov=62,bat=100,tbat=100,nitroT=0,nitroCd=0,dashCd=0,sw=null,swL=0,shake=0,msgT=0,hitCd=0,warnCd=0,style=0;
const K={},M={x:0,y:0};
const stats={saved:0,missed:0,crashes:0,carHits:0,guards:0,stuck:0,dodges:0,unsafeSkips:0};
const learn={urg:0};
const live={on:false,server:false,google:false,alerts:[],obs:null,quakes:[],sample:null,note:''}; // live Houston data state
function say(s){$('msg').textContent=s;$('msg').style.opacity=1;msgT=1.3}
const fwd=()=>V(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch));
const cruiseAir=()=>CFG.air.cruise*(1+CFG.learn.speed*learn.urg),cruiseTruck=()=>CFG.truck.cruise*(1+CFG.learn.speed*.8*learn.urg);
