'use strict';
// =====================================================================
// hazards.js: five disasters (+ "none" for a normal day in live mode), one interface:
//   hazardReset()            set up sky/fog/state for the current disaster
//   hazardTick(dt)           advance the hazard
//   windAt(x,z)              wind vector m/s (live mode adds observed Houston wind)
//   airRisk(x,z)             travel-time multiplier for flying to a point (planner soft cost)
//   dangerAt(x,z,ta)         forecast danger 0..1 at time now+ta (planner hard check, landing check)
//   updateBlocked()          which road edges are closed (truck planner)
//   pickReportBuilding()     where new calls for help come from
//   reportTau(b)             survival decay time constant for a report there
//   ROUTING_NOTE[disaster]   how routing differs for each disaster (shown in the HUD)
// =====================================================================
let BLOCK=new Uint8Array(0);
const T={x:-260,z:-120,tx:20,tz:0,vx:0,vz:0,turn:0};
const H={ex:0,ez:0};
const Q={main:false,next:0,shakeT:0,after:0,collapsed:[],damaged:[],rubble:new Set(),hard:new Set(),anim:[]};
const FIRE={nx:0,nz:0,x0:0,z0:0,cell:40,st:null,tm:null,fuel:null,dir:V(1,0,0),burning:[]};
const ROUTING_NOTE={
  tornado:'Tornado: avoids the forecast funnel track (position + current motion, growing uncertainty) and skips stops it would still be at when the funnel arrives.',
  hurricane:'Hurricane: headwinds cost time and battery, strongest near the eyewall; storm surge closes low roads, so far-bank reports may be air-only.',
  flood:'Flood: ranks by how soon water reaches each building on the modeled terrain; the truck avoids water over 0.3 m, only wades shallow water if there is no dry way, and roads over 0.7 m are closed.',
  wildfire:'Wildfire: ranks by forecast fire arrival (downwind spreads faster), no landing in or just ahead of the front, flies high over smoke.',
  earthquake:'Earthquake: trapped people first (faster survival decay), rubble blocks nearby roads, avoids damaged towers during aftershocks.',
  none:'Normal day: no hazard and no calls. Free roam with live wind.'};

// ---------- visuals shared by hazards ----------
const TN=1800,tg=new THREE.BufferGeometry(),tp=new Float32Array(TN*3);tg.setAttribute('position',new THREE.BufferAttribute(tp,3));
const torn=new THREE.Points(tg,new THREE.PointsMaterial({color:0x9fb0b4,size:2.4,transparent:true,opacity:.6,depthWrite:false}));torn.frustumCulled=false;SC.add(torn);
const DN=140,deb=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshLambertMaterial({color:0x6b5d4f}),DN),db=[],dm=new THREE.Object3D();
for(let i=0;i<DN;i++)db.push({a:Math.random()*6.28,age:Math.random()*6,s:.6+Math.random()*1.8,sp:2+Math.random()*3,p:V(0,-50,0),pp:V(0,-50,0),threat:0});deb.frustumCulled=false;SC.add(deb);
const RN=1500,rg=new THREE.BufferGeometry(),rpos=new Float32Array(RN*6);for(let i=0;i<RN;i++){const x=(Math.random()-.5)*160,y=Math.random()*90,z=(Math.random()-.5)*160;rpos.set([x,y,z,x,y-1,z],i*6)}
rg.setAttribute('position',new THREE.BufferAttribute(rpos,3));const rain=new THREE.LineSegments(rg,new THREE.LineBasicMaterial({color:0x9fb6c4,transparent:true,opacity:.35}));rain.frustumCulled=false;SC.add(rain);
// fire (additive glow) and smoke (soft dark) particles, reused by wildfire; dust reused by earthquake collapses
const mkPts=(n,size,color,add,op)=>{const g=new THREE.BufferGeometry(),p=new Float32Array(n*3).fill(-999);g.setAttribute('position',new THREE.BufferAttribute(p,3));
  const sprite=canvasTex(64,64,(c)=>{const gr=c.createRadialGradient(32,32,2,32,32,30);gr.addColorStop(0,'rgba(255,255,255,1)');gr.addColorStop(1,'rgba(255,255,255,0)');c.fillStyle=gr;c.fillRect(0,0,64,64)});
  const m=new THREE.Points(g,new THREE.PointsMaterial({size,color,map:sprite,transparent:true,opacity:op,depthWrite:false,blending:add?THREE.AdditiveBlending:THREE.NormalBlending}));m.frustumCulled=false;SC.add(m);return{m,p,n,v:new Float32Array(n*4)}};
