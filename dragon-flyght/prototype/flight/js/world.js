'use strict';
// =====================================================================
// world.js: the city. Two sources, same data format:
//   procedural: invented Houston-flavored grid (used by the published link and when no local server is running)
//   houston:    real downtown Houston from OpenStreetMap (served and cached by serve.py)
// Data format: {extent, buildings:[{poly:[[x,z]..],h,lv,t,n}], roads:[{pts:[[x,z]..],w,k,b}], water:[{pts,half}], parks:[{poly}]}
// Coordinates are local meters: x east, z south (north = -z), origin downtown Houston.
// =====================================================================
const B=[],PARKS=[],TREES=[],NODES=[],EDGES=[],RIVER=[];let E=760,WSRC='procedural',worldReady=false;const HOME={x:0,z:0}; // HOME: where the unit starts and hazards happen (big cities are much larger than the play area)
const spawnPt=()=>({x:HOME.x,z:HOME.z+Math.min(E*.7,1000)});

// ---------- spatial hashes (buildings and road edges), 64 m cells ----------
const HS=64,BH=new Map(),EH=new Map(),hk=(i,j)=>i*100003+j;let hstamp=0;
function hashBox(map,x0,z0,x1,z1,item){for(let i=Math.floor(x0/HS);i<=Math.floor(x1/HS);i++)for(let j=Math.floor(z0/HS);j<=Math.floor(z1/HS);j++){const k=hk(i,j);let a=map.get(k);if(!a)map.set(k,a=[]);a.push(item)}}
// run fn(b) on buildings near (x,z) (safe for margins up to ~60 m). Return true from fn to stop early.
function forNear(x,z,fn){hstamp++;const gi=Math.floor(x/HS),gj=Math.floor(z/HS);for(let i=gi-1;i<=gi+1;i++)for(let j=gj-1;j<=gj+1;j++){const a=BH.get(hk(i,j));if(!a)continue;for(const b of a){if(b._s===hstamp)continue;b._s=hstamp;if(fn(b))return true}}return false}
function nearestEdge(x,z){let be=-1,bd=1e18;for(let r=1;r<=4&&be<0;r++){const gi=Math.floor(x/HS),gj=Math.floor(z/HS);for(let i=gi-r;i<=gi+r;i++)for(let j=gj-r;j<=gj+r;j++){const a=EH.get(hk(i,j));if(!a)continue;
  for(const ei of a){const e=EDGES[ei];if(e.dead)continue;const A=NODES[e.a],Bn=NODES[e.b],dx=Bn.x-A.x,dz=Bn.z-A.z,l2=dx*dx+dz*dz||1,u=clamp(((x-A.x)*dx+(z-A.z)*dz)/l2,0,1),d=(A.x+dx*u-x)**2+(A.z+dz*u-z)**2;if(d<bd){bd=d;be=ei}}}}
  if(be<0){for(let i=0;i<EDGES.length;i++){const e=EDGES[i];if(e.dead)continue;const d=(e.mx-x)**2+(e.mz-z)**2;if(d<bd){bd=d;be=i}}}return be}
const edgeDist=(ei,x,z)=>{const e=EDGES[ei],A=NODES[e.a],Bn=NODES[e.b],dx=Bn.x-A.x,dz=Bn.z-A.z,l2=dx*dx+dz*dz||1,u=clamp(((x-A.x)*dx+(z-A.z)*dz)/l2,0,1);return Math.hypot(A.x+dx*u-x,A.z+dz*u-z)};

// ---------- polygon helpers ----------
function pip(poly,x,z){let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])c=!c}return c}
// closest point on the footprint edge: distance d (0 if inside), outward normal (nx,nz), inside flag
function bClosest(b,x,z){const p=b.poly;let bd=1e18,cx=0,cz=0;for(let i=0,j=p.length-1;i<p.length;j=i++){const ax=p[j][0],az=p[j][1],dx=p[i][0]-ax,dz=p[i][1]-az,l2=dx*dx+dz*dz||1,u=clamp(((x-ax)*dx+(z-az)*dz)/l2,0,1),qx=ax+dx*u,qz=az+dz*u,d=(qx-x)**2+(qz-z)**2;if(d<bd){bd=d;cx=qx;cz=qz}}
  const inside=pip(p,x,z),dist=Math.sqrt(bd)||1e-6;let nx=(x-cx)/dist,nz=(z-cz)/dist;if(inside){nx=-nx;nz=-nz}return{d:inside?0:dist,dist,inside,nx,nz,cx,cz}}
// fast horizontal distance to a building (0 inside), with a bounding-box early out
function bDist(b,x,z,m=60){if(x<b.x0-m||x>b.x1+m||z<b.z0-m||z>b.z1+m)return 1e9;return bClosest(b,x,z).d}
const bH=b=>b.h*b.hs; // current height (earthquake collapse lowers hs)
function polyArea(p){let a=0;for(let i=0,j=p.length-1;i<p.length;j=i++)a+=(p[j][0]+p[i][0])*(p[j][1]-p[i][1]);return Math.abs(a/2)}
// a point well inside the footprint for the landing pad (centroid if inside, else best of a small grid)
function padPoint(b){if(b.pad)return b.pad;let cx=0,cz=0;for(const q of b.poly){cx+=q[0];cz+=q[1]}cx/=b.poly.length;cz/=b.poly.length;
  if(pip(b.poly,cx,cz)&&bClosest(b,cx,cz).dist>3)return b.pad=[cx,cz];let best=[b.x,b.z],bv=-1;
  for(let i=1;i<8;i++)for(let j=1;j<8;j++){const x=b.x0+(b.x1-b.x0)*i/8,z=b.z0+(b.z1-b.z0)*j/8;if(!pip(b.poly,x,z))continue;const d=bClosest(b,x,z).dist;if(d>bv){bv=d;best=[x,z]}}return b.pad=best}

// ---------- river distance + modeled terrain elevation (drives all flooding) ----------
let RES=8,GX0=0,GZ0=0,GW=0,GHh=0,RD=null,EL=null;
function riverDistRaw(x,z){let bd=1e9;for(const r of RIVER){const p=r.pts;for(let i=1;i<p.length;i++){const ax=p[i-1][0],az=p[i-1][1],dx=p[i][0]-ax,dz=p[i][1]-az,l2=dx*dx+dz*dz||1,u=clamp(((x-ax)*dx+(z-az)*dz)/l2,0,1),d=Math.hypot(ax+dx*u-x,az+dz*u-z)-r.half;if(d<bd)bd=d}}return bd}
// Modeled elevation above the bayou (meters): rises ~1.1 m per 100 m away from the water plus gentle bumps.
// This is an invented terrain for gameplay, not real LiDAR. Real mode should swap in USGS 3DEP elevation later.
const elevFn=(x,z,rd)=>rd<0?0:Math.max(.25,.6+Math.min(rd*.011,9)+1.1*Math.sin(x*.0061+1.3)*Math.sin(z*.0053+.4)+.7*Math.sin(x*.013-z*.009));
// Water mask on a grid (cells RES m): river ribbons, lake/riverbank polygons (even-odd scanline), and sea from coastline chains.
// A coastline way has water on its right (OSM rule). Cells along the line become barriers, seeds are dropped one step to the right
// of the line, and a 4-connected flood fill from the seeds (blocked by barriers) marks the sea. Then a distance transform gives every
// land cell its distance to the nearest water, which drives the modeled terrain (and so the flooding).
function buildFields(coast=[],lakes=[]){RES=Math.max(8,Math.ceil((2*E+400)/900));GX0=-E-200;GZ0=-E-200;GW=Math.ceil((2*E+400)/RES);GHh=GW;const n=GW*GHh;
  const wat=new Uint8Array(n),bar=new Uint8Array(n),ci=x=>Math.floor((x-GX0)/RES),cj=z=>Math.floor((z-GZ0)/RES);
  const segCells=(a,b,rad,fn)=>{const x0=Math.max(0,ci(Math.min(a[0],b[0])-rad)),x1=Math.min(GW-1,ci(Math.max(a[0],b[0])+rad)),z0=Math.max(0,cj(Math.min(a[1],b[1])-rad)),z1=Math.min(GHh-1,cj(Math.max(a[1],b[1])+rad)),dx=b[0]-a[0],dz=b[1]-a[1],l2=dx*dx+dz*dz||1;
    for(let j=z0;j<=z1;j++)for(let i=x0;i<=x1;i++){const x=GX0+(i+.5)*RES,z=GZ0+(j+.5)*RES,u=clamp(((x-a[0])*dx+(z-a[1])*dz)/l2,0,1);if(Math.hypot(a[0]+dx*u-x,a[1]+dz*u-z)<=rad)fn(i,j)}};
  for(const r of RIVER){const p=r.pts,rad=Math.max(r.half,RES*.6);for(let k=1;k<p.length;k++)segCells(p[k-1],p[k],rad,(i,j)=>{wat[j*GW+i]=1})}
  for(const L of lakes){let z0=1e9,z1=-1e9;for(const ring of L.rings)for(const q of ring){z0=Math.min(z0,q[1]);z1=Math.max(z1,q[1])}
    for(let j=Math.max(0,cj(z0));j<=Math.min(GHh-1,cj(z1));j++){const z=GZ0+(j+.5)*RES,xs=[];
      for(const ring of L.rings)for(let k=0,m=ring.length-1;k<ring.length;m=k++){const a=ring[m],b=ring[k];if((a[1]>z)!==(b[1]>z))xs.push(a[0]+(z-a[1])*(b[0]-a[0])/(b[1]-a[1]))}
      xs.sort((p,q)=>p-q);for(let s=0;s+1<xs.length;s+=2){const i0=Math.max(0,Math.ceil((xs[s]-GX0)/RES-.5)),i1=Math.min(GW-1,Math.floor((xs[s+1]-GX0)/RES-.5));for(let i=i0;i<=i1;i++)wat[j*GW+i]=1}}}
  if(coast.length){const seeds=[];
    // a coastline way that stops near the edge of the map would let the sea flow around its end: extend such ends straight out past the edge
    const nearEdge=q=>Math.abs(q[0])>E-250||Math.abs(q[1])>E-250,ext=(a,b)=>{const dx=a[0]-b[0],dz=a[1]-b[1],l=Math.hypot(dx,dz)||1;return[a[0]+dx/l*E*2.5,a[1]+dz/l*E*2.5]};
    for(const c of coast){const p=c.pts;if(p.length>1){if(nearEdge(p[p.length-1]))p.push(ext(p[p.length-1],p[p.length-2]));if(nearEdge(p[0]))p.unshift(ext(p[0],p[1]))}}
    for(const c of coast){const p=c.pts;for(let k=1;k<p.length;k++){const ax=p[k-1][0],az=p[k-1][1],dx=p[k][0]-ax,dz=p[k][1]-az,L=Math.hypot(dx,dz);if(L<1e-6)continue;
      const steps=Math.max(1,Math.ceil(L/(RES*.5))),nx=-dz/L,nz=dx/L;
      for(let s=0;s<=steps;s++){const x=ax+dx*s/steps,z=az+dz*s/steps,i=ci(x),j=cj(z);if(i>=0&&j>=0&&i<GW&&j<GHh)bar[j*GW+i]=1;seeds.push(x+nx*RES*1.7,z+nz*RES*1.7)}}}
    const q=new Int32Array(n);let qh=0,qt=0;for(let s=0;s<seeds.length;s+=2){const i=ci(seeds[s]),j=cj(seeds[s+1]);if(i<0||j<0||i>=GW||j>=GHh)continue;const k=j*GW+i;if(!bar[k]&&!wat[k]){wat[k]=1;q[qt++]=k}}
    while(qh<qt){const k=q[qh++],i=k%GW,j=(k/GW)|0;if(i>0&&!wat[k-1]&&!bar[k-1]){wat[k-1]=1;q[qt++]=k-1}if(i<GW-1&&!wat[k+1]&&!bar[k+1]){wat[k+1]=1;q[qt++]=k+1}
      if(j>0&&!wat[k-GW]&&!bar[k-GW]){wat[k-GW]=1;q[qt++]=k-GW}if(j<GHh-1&&!wat[k+GW]&&!bar[k+GW]){wat[k+GW]=1;q[qt++]=k+GW}}}
  // distance (m) from each land cell to the nearest water cell: two-pass chamfer
  RD=new Float32Array(n);EL=new Float32Array(n);let any=false;const INF=1e9,D=new Float32Array(n);for(let k=0;k<n;k++){if(wat[k]){D[k]=0;any=true}else D[k]=INF}
  if(any){for(let j=0;j<GHh;j++)for(let i=0;i<GW;i++){const k=j*GW+i;let d=D[k];if(i>0)d=Math.min(d,D[k-1]+1);if(j>0){d=Math.min(d,D[k-GW]+1);if(i>0)d=Math.min(d,D[k-GW-1]+1.414);if(i<GW-1)d=Math.min(d,D[k-GW+1]+1.414)}D[k]=d}
    for(let j=GHh-1;j>=0;j--)for(let i=GW-1;i>=0;i--){const k=j*GW+i;let d=D[k];if(i<GW-1)d=Math.min(d,D[k+1]+1);if(j<GHh-1){d=Math.min(d,D[k+GW]+1);if(i<GW-1)d=Math.min(d,D[k+GW+1]+1.414);if(i>0)d=Math.min(d,D[k+GW-1]+1.414)}D[k]=d}}
  for(let j=0;j<GHh;j++)for(let i=0;i<GW;i++){const k=j*GW+i,x=GX0+i*RES,z=GZ0+j*RES,rd=wat[k]?-1:any?Math.max(.1,D[k]*RES-RES*.5):1e4;RD[k]=rd;EL[k]=elevFn(x,z,rd)}}