const FIREP=mkPts(1400,9,0xff8a2a,true,.9),SMOKE=mkPts(600,46,0x3a3430,false,.32),DUST=mkPts(500,26,0x9a8f80,false,.45);
// rubble chunks around collapsed buildings
const RUB=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),toon(0x6f6a62),600);RUB.count=0;SC.add(RUB);

// ---------- wind ----------
// live mode: observed wind at the Houston station (NWS), blowing TOWARD (from + 180 deg). North = -z.
function obsWind(){if(!live.on||!live.obs||live.obs.wind==null)return null;const to=((live.obs.dir||0)+180)*Math.PI/180;return V(Math.sin(to)*live.obs.wind,0,-Math.cos(to)*live.obs.wind)}
function windAt(x,z){const ow=obsWind(),g=1+.35*Math.sin(t*.9+x*.004)*Math.sin(t*.37+z*.005);
  // derecho (live sample): a straight-line gust front sweeping west to east at ~22 m/s, strongest just behind the front
  if(disaster=='hurricane'&&H.derecho){const fx=HOME.x-1800+22*simT,bh=fx-x,s=bh>0&&bh<500?42*(1-bh/650):9;return V(s*g,0,-2*g)}
  if(disaster=='hurricane'){const hc=CFG.hurricane,dx=x-H.ex,dz=z-H.ez,r=Math.hypot(dx,dz)||1,v=hc.vmax*(r<hc.rmax?r/hc.rmax:Math.pow(hc.rmax/r,.6))*(1+.25*Math.sin(t*1.1+x*.01)*Math.sin(t*.43+z*.013));
    return V((dz/r-.25*dx/r)*v,0,(-dx/r-.25*dz/r)*v)}
  if(disaster=='wildfire')return FIRE.dir.clone().multiplyScalar(CFG.wildfire.wind*g);
  if(ow)return ow.multiplyScalar(g);
  if(disaster=='flood')return V(4*g,0,-3*g);
  const a=t*.07;return V(Math.sin(a)*9*g,0,Math.cos(a*1.3)*9*g)}

// ---------- reset / sky per disaster ----------
function hazardReset(){const d=disaster;T.x=HOME.x-260;T.z=HOME.z-120;T.vx=T.vz=0;H.ex=HOME.x+CFG.hurricane.eye0[0];H.ez=HOME.z+CFG.hurricane.eye0[1];waterLevel=0;
  Q.main=false;Q.next=0;Q.shakeT=0;Q.after=0;Q.collapsed=[];Q.damaged=[];Q.rubble.clear();Q.hard.clear();Q.anim=[];RUB.count=0;
  for(const b of B){b.hs=1;b.char=0;b.dmg=0;if(bState.tex)setBState(b.i,1,0)}
  if(d=='wildfire')fireInit();
  const sky={tornado:[0x1b2c33,0x3d545b,160,1600,.24,1.1,1.3],hurricane:[0x0f1a20,0x2a3a40,90,950,CFG.hurricane.lit,.8,.5],flood:[0x16222a,0x34464d,110,1100,.2,.9,.6],
    wildfire:[0x3a2416,0x7a4a2a,120,1200,.2,1,1.2],earthquake:[0x23303a,0x55646a,180,1700,.28,1.1,1.2],none:[0x2a4050,0x6f8a96,220,2200,.18,1.2,1.4]}[d];
  skyU.top.value.setHex(sky[0]);skyU.bot.value.setHex(sky[1]);SC.fog.color.copy(skyU.bot.value);SC.fog.near=sky[2];SC.fog.far=sky[3];waterU.uFogN.value=sky[2];waterU.uFogF.value=sky[3];
  if(CITY.theme==='aurora'){skyU.top.value.setHex(0x040a1c);skyU.bot.value.setHex(0x15283c);SC.fog.color.copy(skyU.bot.value);if(d=='none'){sky[4]=.4;sky[5]=.9}sky[6]=Math.min(sky[6],.5)}
  winU.uLit.value=sky[4];hemi.userData.base=sky[5];sun.intensity=sky[6];torn.visible=d=='tornado';waterU.uMud.value=d=='flood'||d=='hurricane'?.7:0;
  BLOCK=new Uint8Array(EDGES.length);for(const a of [FIREP,SMOKE,DUST])a.p.fill(-999)}

// ---------- tick ----------
function hazardTick(dt){const d=disaster;
  if(d=='tornado'){T.turn-=dt;if(T.turn<=0){T.turn=1+Math.random()*2.5;const a=Math.random()*6.28,s=18+Math.random()*40;T.tx=Math.cos(a)*s-(T.x-HOME.x)*.06;T.tz=Math.sin(a)*s-(T.z-HOME.z)*.06;if(Math.random()<.3){T.tx*=2;T.tz*=2}}
    T.vx+=(T.tx-T.vx)*dt*1.6;T.vz+=(T.tz-T.vz)*dt*1.6;T.x=clamp(T.x+T.vx*dt,-E+60,E-60);T.z=clamp(T.z+T.vz*dt,-E+60,E-60);
    // damage path: buildings under the core get damaged (more reports come from here)
    forNear(T.x,T.z,b=>{if(!b.dmg&&bDist(b,T.x,T.z,40)<30){b.dmg=1;b.char=.35;setBState(b.i,b.hs,b.char)}return false})}
  else if(d=='hurricane'){const hc=CFG.hurricane,dx=HOME.x-H.ex,dz=HOME.z-H.ez,dd=Math.hypot(dx,dz);if(dd>500){H.ex+=dx/dd*hc.eyeSpeed*dt;H.ez+=dz/dd*hc.eyeSpeed*dt}waterLevel=hc.maxLevel*ease(clamp(simT/hc.riseTime,0,1))}
  else if(d=='flood')waterLevel=floodLevelAt(simT);
  else if(d=='wildfire')fireTick(dt);
  else if(d=='earthquake')quakeTick(dt);
  waterU.uLevel.value=waterLevel;if(water)water.position.y=.35+Math.min(waterLevel,3)*.45}
const floodLevelAt=s=>CFG.flood.maxLevel*ease(clamp(s/CFG.flood.riseTime,0,1));

// ---------- forecast danger (0..1) at a point, ta seconds from now ----------
function dangerAt(x,z,ta=0){const d=disaster;
  if(d=='tornado'){const k=Math.min(ta,CFG.safety.lookahead),px=T.x+T.vx*k,pz=T.z+T.vz*k,unc=Math.min(ta,12)*8; // uncertainty grows with lead time
    const r=Math.min(Math.hypot(x-px,z-pz),Math.hypot(x-T.x,z-T.z));return r<CFG.tornado.danger+unc?1:r<CFG.tornado.danger+unc+CFG.safety.margin?.5:0}
  if(d=='hurricane'){const w=windAt(x,z).length();return w>36?.6:0}
  if(d=='wildfire'){const a=fireArrival(x,z);return a<ta+8?1:a<ta+25?.5:0}
  if(d=='earthquake'){if(Q.after<=0)return 0;let n=0;forNear(x,z,b=>{if(b.dmg&&bDist(b,x,z)<35){n=1;return true}return false});return n?.7:0}
  return 0}
const inDanger=(x,z,ta=0)=>dangerAt(x,z,ta)>=.75;
// travel-time multiplier for the air planner (soft cost on top of the hard dangerAt check)
function airRisk(x,z){const d=disaster;if(d=='tornado'){const r=Math.hypot(x-T.x,z-T.z);return r<90?3:r<CFG.tornado.danger?1.6:1}
  if(d=='hurricane'){const w=windAt(x,z).length();return 1+Math.max(0,w-22)/18}
  if(d=='wildfire'){const a=fireArrival(x,z);return a<15?2.2:a<40?1.3:1}return 1}
// exposure along a straight flight from a to b (fraction of samples in danger), used to inflate travel time
function pathExposure(ax,az,bx,bz,ta){let n=0;for(let i=1;i<=8;i++){const u=i/9;if(dangerAt(ax+(bx-ax)*u,az+(bz-az)*u,ta*u)>=.75)n++}return n/8}
// cars stall in danger
function hazardStall(x,z){return disaster=='tornado'?Math.hypot(x-T.x,z-T.z)<130:disaster=='wildfire'?fireArrival(x,z)<4:false}