const fIdx=(x,z)=>{const i=clamp(Math.round((x-GX0)/RES),0,GW-1),j=clamp(Math.round((z-GZ0)/RES),0,GHh-1);return j*GW+i};
const riverDist=(x,z)=>RD?RD[fIdx(x,z)]:1e4,elevAt=(x,z)=>EL?EL[fIdx(x,z)]:5;
let waterLevel=0; // current flood level in meters above the bayou (set by hurricane / flood)
const floodDepth=(x,z)=>{const rd=riverDist(x,z);if(rd<0)return 3;return Math.max(0,waterLevel-elevAt(x,z))};

// ---------- occupancy model (real Houston mode) ----------
// People in a building right now = floor area / (m2 per person at full occupancy) x time-of-day fraction for its use.
// m2/person values are typical planning densities (assumptions, documented here), not measurements.
const OCC={office:{a:18,c:'work'},commercial:{a:22,c:'work'},government:{a:20,c:'work'},civic:{a:25,c:'work'},industrial:{a:60,c:'work'},warehouse:{a:120,c:'work'},
  retail:{a:28,c:'shop'},supermarket:{a:30,c:'shop'},residential:{a:45,c:'home'},apartments:{a:42,c:'home'},house:{a:60,c:'home'},dormitory:{a:25,c:'home'},
  hotel:{a:38,c:'hotel'},hospital:{a:22,c:'hospital'},school:{a:9,c:'school'},university:{a:14,c:'school'},college:{a:14,c:'school'},church:{a:6,c:'church'},
  stadium:{a:2.5,c:'event'},arena:{a:2.5,c:'event'},parking:{a:500,c:'work'},garage:{a:500,c:'work'},transportation:{a:30,c:'work'},default:{a:35,c:'mixed'}};
// fraction of full occupancy by hour (0-23) for weekday / weekend. Shapes follow common daily activity patterns (assumption).
function occFrac(c,h,we){const day=h>=8&&h<18,eve=h>=18&&h<23,night=h<6||h>=23;
  switch(c){case 'work':return we?(day?.12:.03):(h>=9&&h<16?.82:h>=7&&h<9?.45:h>=16&&h<19?.35:.04);
    case 'shop':return h>=10&&h<20?(we?.6:.45):.02;case 'home':return night?.95:day?(we?.7:.4):.85;case 'hotel':return night?.85:.5;
    case 'hospital':return day?.9:.75;case 'school':return we?.03:(h>=8&&h<15?.9:.05);case 'church':return we&&h>=9&&h<13?.7:.03;
    case 'event':return eve?.25:.02;default:return day?.55:eve?.4:.3}}