// ---------- road closures ----------
function updateBlocked(){if(BLOCK.length!==EDGES.length)BLOCK=new Uint8Array(EDGES.length);const d=disaster;
  for(let e=0;e<EDGES.length;e++){const E_=EDGES[e];let bl=E_.dead?1:0;
    if(!bl&&d=='tornado'){const k=4;bl=Math.hypot(E_.mx-T.x-T.vx*k,E_.mz-T.z-T.vz*k)<CFG.tornado.block||Math.hypot(E_.mx-T.x,E_.mz-T.z)<CFG.tornado.block?1:0}
    if(!bl&&(d=='hurricane'||d=='flood')&&!E_.bridge){const fd=floodDepth(E_.mx,E_.mz);if(fd>CFG.wadeDepth)bl=1;else if(fd>CFG.roadDepth)bl=2}  // 1 = closed, 2 = shallow water: the planner avoids it (x4 cost) but can wade through if there is no dry way
    
    if(!bl&&d=='wildfire'&&fireArrival(E_.mx,E_.mz)<6)bl=1;
    if(!bl&&d=='earthquake'&&Q.hard.has(e))bl=1;BLOCK[e]=bl}}

// ---------- where calls for help come from ----------
function pickReportBuilding(){let free=B.filter(b=>b.curb!==undefined&&!reports.some(r=>!r.done&&r.b===b)&&b.hs>.1);
  if(E>2400){const U=unitPos(),near=free.filter(b=>Math.hypot(b.x-U.x,b.z-U.z)<2600);if(near.length)free=near}  // big map: calls come from around where you are
  if(!free.length)return null;const d=disaster;
  const any=()=>free[Math.floor(Math.random()*free.length)];let pool=null;
  if(d=='tornado'){pool=free.filter(b=>b.dmg);if(Math.random()<.5)pool=free.filter(b=>Math.hypot(b.x-T.x,b.z-T.z)<450)}
  else if(d=='hurricane'||d=='flood'){const lv=d=='flood'?floodLevelAt(simT+60):waterLevel+1.2;pool=free.filter(b=>elevAt(b.x,b.z)<lv+.6&&riverDist(b.x,b.z)>4)} // low ground, soon to flood
  else if(d=='wildfire'){pool=free.filter(b=>{const a=fireArrival(b.x,b.z);return a>6&&a<90})}                        // just ahead of the front
  else if(d=='earthquake'){pool=Math.random()<.65?Q.collapsed.filter(b=>free.includes(b)):Q.damaged.filter(b=>free.includes(b))}
  return pool&&pool.length&&Math.random()<.85?pool[Math.floor(Math.random()*pool.length)]:any()}
function reportTau(b){if(disaster=='earthquake'&&b.hs<.6)return CFG.earthquake.tau;if((disaster=='flood'||disaster=='hurricane')&&floodDepth(b.x,b.z)>.5)return CFG.plan.tau*.7;return CFG.plan.tau}
// share of occupants calling for help (assumption): bigger for trapped/flooded
function reportShare(b){const base=.003+Math.random()*.012;if(disaster=='earthquake'&&b.hs<.6)return base*3;if(WSRC==='houston')return Math.min(.2,base*4);return base}

// ---------- wildfire: cellular spread on a 40 m grid, faster downwind, spotting embers ----------
function fireInit(){const c=Math.max(CFG.wildfire.cell,Math.ceil(E/130));FIRE.cell=c;FIRE.x0=-E-100;FIRE.z0=-E-100;FIRE.nx=Math.ceil((2*E+200)/c);FIRE.nz=FIRE.nx;const n=FIRE.nx*FIRE.nz;
  FIRE.st=new Uint8Array(n);FIRE.tm=new Float32Array(n);FIRE.fuel=new Float32Array(n);FIRE.arr=new Float32Array(n).fill(999);FIRE.arrT=0;
  const ang=-.35+(Math.random()-.5)*.6;FIRE.dir=V(Math.cos(ang),0,Math.sin(ang)); // wind toward roughly east (fire starts on the west side)
  for(let j=0;j<FIRE.nz;j++)for(let i=0;i<FIRE.nx;i++){const x=FIRE.x0+(i+.5)*c,z=FIRE.z0+(j+.5)*c,k=j*FIRE.nx+i;let f=.45;          // urban fuel: low
    if(riverDist(x,z)<0)f=0;else{forNear(x,z,b=>{if(bDist(b,x,z,30)<1){f=.75;return true}return false});for(const tr of TREES)if(Math.abs(tr.x-x)<c&&Math.abs(tr.z-z)<c){f=1.6;break}}FIRE.fuel[k]=f}
  // ignition: a strip on the upwind edge of the city
  const sx=-FIRE.dir.x,sz=-FIRE.dir.z;for(let q=-3;q<=3;q++){const fr=Math.min(E*.85,1500),x=HOME.x+sx*fr+(-sz)*q*c*2,z=HOME.z+sz*fr+sx*q*c*2,i=Math.floor((x-FIRE.x0)/c),j=Math.floor((z-FIRE.z0)/c);if(i>=0&&j>=0&&i<FIRE.nx&&j<FIRE.nz){FIRE.st[j*FIRE.nx+i]=1}}
  fireArrivalUpdate()}