function estPeople(b,tm){const o=OCC[b.t]||OCC.default,fl=b.lv||Math.max(1,Math.round(b.h/3.6));return Math.round(b.area*fl/o.a*occFrac(o.c,tm.h,tm.weekend))}
let popTotal=0,popLabel='';
function updatePopulation(){if(WSRC==='houston'){const tm=houstonTime();popTotal=0;for(const b of B){b.pop=estPeople(b,tm);popTotal+=b.pop}
    popLabel='Downtown '+CITY.name+' est. '+popTotal.toLocaleString()+' people now ('+tm.label+', modeled)'}
  else{popTotal=CITY.pop;popLabel=CITY.name+' '+CITY.pop.toLocaleString()+' people over '+B.length+' districts (modeled)'}}
// Procedural mode: Houston city 2020 Census (2,304,580) spread over buildings by volume. Each box stands in for a district.
let POPMAX=1;

// ---------- procedural data (invented layout) ----------
function proceduralData(){const S=CFG.S,G=CFG.G,ext=(G+.5)*S,rz=x=>CFG.river.z+CFG.river.amp*Math.sin(x/CFG.river.len),rdist=(x,z)=>Math.abs(z-rz(x))-CFG.river.half;
  let seed=7;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;const out={extent:ext,buildings:[],roads:[],water:[],parks:[]};
  for(let gx=-G;gx<=G;gx++)for(let gz=-G;gz<=G;gz++){const cx=gx*S,cz=gz*S,r1=rnd(),r2=rnd(),r3=rnd(),r4=rnd(),r5=rnd(),r6=rnd(),j1=rnd(),j2=rnd();
    if(rdist(cx,cz)<22)continue;const hp=(S-CFG.road)/2;
    if(r1<.06||Math.hypot(cx,cz-560)<40){out.parks.push({poly:[[cx-hp,cz-hp],[cx+hp,cz-hp],[cx+hp,cz+hp],[cx-hp,cz+hp]]});continue}
    const d=Math.hypot(cx,cz),down=Math.exp(-((d/300)**2)),hx=9+r2*8.5,hz=9+r3*8.5,h=Math.round(10+r4*r4*36+down*(30+Math.pow(r5,1.6)*200)),x=cx+(j1-.5)*4,z=cz+(j2-.5)*4;
    out.buildings.push({poly:[[x-hx,z-hz],[x+hx,z-hz],[x+hx,z+hz],[x-hx,z+hz]],h,t:'default',seedSide:r6})}
  const L=[];for(let i=-G-1;i<=G;i++)L.push((i+.5)*S);
  for(const z of L)for(let k=0;k<L.length-1;k++){const x0=L[k],x1=L[k+1];let wet=false;for(let s=0;s<=6;s++)if(rdist(x0+(x1-x0)*s/6,z)<4)wet=true;if(wet)continue;out.roads.push({pts:[[x0,z],[(x0+x1)/2,z],[x1,z]],w:CFG.road,k:'street'})}
  for(const x of L)for(let k=0;k<L.length-1;k++){const z0=L[k],z1=L[k+1],m=(z0+z1)/2,br=(a,b)=>riverDistQ(x,a,b,rdist);out.roads.push({pts:[[x,z0],[x,m]],w:CFG.road,k:'street',b:br(z0,m)?1:0});out.roads.push({pts:[[x,m],[x,z1]],w:CFG.road,k:'street',b:br(m,z1)?1:0})}
  const rp=[];for(let x=-ext-300;x<=ext+300;x+=20)rp.push([x,rz(x)]);out.water.push({pts:rp,half:CFG.river.half});return out}
function riverDistQ(x,a,b,rdist){for(let s=0;s<=4;s++)if(rdist(x,a+(b-a)*s/4)<4)return true;return false}

// ---------- build everything from data ----------
const bState={tex:null,data:null,w:256};let cityMesh=null,roadMesh=null,dashMesh=null,parkMesh=null,trunkM=null,crownM=null,water=null;
const winU={uLit:{value:.24},uBS:{value:null},uBSs:{value:new THREE.Vector2(256,1)}};
function setBState(i,hs,ch){const d=bState.data;d[i*4]=clamp(Math.round(hs*255),0,255);d[i*4+1]=clamp(Math.round(ch*255),0,255);bState.tex.needsUpdate=true}
const bMat=new THREE.MeshLambertMaterial({color:0xffffff,vertexColors:true});
bMat.onBeforeCompile=sh=>{Object.assign(sh.uniforms,winU);
  sh.vertexShader='attribute float aBid;uniform sampler2D uBS;uniform vec2 uBSs;varying vec3 vWP;varying vec3 vWN;varying float vChar;\n'+sh.vertexShader
   .replace('#include <begin_vertex>',`#include <begin_vertex>
  vec2 bsu=vec2((mod(aBid,uBSs.x)+.5)/uBSs.x,(floor(aBid/uBSs.x)+.5)/uBSs.y);vec4 bst=texture2D(uBS,bsu);transformed.y*=max(bst.r,.02);vChar=bst.g;`)
   .replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
  vec4 dfW=modelMatrix*vec4(transformed,1.);vWP=dfW.xyz;vWN=normalize(mat3(modelMatrix)*objectNormal);`);
  sh.fragmentShader='uniform float uLit;varying vec3 vWP;varying vec3 vWN;varying float vChar;\n'+sh.fragmentShader.replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
  float wall=1.-step(.5,abs(vWN.y));vec2 wd=normalize(vec2(-vWN.z,vWN.x)+1e-5);float u=dot(vWP.xz,wd);
  vec2 g=vec2(u/3.4,vWP.y/3.8),f=fract(g),id=floor(g);
  float win=step(.2,f.x)*step(f.x,.8)*step(.28,f.y)*step(f.y,.78)*wall*step(4.,vWP.y);
  float hs=fract(sin(dot(id+floor((vWP.xz+28.)/56.)*17.,vec2(12.9898,78.233)))*43758.5453);
  diffuseColor.rgb*=mix(1.,.5,win)*(.68+.32*clamp(vWP.y/50.,0.,1.));diffuseColor.rgb*=mix(.78,1.,wall);
  diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.07,.06,.055),vChar*.85);
  totalEmissiveRadiance+=vec3(1.,.72,.4)*step(1.-uLit,hs)*win*(.45+.35*hs)*(1.-vChar);`)};
function disposeObj(o){if(!o)return;SC.remove(o);o.traverse&&o.traverse(m=>{if(m.geometry)m.geometry.dispose()})}

function buildWorld(data,src){WSRC=src;worldReady=false;
  for(const o of [cityMesh,roadMesh,dashMesh,parkMesh,trunkM,crownM,water])disposeObj(o);
  B.length=PARKS.length=TREES.length=NODES.length=EDGES.length=RIVER.length=0;BH.clear();EH.clear();E=data.extent||760;HOME.x=HOME.z=0;if(src==='houston'&&CITY.spawn){HOME.x=(CITY.spawn[1]-ORIGIN.lng)*M_LNG;HOME.z=-(CITY.spawn[0]-ORIGIN.lat)*M_LAT}
  // buildings
  for(const d of data.buildings){const p=d.poly;if(!p||p.length<3)continue;let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;for(const q of p){x0=Math.min(x0,q[0]);x1=Math.max(x1,q[0]);z0=Math.min(z0,q[1]);z1=Math.max(z1,q[1])}
    const area=polyArea(p);if(area<12)continue;
    const b={i:B.length,poly:p,x:(x0+x1)/2,z:(z0+z1)/2,hx:(x1-x0)/2,hz:(z1-z0)/2,x0,x1,z0,z1,h:Math.max(3,d.h||10),hs:1,char:0,dmg:0,t:d.t||'default',n:d.n||'',lv:d.lv||0,area,pop:0,seedSide:d.seedSide};
    B.push(b);hashBox(BH,x0,z0,x1,z1,b)}
  // population: procedural spreads the Houston city total by volume; Houston mode uses the occupancy model
  if(src!=='houston'){let vs=0;for(const b of B)vs+=b.area*b.h;for(const b of B)b.pop=Math.round(CITY.pop*b.area*b.h/vs)}
  updatePopulation();POPMAX=1;for(const b of B)POPMAX=Math.max(POPMAX,b.pop);
  // per-building state texture (height scale, char) read by the building shader
  const rows=Math.max(1,Math.ceil(B.length/256));bState.data=new Uint8Array(256*rows*4);for(let i=0;i<B.length;i++){bState.data[i*4]=255;bState.data[i*4+2]=255}
  bState.tex=new THREE.DataTexture(bState.data,256,rows,THREE.RGBAFormat);bState.tex.needsUpdate=true;winU.uBS.value=bState.tex;winU.uBSs.value.set(256,rows);
  // merged building mesh (extruded footprints), color per building, building id per vertex
  {const pos=[],nor=[],col=[],bid=[],c=new THREE.Color();
   for(const b of B){const sh=new THREE.Shape(b.poly.map(q=>new THREE.Vector2(q[0],-q[1])));const g=new THREE.ExtrudeGeometry(sh,{depth:b.h,bevelEnabled:false});g.rotateX(-Math.PI/2);
    const gp=g.attributes.position.array,gn=g.attributes.normal.array;c.setHSL(.52+((b.i*37)%10)/120,.1,.3+Math.min(b.h,200)/700);
    for(let k=0;k<gp.length;k++){pos.push(gp[k]);nor.push(gn[k])}for(let k=0;k<gp.length/3;k++){col.push(c.r,c.g,c.b);bid.push(b.i)}g.dispose()}
   const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(nor,3));
   g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));g.setAttribute('aBid',new THREE.Float32BufferAttribute(bid,1));cityMesh=new THREE.Mesh(g,bMat);cityMesh.frustumCulled=false;SC.add(cityMesh)}
  // road graph: nodes keyed by rounded position, so OSM ways that share a node connect
  const nodeAt=new Map(),nk=(x,z)=>Math.round(x*2)+'|'+Math.round(z*2);
  const node=(x,z)=>{const k=nk(x,z);if(nodeAt.has(k))return nodeAt.get(k);const id=NODES.length;NODES.push({x,z,adj:[]});nodeAt.set(k,id);return id};
  for(const r of data.roads){const w=r.w||10;for(let i=1;i<r.pts.length;i++){const a=node(r.pts[i-1][0],r.pts[i-1][1]),b=node(r.pts[i][0],r.pts[i][1]);if(a===b)continue;
    const A=NODES[a],Bn=NODES[b],len=Math.hypot(A.x-Bn.x,A.z-Bn.z),e=EDGES.length;EDGES.push({a,b,len,mx:(A.x+Bn.x)/2,mz:(A.z+Bn.z)/2,bridge:!!r.b,w,k:r.k||'street'});
    A.adj.push([b,len,e]);Bn.adj.push([a,len,e]);hashBox(EH,Math.min(A.x,Bn.x),Math.min(A.z,Bn.z),Math.max(A.x,Bn.x),Math.max(A.z,Bn.z),e)}}
  // keep only the largest connected road network (stray OSM fragments would strand the truck)
  {const comp=new Int32Array(NODES.length).fill(-1);let best=-1,bestN=0;for(let s=0;s<NODES.length;s++){if(comp[s]>=0)continue;const st=[s];comp[s]=s;let n=0;while(st.length){const u=st.pop();n++;for(const [v] of NODES[u].adj)if(comp[v]<0){comp[v]=s;st.push(v)}}if(n>bestN){bestN=n;best=s}}
   for(let i=0;i<NODES.length;i++)if(comp[i]!==best)NODES[i].adj=[];for(const e of EDGES)e.dead=comp[e.a]!==best}
  // river + terrain fields
  for(const w of data.water)RIVER.push({pts:w.pts,half:w.half||18});buildFields(data.coast||[],data.lakes||[]);
  // entrances: nearest usable road node to each building (not a freeway), door on the facade, curb stop in the near lane
  for(const b of B){let bi=-1,bd=1e9;const pc=padPoint(b);for(let r=0;r<2;r++){forNearEdges(b.x,b.z,ei=>{const e=EDGES[ei];if(e.dead||e.k==='motorway'||e.k==='motorway_link')return;for(const ni of [e.a,e.b]){const n=NODES[ni],d=bClosest(b,n.x,n.z).d+(r?0:0);if(d<bd&&d>2){bd=d;bi=ni}}});if(bi>=0)break}
    if(bi<0||bd>90)continue;const n=NODES[bi],cl=bClosest(b,n.x,n.z),dx=cl.cx-n.x,dz=cl.cz-n.z,dl=Math.hypot(dx,dz)||1,lane=Math.min(3.5,dl*.35);
    b.curb=bi;b.door=V(cl.cx,0,cl.cz);b.stop=V(n.x+dx/dl*lane,0,n.z+dz/dl*lane);b.face=[-dx/dl,-dz/dl]}
  // render roads (instanced boxes along each edge) and lane dashes
  {const live=EDGES.filter(e=>!e.dead);roadMesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshLambertMaterial({color:0x1f2526}),live.length);
   dashMesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial({color:0x8c8462}),live.length);const m4=new THREE.Matrix4(),q=new THREE.Quaternion(),Y=V(0,1,0);
   live.forEach((e,i)=>{const A=NODES[e.a],Bn=NODES[e.b],ang=Math.atan2(Bn.x-A.x,Bn.z-A.z),y=e.bridge?.7:.03;q.setFromAxisAngle(Y,ang);
     m4.compose(V(e.mx,y,e.mz),q,V(e.w,e.bridge?1.2:.06,e.len+e.w*.5));roadMesh.setMatrixAt(i,m4);
     m4.compose(V(e.mx,y+(e.bridge?.62:.05),e.mz),q,e.len>10&&e.w>7?V(.35,.02,e.len*.45):V(0,0,0));dashMesh.setMatrixAt(i,m4)});SC.add(roadMesh,dashMesh)}
  // parks + trees
  {const pos=[];for(const pk of data.parks){if(!pk.poly||pk.poly.length<3)continue;PARKS.push(pk);const sh=new THREE.Shape(pk.poly.map(q=>new THREE.Vector2(q[0],-q[1])));const g=new THREE.ShapeGeometry(sh);g.rotateX(-Math.PI/2);
     const a=g.index?g.toNonIndexed().attributes.position.array:g.attributes.position.array;for(let k=0;k<a.length;k++)pos.push(k%3==1?.05:a[k]);g.dispose();
     let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;for(const q of pk.poly){x0=Math.min(x0,q[0]);x1=Math.max(x1,q[0]);z0=Math.min(z0,q[1]);z1=Math.max(z1,q[1])}
     const want=Math.min(14,Math.ceil(polyArea(pk.poly)/220));let tries=0,n=0;let s=PARKS.length*97;const rr=()=>(s=(s*16807+11)%2147483647)/2147483647;
     while(n<want&&tries++<want*6&&TREES.length<900){const x=x0+(x1-x0)*rr(),z=z0+(z1-z0)*rr();if(pip(pk.poly,x,z)){TREES.push({x,z,s:.8+rr()*.7,ph:rr()*6});n++}}}
   const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.computeVertexNormals();parkMesh=new THREE.Mesh(g,new THREE.MeshLambertMaterial({color:0x2c4a33,side:2}));SC.add(parkMesh);
   trunkM=new THREE.InstancedMesh(new THREE.CylinderGeometry(.35,.5,1,6).translate(0,.5,0),new THREE.MeshLambertMaterial({color:0x4a3a2c}),Math.max(1,TREES.length));
   crownM=new THREE.InstancedMesh(new THREE.ConeGeometry(3,7,7).translate(0,6.5,0),new THREE.MeshLambertMaterial({color:0x2f5a3c}),Math.max(1,TREES.length));SC.add(trunkM,crownM)}
  // water: one plane, the shader shows the bayou plus anything below the current flood level on the modeled terrain
  {const w=GW,h=GHh,d=new Uint8Array(w*h);for(let i=0;i<w*h;i++)d[i]=RD[i]<0?0:clamp(Math.round(EL[i]*20),1,255);
   const tex=new THREE.DataTexture(d,w,h,THREE.LuminanceFormat);tex.magFilter=tex.minFilter=THREE.LinearFilter;tex.needsUpdate=true;
   waterU.uEl.value=tex;waterU.uBox.value.set(GX0,GZ0,w*RES,h*RES);
   water=new THREE.Mesh(new THREE.PlaneGeometry(w*RES,h*RES,1,1),waterMat);water.rotation.x=-Math.PI/2;water.position.set(GX0+w*RES/2,.35,GZ0+h*RES/2);SC.add(water)}
  setTheme();initTraffic();worldReady=true}