function fireTick(dt){const f=FIRE,nx=f.nx,c=f.cell,w=windAt(0,0),wl=w.length()||1,wx=w.x/wl,wz=w.z/wl;f.burning.length=0;
  for(let k=0;k<f.st.length;k++){if(f.st[k]!==1)continue;f.burning.push(k);f.tm[k]+=dt;if(f.tm[k]>28){f.st[k]=2;continue}const i=k%nx,j=(k/nx)|0;
    for(let dj=-1;dj<=1;dj++)for(let di=-1;di<=1;di++){if(!di&&!dj)continue;const ii=i+di,jj=j+dj;if(ii<0||jj<0||ii>=nx||jj>=f.nz)continue;const kk=jj*nx+ii;if(f.st[kk])continue;
      const dl=Math.hypot(di,dj),al=(di*wx+dj*wz)/dl,p=CFG.wildfire.baseSpread*f.fuel[kk]*(.35+2.6*Math.max(0,al))/dl;if(Math.random()<p*dt)f.st[kk]=1}
    if(Math.random()<.006*dt){const L=3+Math.random()*4,ii=Math.round(i+wx*L),jj=Math.round(j+wz*L);if(ii>=0&&jj>=0&&ii<nx&&jj<f.nz&&!f.st[jj*nx+ii]&&f.fuel[jj*nx+ii]>0)f.st[jj*nx+ii]=1}} // ember spotting
  // buildings in burning/burned cells char over time
  for(const k of f.burning){const x=f.x0+(k%nx+.5)*c,z=f.z0+(((k/nx)|0)+.5)*c;forNear(x,z,b=>{if(b.char<1&&bDist(b,x,z,30)<c*.6){b.char=Math.min(1,b.char+dt*.05);b.dmg=1;setBState(b.i,b.hs,b.char)}return false})}
  f.arrT-=dt;if(f.arrT<=0){f.arrT=1;fireArrivalUpdate()}}
// forecast arrival time (s) per cell: Dijkstra from burning cells, step time shorter downwind (expected spread speed ~ 1/p)
function fireArrivalUpdate(){const f=FIRE,nx=f.nx,n=f.st.length,A=f.arr;A.fill(999);const w=windAt(0,0),wl=w.length()||1,wx=w.x/wl,wz=w.z/wl,h=[];
  const push=(d,k)=>{h.push([d,k]);let i=h.length-1;while(i){const p=(i-1)>>1;if(h[p][0]<=h[i][0])break;[h[p],h[i]]=[h[i],h[p]];i=p}};
  const pop=()=>{const top=h[0],last=h.pop();if(h.length){h[0]=last;let i=0;for(;;){const l=2*i+1,r=l+1;let m=i;if(l<h.length&&h[l][0]<h[m][0])m=l;if(r<h.length&&h[r][0]<h[m][0])m=r;if(m===i)break;[h[m],h[i]]=[h[i],h[m]];i=m}}return top};
  for(let k=0;k<n;k++)if(f.st[k]===1){A[k]=0;push(0,k)}
  while(h.length){const [d,k]=pop();if(d>A[k]||d>240)continue;const i=k%nx,j=(k/nx)|0;
    for(let dj=-1;dj<=1;dj++)for(let di=-1;di<=1;di++){if(!di&&!dj)continue;const ii=i+di,jj=j+dj;if(ii<0||jj<0||ii>=nx||jj>=f.nz)continue;const kk=jj*nx+ii;if(f.st[kk]===2||f.fuel[kk]<=0)continue;
      const dl=Math.hypot(di,dj),al=(di*wx+dj*wz)/dl,p=CFG.wildfire.baseSpread*Math.max(.15,f.fuel[kk])*(.35+2.6*Math.max(0,al))/dl,nd=d+1/p;if(nd<A[kk]){A[kk]=nd;push(nd,kk)}}}}
function fireArrival(x,z){const f=FIRE;if(!f.st||disaster!='wildfire')return 999;const i=Math.floor((x-f.x0)/f.cell),j=Math.floor((z-f.z0)/f.cell);if(i<0||j<0||i>=f.nx||j>=f.nz)return 999;const k=j*f.nx+i;return f.st[k]===2?999:f.arr[k]}