// ---------- theme: 'aurora' (Alaska) = night sky with northern lights and stars, a snowy ground, and a ring of mountains that follows the camera ----------
let MTN=null;
function setTheme(){const au=CITY.theme==='aurora';skyU.aur.value=au?1:0;
  ground.material.color.setHex(au?0x7d909e:0x2a3631);hemi.color.setHex(au?0x7fa8c8:0xb7d4d8);hemi.groundColor.setHex(au?0x1b2a3a:0x1d2a27);sun.color.setHex(au?0x9fb8ff:0xffc98a);
  if(parkMesh)parkMesh.material.color.setHex(au?0xaab9c2:0x2c4a33);
  if(MTN){SC.remove(MTN);MTN.traverse(m=>{if(m.geometry)m.geometry.dispose()});MTN=null}if(!au)return;
  MTN=new THREE.Group();const N=260,smooth=(a,b,x)=>{const u=clamp((x-a)/(b-a),0,1);return u*u*(3-2*u)};
  for(const L of [{r:4000,h:1.15,seed:1.3,foot:[.2,.3,.45],snow:[.88,.94,1],mid:[.36,.46,.6]},{r:3350,h:.72,seed:4.1,foot:[.1,.16,.26],snow:[.72,.82,.92],mid:[.2,.28,.4]}]){
    const pos=[],col=[],idx=[],prof=[[-900,0,0],[-350,.7,1],[0,1,2],[800,0,0]];  // radial offset, height fraction, color slot
    for(let i=0;i<=N;i++){const a=i/N*Math.PI*2,ridge=Math.abs(Math.sin(a*5.3+L.seed))*.5+Math.abs(Math.sin(a*11.7+2*L.seed))*.3+Math.abs(Math.sin(a*27+3*L.seed))*.2,dirf=.35+.65*(.5+.5*Math.sin(a)),H=L.h*(250+950*ridge)*dirf;
      for(const [dr,hf,cs] of prof){const r=L.r+dr;pos.push(Math.sin(a)*r,-40+hf*(H+40),-Math.cos(a)*r);const c=cs==0?L.foot:cs==1?L.mid:L.snow,sn=cs==2?smooth(300,900,H):cs==1?smooth(500,1100,H)*.5:0;
        col.push(c[0]+(L.snow[0]-c[0])*sn*(cs==2?1:.6),c[1]+(L.snow[1]-c[1])*sn*(cs==2?1:.6),c[2]+(L.snow[2]-c[2])*sn*(cs==2?1:.6))}}
    for(let i=0;i<N;i++)for(let k=0;k<3;k++){const a=i*4+k,b=(i+1)*4+k;idx.push(a,b,a+1,b,b+1,a+1)}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));g.setIndex(idx);
    MTN.add(new THREE.Mesh(g,new THREE.MeshBasicMaterial({vertexColors:true,fog:false,side:THREE.DoubleSide})))}
  SC.add(MTN)}