// ---------- earthquake: main shock, staged collapses with dust, damage, aftershocks, rubble on roads ----------
function quakeTick(dt){const qc=CFG.earthquake;
  if(!Q.main&&simT>=qc.t0){Q.main=true;Q.shakeT=3;shake=Math.max(shake,2.2);say('EARTHQUAKE');sfx('quake');
    const sorted=B.filter(b=>Math.hypot(b.x-HOME.x,b.z-HOME.z)<2800).sort(()=>Math.random()-.5);for(const b of sorted){const r=Math.random();if(r<qc.collapse*(.6+Math.min(1,b.h/120)))collapse(b);else if(r<qc.collapse+qc.damage){b.dmg=1;b.char=.22;b.hs=.95;setBState(b.i,b.hs,b.char);Q.damaged.push(b)}}
    Q.next=simT+qc.after[0]+Math.random()*(qc.after[1]-qc.after[0]);for(let i=0;i<3;i++)addReport()}
  if(Q.main&&simT>=Q.next){Q.next=simT+qc.after[0]+Math.random()*(qc.after[1]-qc.after[0]);Q.after=9;Q.shakeT=1.4;shake=Math.max(shake,1.1);say('aftershock');sfx('quake');radio('aftershock: stay clear of damaged towers for about 9 seconds',true);
    for(const b of Q.damaged)if(b.hs>.6&&Math.random()<.12)collapse(b)}
  Q.after-=dt;if(Q.shakeT>0){Q.shakeT-=dt;shake=Math.max(shake,Q.shakeT*.7)}
  for(const a of Q.anim){a.t=Math.min(1,a.t+dt/3);const b=a.b;b.hs=1-.75*ease(a.t);setBState(b.i,b.hs,b.char)}Q.anim=Q.anim.filter(a=>a.t<1)}
function collapse(b){if(b.hs<.5&&b.dmg>1)return;b.dmg=2;b.char=.5;Q.collapsed.push(b);Q.anim.push({b,t:0});
  for(let k=0;k<30;k++){const i=Math.floor(Math.random()*DUST.n);DUST.p[i*3]=b.x+(Math.random()-.5)*b.hx*2.4;DUST.p[i*3+1]=Math.random()*b.h*.4;DUST.p[i*3+2]=b.z+(Math.random()-.5)*b.hz*2.4;DUST.v[i*4]=4+Math.random()*3}
  const m4=new THREE.Matrix4(),q=new THREE.Quaternion();for(let k=0;k<6&&RUB.count<600;k++){const a=Math.random()*6.28,r=Math.max(b.hx,b.hz)*(.9+Math.random()*.6),s=2+Math.random()*4;
    q.setFromEuler(new THREE.Euler(Math.random(),Math.random()*3,Math.random()));m4.compose(V(b.x+Math.cos(a)*r,s*.35,b.z+Math.sin(a)*r),q,V(s,s*.6,s*1.3));RUB.setMatrixAt(RUB.count++,m4)}RUB.instanceMatrix.needsUpdate=true;
  // rubble: about half the nearby street segments are fully blocked, the rest are passable at crawl speed (assumption)
  forNearEdges(b.x,b.z,e=>{if(edgeDist(e,b.x,b.z)<Math.max(b.hx,b.hz)+14){Q.rubble.add(e);if(Math.random()<.5)Q.hard.add(e)}})}