function forNearEdges(x,z,fn){const gi=Math.floor(x/HS),gj=Math.floor(z/HS),seen=new Set();for(let i=gi-2;i<=gi+2;i++)for(let j=gj-2;j<=gj+2;j++){const a=EH.get(hk(i,j));if(!a)continue;for(const e of a){if(seen.has(e))continue;seen.add(e);fn(e)}}}
const waterU={uT:{value:0},uLevel:{value:0},uMud:{value:0},uEl:{value:null},uBox:{value:new THREE.Vector4()},uFogC:{value:SC.fog.color},uFogN:{value:160},uFogF:{value:1600}};
const waterMat=new THREE.ShaderMaterial({uniforms:waterU,transparent:true,depthWrite:false,
  vertexShader:'varying vec3 vW;void main(){vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}',
  fragmentShader:`uniform float uT,uLevel,uMud,uFogN,uFogF;uniform vec3 uFogC;uniform sampler2D uEl;uniform vec4 uBox;varying vec3 vW;
  void main(){vec2 uv=(vW.xz-uBox.xy)/uBox.zw;float e=texture2D(uEl,vec2(uv.x,1.-uv.y)).r*12.75;bool riv=e<.03;float dep=uLevel-e;if(!riv&&dep<=0.)discard;
   float n=sin(vW.x*.15+uT*1.3)*sin(vW.z*.13-uT)*.5+.5;vec3 deep=mix(vec3(.06,.16,.2),vec3(.24,.21,.15),uMud);vec3 c=mix(deep,deep*1.6+.05,n*.35);
   float foam=riv?0.:(1.-smoothstep(0.,.35,dep))*(.5+.5*n);c=mix(c,vec3(.8,.85,.85),foam*.7);
   float fd=gl_FragCoord.z/gl_FragCoord.w;c=mix(c,uFogC,smoothstep(uFogN,uFogF,fd));gl_FragColor=vec4(c,riv?.95:.88);}`});

// ---------- traffic: cars wander the road graph, keep right, yield to the truck ----------
const CARS=[],NC=80;let carBody=null,carTop=null;
function initTraffic(){disposeObj(carBody);disposeObj(carTop);CARS.length=0;const ok=EDGES.map((e,i)=>i).filter(i=>!EDGES[i].dead&&EDGES[i].len>8);
  for(let i=0;i<NC&&ok.length;i++){const e=ok[Math.floor(Math.random()*ok.length)];CARS.push({e,dir:Math.random()<.5?1:-1,s:Math.random()*EDGES[e].len,v:8,vmax:9+Math.random()*5,lane:Math.random()<.5?.2:.36,pull:0,x:0,z:0,y:.8,hx:0,hz:1,wait:0})}
  carBody=new THREE.InstancedMesh(new THREE.BoxGeometry(1.9,1.1,4.4),new THREE.MeshLambertMaterial({color:0xffffff}),NC);carTop=new THREE.InstancedMesh(new THREE.BoxGeometry(1.7,.8,2.2),new THREE.MeshLambertMaterial({color:0x1d2629}),NC);
  const col=new THREE.Color(),pal=[0x9aa3a6,0x3b4f66,0x7a2b2b,0xd8d4c8,0x2f3a3a,0x6b6f3a];for(let i=0;i<NC;i++)carBody.setColorAt(i,col.setHex(pal[i%pal.length]));SC.add(carBody,carTop)}
const carPose=c=>{const e=EDGES[c.e],A=NODES[c.dir>0?e.a:e.b],Bn=NODES[c.dir>0?e.b:e.a],hx=(Bn.x-A.x)/e.len,hz=(Bn.z-A.z)/e.len,lane=e.w*(c.lane+c.pull*(.46-c.lane));
  c.hx=hx;c.hz=hz;c.x=A.x+hx*c.s-hz*lane;c.z=A.z+hz*c.s+hx*lane;c.y=e.bridge?1.85:.8};
function carTick(dt){if(!carBody)return;const o=new THREE.Object3D(),onEdge=new Map();for(const c of CARS){const k=c.e*2+(c.dir>0?1:0);let a=onEdge.get(k);if(!a)onEdge.set(k,a=[]);a.push(c)}
  const th=V(Math.sin(TR.yaw),0,-Math.cos(TR.yaw));
  for(let i=0;i<CARS.length;i++){const c=CARS[i],e=EDGES[c.e];let vt=c.vmax,stall=false;
    if(floodDepth(c.x,c.z)>CFG.roadDepth||hazardStall(c.x,c.z))stall=true;
    if(stall){vt=0;c.pull=Math.min(1,c.pull+dt)}
    if(mode=='ground'){const dx=TR.x-c.x,dz=TR.z-c.z,al=dx*c.hx+dz*c.hz,lat=Math.abs(-dx*c.hz+dz*c.hx);
      for(const tp of [0,.7,1.4,2.1]){const px=dx+th.x*TR.spd*tp,pz=dz+th.z*TR.spd*tp,a2=px*c.hx+pz*c.hz,l2=Math.abs(-px*c.hz+pz*c.hx);if(a2>-2&&a2<20&&l2<4.5){vt=0;break}} // truck in (or about to cross) my path: stop
      const tb=-(dx*th.x+dz*th.z);                                     // how far ahead of the truck I am (along the truck heading)
      if(tb>0&&tb<35&&Math.abs(dx*th.z-dz*th.x)<5){c.pull=Math.min(1,c.pull+dt*2.5);vt=Math.min(vt,4)}else if(!stall)c.pull=Math.max(0,c.pull-dt*.4)} // truck behind me: pull over
    else if(!stall)c.pull=Math.max(0,c.pull-dt*.4);
    for(const d of onEdge.get(c.e*2+(c.dir>0?1:0))||[]){if(d===c)continue;const gap=d.s-c.s;if(gap>0&&gap<9)vt=Math.min(vt,d.v*(gap<5?0:1))} // follow the car ahead
    c.v+=(vt-c.v)*Math.min(1,dt*1.5);c.s+=c.v*dt;
    if(c.s>e.len){const end=c.dir>0?e.b:e.a,opts=NODES[end].adj.filter(([v,l,ei])=>ei!==c.e&&!EDGES[ei].dead&&!BLOCK[ei]);const pick=opts.length?opts[Math.floor(Math.random()*opts.length)]:NODES[end].adj.find(a=>a[2]===c.e);
      if(pick){c.s-=e.len;c.e=pick[2];c.dir=EDGES[pick[2]].a===end?1:-1;c.s=Math.min(c.s,EDGES[c.e].len)}else c.s=e.len}
    carPose(c);o.position.set(c.x,c.y,c.z);o.rotation.set(0,Math.atan2(c.hx,c.hz),0);o.updateMatrix();carBody.setMatrixAt(i,o.matrix);o.position.y+=.9;o.updateMatrix();carTop.setMatrixAt(i,o.matrix)}
  carBody.instanceMatrix.needsUpdate=carTop.instanceMatrix.needsUpdate=true}