// ---------- debris (tornado orbit / hurricane wind) + hazard sense warnings ----------
function debTick(dt){const U=unitPos();let threat=null;const on=disaster=='tornado'||disaster=='hurricane';deb.visible=on;if(!on)return;
  for(let i=0;i<DN;i++){const d=db[i];d.pp.copy(d.p);
    if(disaster=='tornado'){d.age+=dt;if(d.age>6){d.age=0;d.a=Math.random()*6.28}d.a+=dt*d.sp*(1.6-d.age*.18);const r=5+d.age*d.age*3.2;d.p.set(T.x+Math.cos(d.a)*r,3+d.age*28+Math.sin(d.a*2)*6,T.z+Math.sin(d.a)*r)}
    else{if(i>=70){d.p.y=-50}else{const w=windAt(d.p.x,d.p.z);d.p.addScaledVector(w,dt*1.25);d.p.y+=Math.sin(t*2+i)*dt*3;
      if(d.p.distanceTo(U)>170||d.p.y<0){const wn=windAt(U.x,U.z).normalize();d.p.set(U.x-wn.x*150+(Math.random()-.5)*140,U.y+(Math.random()-.4)*40,U.z-wn.z*150+(Math.random()-.5)*140);d.pp.copy(d.p)}}}
    dm.position.copy(d.p);dm.rotation.set(t*d.sp,t*d.sp*.7,d.a);dm.scale.set(d.s,d.s*(disaster=='hurricane'?.25:1),d.s*(disaster=='hurricane'?1.6:1));dm.updateMatrix();deb.setMatrixAt(i,dm.matrix);
    if(d.p.y<0)continue;
    const rp=d.p.clone().sub(U),rv=d.p.clone().sub(d.pp).divideScalar(Math.max(dt,1e-3)).sub(mode=='air'?vel:V(Math.sin(TR.yaw)*TR.spd,0,-Math.cos(TR.yaw)*TR.spd)),vv=rv.lengthSq();
    const tca=vv>1?-rp.dot(rv)/vv:99,miss=rp.clone().addScaledVector(rv,clamp(tca,0,9)).length();
    if(tca>0&&tca<1.1&&miss<3.5){if(!d.threat){d.threat=1;if(!threat)threat=d}}
    else if(d.threat&&tca<=0){d.threat=0;if(rp.length()>d.s+1.6&&rp.length()<14&&go&&app!=='live'){stats.dodges++;style++;if(mode=='air')spd+=7;say('clean dodge +boost')}}
    if(hitCd<=0&&Math.abs(U.x-d.p.x)<d.s+1.5&&Math.abs(U.y-d.p.y)<d.s+1.5&&Math.abs(U.z-d.p.z)<d.s+1.5){d.threat=0;if(mode=='air'){spd*=.8;bat-=2}else{TR.spd*=.6;tbat-=1}shake=1;hitCd=.6;sfx('thud');say('debris hit')}}
  deb.instanceMatrix.needsUpdate=true;if(threat&&warnCd<=0&&go){warnCd=2.5;slowT=.35;showWarn(threat.p);sfx('warn')}}
function showWarn(p){const v=p.clone().project(C),w=$('warn');let x=v.x,y=v.y;if(v.z>1){x=-x;y=-y}const a=Math.atan2(y,x),m=Math.max(Math.abs(x),Math.abs(y),1e-3);x=clamp(x/m*.86,-.86,.86);y=clamp(y/m*.8,-.8,.8);
  w.style.left=((x*.5+.5)*innerWidth-16)+'px';w.style.top=((-y*.5+.5)*innerHeight-15)+'px';w.style.transform='rotate('+(Math.PI/2-a)+'rad)';w.style.display='block';setTimeout(()=>w.style.display='none',600)}

// ---------- per-frame hazard visuals ----------
function hazardVisuals(dt,q){const d=disaster;
  // rain: hurricane, flood (heavier), live mode when the station reports precipitation
  const raining=d=='hurricane'||d=='flood'||(live.on&&live.obs&&live.obs.rain);rain.visible=raining;
  if(raining){const n=Math.round(q.rain*(d=='flood'?1:d=='hurricane'?1:.5)),w=windAt(C.position.x,C.position.z),a=rpos;rain.position.set(C.position.x,C.position.y-45,C.position.z);
    for(let i=0;i<n;i++){const o=i*6;a[o]+=w.x*dt;a[o+1]-=34*dt;a[o+2]+=w.z*dt;if(a[o+1]<0||Math.abs(a[o])>80||Math.abs(a[o+2])>80){a[o]=(Math.random()-.5)*160;a[o+1]=90;a[o+2]=(Math.random()-.5)*160}
      a[o+3]=a[o]-w.x*.05;a[o+4]=a[o+1]+1.7;a[o+5]=a[o+2]-w.z*.05}for(let i=n;i<RN;i++)a[i*6+1]=a[i*6+4]=-999;rg.attributes.position.needsUpdate=true}
  if(d=='tornado'){const a=tg.attributes.position.array;for(let i=0;i<TN;i++){const h=(i/TN)*190,r=4+h*.32,an=i*2.399+t*(3.2-h/90),qq=h/190;a[i*3]=T.x+Math.cos(an)*r+qq*qq*40*Math.sin(t*.8)+Math.sin(h*.07+t*2)*7*qq;a[i*3+1]=h;a[i*3+2]=T.z+Math.sin(an)*r+qq*qq*40*Math.cos(t*.6)}tg.attributes.position.needsUpdate=true}
  // wildfire: flames over burning cells, smoke drifting downwind
  FIREP.m.visible=SMOKE.m.visible=d=='wildfire';
  if(d=='wildfire'&&FIRE.burning.length){const f=FIRE,c=f.cell,w=windAt(0,0);
    for(let i=0;i<FIREP.n;i++){const v=FIREP.v;v[i*4]-=dt;if(v[i*4]<=0){const k=f.burning[Math.floor(Math.random()*f.burning.length)];v[i*4]=.5+Math.random()*.9;
      FIREP.p[i*3]=f.x0+(k%f.nx+Math.random())*c;FIREP.p[i*3+1]=Math.random()*3;FIREP.p[i*3+2]=f.z0+(((k/f.nx)|0)+Math.random())*c}else{FIREP.p[i*3+1]+=dt*(7+Math.random()*6);FIREP.p[i*3]+=w.x*dt*.2;FIREP.p[i*3+2]+=w.z*dt*.2}}
    for(let i=0;i<SMOKE.n;i++){const v=SMOKE.v;v[i*4]-=dt;if(v[i*4]<=0){const k=f.burning[Math.floor(Math.random()*f.burning.length)];v[i*4]=6+Math.random()*8;
      SMOKE.p[i*3]=f.x0+(k%f.nx+Math.random())*c;SMOKE.p[i*3+1]=8;SMOKE.p[i*3+2]=f.z0+(((k/f.nx)|0)+Math.random())*c}else{SMOKE.p[i*3+1]+=dt*6;SMOKE.p[i*3]+=w.x*dt*.7;SMOKE.p[i*3+2]+=w.z*dt*.7}}
    FIREP.m.geometry.attributes.position.needsUpdate=SMOKE.m.geometry.attributes.position.needsUpdate=true}
  // dust from collapses settles
  DUST.m.visible=d=='earthquake';if(d=='earthquake'){for(let i=0;i<DUST.n;i++){if(DUST.p[i*3+1]<-900)continue;DUST.v[i*4]-=dt*.3;DUST.p[i*3+1]+=dt*Math.max(-1,DUST.v[i*4]);if(DUST.v[i*4]<-1.2&&DUST.p[i*3+1]<1)DUST.p[i*3+1]=-999}DUST.m.geometry.attributes.position.needsUpdate=true}}

// ---------- map overlay per disaster ----------
let floodImg=null,floodImgT=-9,floodImgLv=-1;
function hazardMap(g,X,Z,k){const d=disaster;
  if(d=='tornado'){g.fillStyle='#ff5a4a33';g.beginPath();g.arc(X(T.x),Z(T.z),CFG.tornado.danger*k,0,7);g.fill();g.strokeStyle='#ffb347';g.setLineDash([4,4]);g.beginPath();g.moveTo(X(T.x),Z(T.z));g.lineTo(X(T.x+T.vx*8),Z(T.z+T.vz*8));g.stroke();g.setLineDash([]);
    g.fillStyle='#ffb347';g.beginPath();g.arc(X(T.x),Z(T.z),7,0,7);g.fill()}
  if(d=='hurricane'){g.strokeStyle='rgba(200,220,230,.45)';g.lineWidth=1.5;for(let x=-E;x<=E;x+=170)for(let z=-E;z<=E;z+=170){const w=windAt(x,z),l=w.length()||1;g.beginPath();g.moveTo(X(x),Z(z));g.lineTo(X(x+w.x/l*55),Z(z+w.z/l*55));g.stroke()}
    g.fillStyle='#ffb347';g.font='bold 13px sans-serif';g.fillText('eye '+Math.round(Math.hypot(H.ex,H.ez))+' m away',X(clamp(H.ex,-E,E))+6,Z(clamp(H.ez,-E,E))+14)}
  if(d=='wildfire'&&FIRE.st){const f=FIRE;for(let kk=0;kk<f.st.length;kk++){if(!f.st[kk]&&f.arr[kk]>60)continue;const x=f.x0+(kk%f.nx)*f.cell,z=f.z0+((kk/f.nx)|0)*f.cell;
    g.fillStyle=f.st[kk]==1?'rgba(255,110,40,.75)':f.st[kk]==2?'rgba(20,16,14,.6)':'rgba(255,160,60,.15)';g.fillRect(X(x),Z(z),f.cell*k+1,f.cell*k+1)}}
  if(d=='earthquake'){g.strokeStyle='#ff5a4a';g.lineWidth=2;for(const b of Q.collapsed){g.beginPath();g.moveTo(X(b.x)-5,Z(b.z)-5);g.lineTo(X(b.x)+5,Z(b.z)+5);g.moveTo(X(b.x)+5,Z(b.z)-5);g.lineTo(X(b.x)-5,Z(b.z)+5);g.stroke()}}}
