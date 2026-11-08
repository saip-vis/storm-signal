'use strict';
// =====================================================================
// sim.js: rescue reports, disaster-aware planner (air and road), user-drawn routes, pickups,
//         aerial autopilot, truck autopilot + manual driving, adaptive urgency
// =====================================================================
const unitPos=()=>mode=='air'?P:V(TR.x,TR.y+1.8,TR.z);

// ---------- road search ----------
function dijkstra(src,blocked){const n=NODES.length,d=new Float64Array(n).fill(Infinity),prev=new Int32Array(n).fill(-1),h=[];d[src]=0;h.push([0,src]);
  const up=i=>{while(i){const p=(i-1)>>1;if(h[p][0]<=h[i][0])break;[h[p],h[i]]=[h[i],h[p]];i=p}},
        dn=i=>{for(;;){const l=2*i+1,r=l+1;let m=i;if(l<h.length&&h[l][0]<h[m][0])m=l;if(r<h.length&&h[r][0]<h[m][0])m=r;if(m===i)break;[h[m],h[i]]=[h[i],h[m]];i=m}};
  while(h.length){const top=h[0],last=h.pop();if(h.length){h[0]=last;dn(0)}const [du,u]=top;if(du>d[u])continue;
    for(const [v,w0,e] of NODES[u].adj){const bk=blocked?blocked[e]:0;if(bk===1)continue;const w=bk===2?w0*4:w0;const nd=du+w;if(nd<d[v]){d[v]=nd;prev[v]=u;h.push([nd,v]);up(h.length-1)}}}
  return{d,prev}}
function nearestNode(x,z){const e=EDGES[nearestEdge(x,z)];if(!e)return 0;const a=NODES[e.a],b=NODES[e.b];return Math.hypot(a.x-x,a.z-z)<Math.hypot(b.x-x,b.z-z)?e.a:e.b}

// ---------- reports ----------
const reports=[];let rid=0,spawnT=0,route=[],routeBase=[],legs=[],legsBase=[],planT=0,mapOn=false,flash=0,userRoute=[];
const est={a:0,b:0,air:0,ground:0,unreach:0,user:null,unsafe:0};
function addReport(){const b=pickReportBuilding();if(!b)return;
  const r={id:++rid,x:b.x,z:b.z,b,people:Math.max(5,Math.round(b.pop*reportShare(b))),done:false,age:0,claimed:false,tau:reportTau(b),hold:0};
  const pp=padPoint(b);r.x=pp[0];r.z=pp[1];r.y=bH(b)+6;
  r.m=new THREE.Mesh(new THREE.CylinderGeometry(1.4,1.4,80,8,1,true),new THREE.MeshBasicMaterial({color:0xff5a4a,transparent:true,opacity:.38,depthWrite:false}));r.m.position.set(r.x,r.y+40,r.z);SC.add(r.m);
  r.g=new THREE.Mesh(new THREE.RingGeometry(1.6,2.4,20),new THREE.MeshBasicMaterial({color:0xff5a4a,transparent:true,opacity:.8,side:2,depthWrite:false}));r.g.rotation.x=-Math.PI/2;r.g.position.set(b.stop.x,.2,b.stop.z);SC.add(r.g);reports.push(r);if(simT>3)radio('new call: '+r.people+' people need help at '+(b.n||'a '+b.t+' building'))}
function closeReport(r){r.done=true;SC.remove(r.m);SC.remove(r.g);r.m.geometry.dispose();r.g.geometry.dispose()}

// ---------- hazard deadline: seconds until the hazard overruns this building (Infinity if none) ----------
// flood/hurricane: water reaches 1.2 m at the building on the modeled terrain. wildfire: forecast fire arrival.
function deadline(r){if(disaster=='wildfire')return fireArrival(r.b.x,r.b.z);
  if(disaster=='flood'||disaster=='hurricane'){const el=elevAt(r.b.x,r.b.z);for(let s=0;s<=300;s+=10){const lv=disaster=='flood'?floodLevelAt(simT+s):CFG.hurricane.maxLevel*ease(clamp((simT+s)/CFG.hurricane.riseTime,0,1));if(lv-el>1.2)return s}}return Infinity}

// ---------- planner ----------
// Greedy chain over open reports. travel(fromKey, r) -> seconds (Infinity = unreachable).
// Each candidate is checked against the hazard FORECAST at its arrival time plus the time spent there (service + lift-off):
// if the hazard is forecast to be there, the stop is deferred (heavily down-weighted) instead of flying into it.
const SERVICE_AIR=()=>CFG.plan.service+2.5,SERVICE_GROUND=()=>CFG.plan.service+1;
function stopSafe(r,ta,svc){return dangerAt(r.x,r.z,ta+svc)<.75&&dangerAt(r.x,r.z,ta)<.75}
function chain(open,travel,startKey,near,useNear,score,svc,fixed){const left=open.slice(),ord=[],keys=[];let key=startKey,tm=0,val=0,unsafe=0;
  while(left.length){let bi=-1;
    if(fixed){bi=0}
    if(!fixed&&useNear){let nd=near;left.forEach((r,i)=>{const s=travel(key,r,true),tr=travel(key,r,false,true);if(s<nd&&isFinite(tr)&&stopSafe(r,tm+tr,svc)&&r.age+tm+tr<CFG.plan.life){nd=s;bi=i}})}
    if(bi<0){let bs=-Infinity;left.forEach((r,i)=>{const tr=travel(key,r);if(!isFinite(tr))return;let sc=score(r,tr,tm);if(!stopSafe(r,tm+tr,svc))sc=sc>0?sc*.02:sc-1e5;if(sc>bs){bs=sc;bi=i}})}
    if(bi<0)break;const r=left.splice(bi,1)[0],tr=travel(key,r,false,true);if(!isFinite(tr)){if(fixed)continue;break}tm+=tr;
    const safe=stopSafe(r,tm,svc),dl=r.deadlineAbs-simT;if(!safe)unsafe++;
    // modeled value of this stop: people x survival decay, zero if it expires first, reduced if the hazard got there first
    if(r.age+tm<CFG.plan.life)val+=r.people*Math.exp(-tm/r.tau)*(safe?1:.3)*(tm>dl?(disaster=='wildfire'?0:.4):1);
    tm+=svc;ord.push(r);keys.push(key);key=r.id}
  return{ord,val,keys,unsafe}}
// rescue-priority score: people x survival decay / (travel + 3); hazard deadlines and old reports push a stop up the list
const priScore=(r,tr,tm)=>{if(r.age+tm+tr>CFG.plan.life)return -1e6+r.people;const dl=r.deadlineAbs-simT-tm-tr;
  let s=r.people*Math.exp(-(tm+tr)/r.tau)/(tr+3)*(1+CFG.learn.age*learn.urg*(r.age/CFG.plan.life)**2);
  if(isFinite(dl))s*=dl<0?(disaster=='wildfire'?.05:.5):1+60/Math.max(10,dl); // about to be overrun: go now
  return s};
function planAir(from,open,fixedOrder){const pos=k=>k==='start'?from:reports.find(r=>r.id===k);
  // near=true: raw distance m (near rule). raw=true: real flight time. otherwise risk + path exposure weighted.
  const travel=(k,r,nearQ,raw)=>{const p=pos(k),d=Math.hypot(r.x-p.x,r.z-p.z);if(nearQ)return d;const tt=d/cruiseAir();return raw?tt:tt*airRisk(r.x,r.z)*(1+3*pathExposure(p.x,p.z,r.x,r.z,tt))};
  if(fixedOrder)return chain(fixedOrder,travel,'start',0,false,priScore,SERVICE_AIR(),true);
  return{a:chain(open,travel,'start',CFG.plan.near,true,priScore,SERVICE_AIR()),b:chain(open,(k,r,n)=>travel(k,r,n,true),'start',CFG.plan.near,false,(r,tr)=>-tr,SERVICE_AIR())}}
function planGround(from,open,fixedOrder){updateBlocked();const sn=nearestNode(from.x,from.z),tables={start:dijkstra(sn,BLOCK)};for(const r of open)tables[r.id]=dijkstra(r.b.curb,BLOCK);
  const travel=(k,r,nearQ)=>{const d=tables[k].d[r.b.curb];return nearQ?d:d/CFG.truck.avg/(1+CFG.learn.speed*.8*learn.urg)};
  if(fixedOrder)return chain(fixedOrder,travel,'start',0,false,priScore,SERVICE_GROUND(),true);
  const res={a:chain(open,travel,'start',CFG.plan.nearRoad,true,priScore,SERVICE_GROUND()),b:chain(open,travel,'start',CFG.plan.nearRoad,false,(r,tr)=>-tr,SERVICE_GROUND()),tables};
  res.unreach=open.filter(r=>!isFinite(tables.start.d[r.b.curb])).length;return res}
function pathNodes(table,dst){const out=[];for(let v=dst;v>=0;v=table.prev[v])out.push(v);return out.reverse()}
function replan(){const open=reports.filter(r=>!r.done&&!r.claimed),from=unitPos();for(const r of open)r.deadlineAbs=simT+deadline(r);
  const pa=planAir(from,open),pg=planGround(from,open);est.air=pa.a.val;est.ground=pg.a.val;est.unreach=pg.unreach;
  const p=mode=='air'?pa:pg;route=p.a.ord;routeBase=p.b.ord;
  // commitment: once close to the current target, keep it first (no last-second flip-flopping) unless it became unsafe or unreachable
  const cur=open.find(r=>r.id===(mode=='air'?tgtId:gFor));if(cur&&route.includes(cur)&&route[0]!==cur){const U=unitPos(),d=mode=='air'?Math.hypot(cur.x-U.x,cur.z-U.z):(isFinite(pg.tables.start.d[cur.b.curb])?pg.tables.start.d[cur.b.curb]:1e9);
    if(d<200&&stopSafe(cur,d/(mode=='air'?cruiseAir():CFG.truck.avg),mode=='air'?SERVICE_AIR():SERVICE_GROUND()))route=[cur,...route.filter(r=>r!==cur)]}est.a=p.a.val;est.b=p.b.val;est.unsafe=p.a.unsafe;
  // user-drawn route: fly/drive the order you clicked on the map; compare its modeled value to the optimizer's
  userRoute=userRoute.filter(id=>open.some(r=>r.id===id));est.user=null;
  if(userRoute.length){const ord=userRoute.map(id=>open.find(r=>r.id===id));const u=mode=='air'?planAir(from,open,ord):planGround(from,open,ord);est.user=u.val;route=u.ord}
  legs=[];legsBase=[];if(mode=='ground'){const mk=ch=>{const out=[];let k='start';for(const r of ch){const tb=pg.tables[k];if(tb&&isFinite(tb.d[r.b.curb]))out.push(pathNodes(tb,r.b.curb));k=r.id}return out};legs=mk(route);legsBase=mk(routeBase)}}
function reach(r,how){closeReport(r);stats.saved+=r.people;learn.urg=Math.max(0,learn.urg-CFG.learn.perReach);say('+'+r.people+' '+how);shake=Math.max(shake,.5);planT=0;sfx('chime');radio('crew reached '+r.people+' people (estimate) at '+(r.b.n||'a '+r.b.t+' building')+', heading to the next stop')}
function simTick(dt){spawnT+=dt;const every=disaster=='none'?CFG.plan.spawnEvery*2:CFG.plan.spawnEvery;
  if(disaster!='none'&&spawnT>every&&reports.filter(r=>!r.done).length<CFG.plan.maxOpen&&!(disaster=='earthquake'&&!Q.main)){spawnT=0;addReport()} // normal day: free roam, nobody needs help
  for(const r of reports){if(r.done)continue;r.age+=dt;r.m.material.opacity=.3+.15*Math.sin(t*4+r.id);
    if(r.b.hs<.98){r.y=bH(r.b)+6;r.m.position.y=r.y+40}
    if(r.age>CFG.plan.life&&!r.claimed){closeReport(r);stats.missed+=r.people;
      // adaptive urgency: a miss raises it, more so when many people were missed
      learn.urg=Math.min(1,learn.urg+CFG.learn.perMiss*(.6+.4*Math.min(1,r.people/60)));say('report lost: urgency up');sfx('lost');radio('a call with '+r.people+' people expired before anyone reached it; autopilot urgency raised',true);continue}
    if(r.claimed)continue;
    if(mode=='air'&&!auto&&Math.hypot(P.x-r.x,P.z-r.z)<24&&P.y>r.y-5&&P.y<r.y+80){reach(r,'reached');pickupRoof(r)}
    if(mode=='ground'&&!auto&&r.b.stop&&Math.hypot(TR.x-r.b.stop.x,TR.z-r.b.stop.z)<11&&Math.abs(TR.spd)<9){reach(r,'reached');pickupDoor(r)}}
  planT-=dt;if(planT<=0){planT=WSRC==='houston'?1:.5;replan()}}

// ---------- pickup animation (visual only): faster than before ----------
const FIG=[],fBody=new THREE.CylinderGeometry(.32,.38,1.1,8),fHead=new THREE.SphereGeometry(.3,8,6),fMat=new THREE.MeshLambertMaterial({color:0xffd27a,emissive:0x553311});
for(let i=0;i<40;i++){const g=new THREE.Group(),bd=new THREE.Mesh(fBody,fMat),hd=new THREE.Mesh(fHead,fMat);bd.position.y=.55;hd.position.y=1.4;g.add(bd,hd);g.visible=false;g.userData={from:V(),d:0,u:0,walk:false,dur:1};FIG.push(g);SC.add(g)}
const nFig=r=>Math.min(8,Math.max(3,Math.ceil(r.people/12))); // one figure per ~12 people, 3 to 8
function spawnFigs(n,place,walk,dur){let k=0;for(const g of FIG){if(k>=n)break;if(g.visible)continue;const u=g.userData;place(u.from,k);u.d=k*.07;u.u=0;u.walk=walk;u.dur=dur;g.position.copy(u.from);g.scale.setScalar(.75);g.visible=true;k++}return n*.07+dur+.15}
const pickupRoof=r=>{const pp=padPoint(r.b);return spawnFigs(nFig(r),v=>v.set(pp[0]+(Math.random()-.5)*Math.min(r.b.hx,12),bH(r.b),pp[1]+(Math.random()-.5)*Math.min(r.b.hz,12)),false,.75)};
const pickupDoor=r=>spawnFigs(nFig(r),v=>v.set(r.b.door.x+(Math.random()-.5)*3+r.b.face[0]*.8,0,r.b.door.z+(Math.random()-.5)*3+r.b.face[1]*.8),true,.95);
function figTick(dt){const U=mode=='air'?P:V(TR.x,0,TR.z);for(const g of FIG){if(!g.visible)continue;const u=g.userData;
  if(u.d>0){u.d-=dt;g.position.copy(u.from);g.position.y+=Math.abs(Math.sin(t*10+u.from.x))*.5;continue}
  u.u+=dt/u.dur;if(u.u>=1){g.visible=false;continue}const e=ease(u.u);g.position.lerpVectors(u.from,U,e);
  if(u.walk){g.position.y=Math.abs(Math.sin(u.u*18))*.25;g.lookAt(U.x,0,U.z);g.scale.setScalar(.75*(1-.6*Math.max(0,e-.7)/.3))}
  else{g.position.y+=Math.sin(Math.PI*u.u)*4;g.scale.setScalar(.75*(1-.75*e))}}}

// =====================================================================
// aerial autopilot: go -> approach (smooth glide onto the roof) -> board -> lift -> go
// =====================================================================
let ap='go',apT=0,landR=null,tgtId=0,tgtT=0,stuckClimb=0;const lastWind=V();
const pad=new THREE.Mesh(new THREE.RingGeometry(2.6,3.4,32),new THREE.MeshBasicMaterial({color:0xffb347,transparent:true,opacity:.8,side:2,depthWrite:false}));pad.rotation.x=-Math.PI/2;pad.visible=false;SC.add(pad);
const parked=()=>mode=='air'&&auto&&(ap=='approach'||ap=='board'||ap=='lift');
const AP={p0:V(),c1:V(),c2:V(),p3:V(),tab:[],len:1,dur:1,tau:0,s0:30,a:10,tc:0};
const AP_BRAKE=16,LIFT_T=.9,BOARD_PAD=.2;
const bez=(u,o)=>{const a=1-u;return o.set(0,0,0).addScaledVector(AP.p0,a*a*a).addScaledVector(AP.c1,3*a*a*u).addScaledVector(AP.c2,3*a*u*u).addScaledVector(AP.p3,u*u*u)};
function curveClear(r){const v=V();let worst=0;for(let i=1;i<=30;i++){bez(i/30,v);forNear(v.x,v.z,b=>{if(b!==r.b&&v.y<bH(b)+6&&bDist(b,v.x,v.z)<6)worst=Math.max(worst,bH(b)+18);return false})}return worst}
function tryApproach(r){const pp=padPoint(r.b),pad3=V(pp[0],bH(r.b)+1.2,pp[1]),h=V(Math.sin(yaw),0,-Math.cos(yaw)),dh=Math.hypot(pad3.x-P.x,pad3.z-P.z);
  AP.p0.copy(P);AP.p3.copy(pad3);AP.s0=Math.max(spd,22);let hi=Math.max(P.y,pad3.y+14);
  for(let k=0;k<5;k++){AP.c1.copy(P).addScaledVector(h,Math.max(20,dh*.45));AP.c1.y=hi;AP.c2.copy(pad3);AP.c2.y=Math.max(pad3.y+14,hi*.55+pad3.y*.45);
    if(!curveClear(r)){buildTable();
      // safety gate: will the hazard be on this roof while we glide in, board and lift off? if so, don't commit
      if(dangerAt(pad3.x,pad3.z,AP.dur+3+LIFT_T)>=.75){r.hold=simT+6;stats.unsafeSkips++;planT=0;return false}
      landR=r;r.claimed=true;ap='approach';AP.tau=0;pad.position.set(pad3.x,pad3.y-1.05,pad3.z);pad.visible=true;return true}
    hi=Math.max(hi+12,curveClear(r))}
  return false}
function buildTable(){const a=V(),b=V();AP.tab=[0];let L=0;bez(0,a);for(let i=1;i<=48;i++){bez(i/48,b);L+=a.distanceTo(b);AP.tab.push(L);a.copy(b)}AP.len=L;
  // speed profile: keep cruising at s0, then brake at AP_BRAKE m/s^2 so speed hits zero exactly on the pad
  const s0=AP.s0;let br=AP_BRAKE,db=s0*s0/(2*br);if(db>L){db=L;br=s0*s0/(2*L)}AP.a=br;AP.tc=(L-db)/s0;AP.dur=AP.tc+s0/br}
function uAtLen(s){const tb=AP.tab;let i=1;while(i<tb.length-1&&tb[i]<s)i++;const f=(s-tb[i-1])/Math.max(tb[i]-tb[i-1],1e-6);return(i-1+clamp(f,0,1))/48}
function abortLanding(why){radio('landing aborted: '+why,true);if(landR){landR.claimed=false;landR.hold=simT+6;landR=null}ap='lift';apT=0;AP.p3.copy(P);pad.visible=false;say(why)}
function approachTick(dt){AP.tau=Math.min(1,AP.tau+dt/AP.dur);const tt=AP.tau*AP.dur,tb=Math.max(0,tt-AP.tc);
  const dist=Math.min(AP.len,AP.s0*Math.min(tt,AP.tc)+AP.s0*tb-.5*AP.a*tb*tb),u=uAtLen(dist),prev=P.clone();bez(u,P);
  const tng=P.clone().sub(prev),hl=Math.hypot(tng.x,tng.z);spd=Math.max(0,AP.s0-AP.a*tb);vel.copy(tng).divideScalar(Math.max(dt,1e-4));
  if(hl>.02){const ny=Math.atan2(tng.x,-tng.z),dy=wrap(ny-yaw);yaw+=dy;roll+=(clamp(-dy*14,-.6,.6)-roll)*Math.min(1,dt*4)}
  pitch+=((hl>.02?clamp(Math.atan2(tng.y,hl),-.45,.25)*Math.min(1,spd/20):0)-pitch)*Math.min(1,dt*4);
  if(dangerAt(AP.p3.x,AP.p3.z,(1-AP.tau)*AP.dur+3)>=.75&&AP.tau<.9)abortLanding('landing aborted: hazard incoming');
  else if(AP.tau>=1){P.copy(AP.p3);spd=0;vel.set(0,0,0);ap='board';reach(landR,'aboard');apT=pickupRoof(landR)*(1-CFG.learn.board*learn.urg)}}
function liftTick(dt){apT+=dt/LIFT_T;const e=ease(Math.min(1,apT));P.y=AP.p3.y+22*e;pitch*=.9;roll*=.9;spd=6+16*e;vel.set(0,22/LIFT_T,0);
  const r=route[0];if(r){const want=Math.atan2(r.x-P.x,-(r.z-P.z));yaw+=clamp(wrap(want-yaw),-2.8*dt,2.8*dt)}
  if(apT>=1){ap='go';pad.visible=false;landR=null;spd=22}}
function parkTick(dt){if(ap=='approach')approachTick(dt);else if(ap=='board'){apT-=dt;if(dangerAt(P.x,P.z,2)>=.75){apT=0;say('hazard close: lifting off')}if(apT<=0){ap='lift';apT=0;AP.p3.copy(P)}}else liftTick(dt);bat-=dt*.15}
// cruise steering: returns stick inputs for the normal flight model
function autoSteer(dt){let r=route.find(x=>!(x.hold>simT))||null,W=lastWind;
  if(r&&r.id!==tgtId){tgtId=r.id;tgtT=0}
  let ax,az;if(r){ax=r.x;az=r.z}else{ax=Math.cos(t*.1)*260;az=Math.sin(t*.1)*260}
  // hazard avoidance: push the aim point away from the forecast tornado position (3 s ahead), and away from the fire front
  if(disaster=='tornado'){const px=T.x+T.vx*3,pz=T.z+T.vz*3,tx=P.x-px,tz=P.z-pz,td=Math.hypot(tx,tz)||1;if(td<CFG.tornado.avoid){const k=(CFG.tornado.avoid-td)*2;ax+=tx/td*k;az+=tz/td*k}}
  const dx=ax-P.x,dz=az-P.z,dh=Math.hypot(dx,dz)||1,ux=dx/dh,uz=dz/dh;
  if(r&&Math.hypot(r.x-P.x,r.z-P.z)<160)tgtT+=dt; // watchdog clock only runs while close to the target
  // altitude: stay above the target roof and anything in the corridor ahead; wildfire: stay high over fire and smoke
  const f=fwd(),LK=70+spd*2.2;let ay=r?Math.max(bH(r.b)+35,80):120;
  for(let s=10;s<=LK+100;s+=14){const sx=P.x+ux*s,sz=P.z+uz*s;forNear(sx,sz,b=>{if((!r||b!==r.b)&&bDist(b,sx,sz,30)<22)ay=Math.max(ay,bH(b)+32);return false});
    if(s<=LK){const fx=P.x+f.x*s,fz=P.z+f.z*s;forNear(fx,fz,b=>{if((!r||b!==r.b)&&bDist(b,fx,fz,30)<16)ay=Math.max(ay,bH(b)+32);return false})}
    if(disaster=='wildfire'&&fireArrival(sx,sz)<20&&(!r||Math.hypot(r.x-sx,r.z-sz)>60))ay=Math.max(ay,130)}
  if(stuckClimb>0){stuckClimb-=dt;ay+=60}ay=Math.min(ay,CFG.air.ceiling-15);
  // wind compensation: point the nose so (air velocity + wind) tracks the target
  const cp=CFG.air.coupling[disaster]??1,sp=Math.max(spd,20),hx=ux*sp-W.x*cp,hz=uz*sp-W.z*cp,want=Math.atan2(hx,-hz);
  let mx=clamp(wrap(want-yaw)*1.8,-1,1),my=-clamp(Math.atan2(ay-P.y,Math.max(dh,30)),-.6,.6)/.95,sp2=cruiseAir();
  let tight=false;forNear(P.x,P.z,b=>{if(P.y<bH(b)+12&&bDist(b,P.x,P.z)<18){tight=true;return true}return false});
  if(tight){my=-.63;sp2=Math.min(sp2,24)}
  if(r&&dh<260)sp2=Math.min(sp2,24+dh*.12);
  // boost discipline: dash only on a long, clear, level leg with battery to spare (each autopilot dash costs 1.5% battery, 4.5 s apart)
  if(dashCd<=0&&r&&dh>220&&Math.abs(wrap(want-yaw))<.25&&!tight&&Math.abs(ay-P.y)<35&&spd<80&&bat>20&&!(disaster=='tornado'&&Math.hypot(P.x-T.x,P.z-T.z)<CFG.tornado.avoid+100)){spd+=28;dashCd=3;bat-=1.2;shock();caKick=.4;sfx('whoosh')}
  const appR=90+CFG.learn.approach*learn.urg;
  if(r&&dh<appR&&P.y>bH(r.b)+4)tryApproach(r);
  else if(r&&dh<160&&tgtT>14){stats.stuck++;learn.urg=Math.min(1,learn.urg+.08);tgtT=0;if(!tryApproach(r))stuckClimb=3;say('circling: retrying approach')}
  return{mx,my,sp:sp2}}
// soft obstacle field: gently pushes away from walls before contact and lifts over roofs
function softAvoid(dt){forNear(P.x,P.z,b=>{if(landR&&b===landR.b)return false;if(P.y>=bH(b)+8)return false;const c=bClosest(b,P.x,P.z);if(c.d<12){
  if(!c.inside){P.x+=c.nx*(12-c.d)*2*dt;P.z+=c.nz*(12-c.d)*2*dt}P.y+=(bH(b)+8-P.y)*1.2*dt}return false})}
// tornado pull: inward plus swirl, strongest at the center
function tornadoPull(dt){if(disaster!='tornado')return;const tx=T.x-P.x,tz=T.z-P.z,td=Math.hypot(tx,tz)||1;if(td<CFG.tornado.pull){const k=1-td/CFG.tornado.pull;P.x+=(tx*26-tz*18)/td*k*dt;P.z+=(tz*26+tx*18)/td*k*dt;shake=Math.max(shake,k*.8);bat-=dt*k*3}}
function airTick(dt,W){
  if(parked()){parkTick(dt);return}
  if(!sw){const dz=.08;let mx=Math.abs(M.x)<dz?0:M.x,my=Math.abs(M.y)<dz?0:M.y,apS=null;if(auto){const o=autoSteer(dt);mx=o.mx;my=o.my;apS=o.sp}
    yaw+=mx*1.7*dt;pitch+=((-my*.95)-pitch)*Math.min(1,dt*3.2);roll+=((-mx*.9)-roll)*Math.min(1,dt*4);
    let target=auto?apS:K.KeyW?CFG.air.fast:K.KeyS?CFG.air.slow:CFG.air.cruise;if(bat<=0)target=Math.min(target,22);
    spd+=(target-spd)*dt*(spd>target?.35:.9);spd+=-Math.sin(pitch)*38*dt;spd=clamp(spd,8,CFG.air.max);
    const f=fwd();vel.copy(f).multiplyScalar(spd);vel.y-=Math.max(0,1-spd/22)*9;vel.addScaledVector(W,CFG.air.coupling[disaster]??1);
    const old=P.clone();P.addScaledVector(vel,dt);tornadoPull(dt);
    // autopilot safety net: never step into a wall. cancel the horizontal move and climb instead (counted as a "guard")
    if(auto){let hitB=false;forNear(P.x,P.z,b=>{if(P.y<bH(b)+1.5&&bDist(b,P.x,P.z)<1.6){hitB=true;return true}return false});
      if(hitB){P.x=old.x;P.z=old.z;P.y=Math.max(P.y,old.y)+10*dt;spd*=.95;stats.guards++}softAvoid(dt)}
    bat-=dt*(.12+Math.max(0,-W.dot(f))*.03+(K.KeyW?.15:0))}
  else{vel.y-=24*dt;vel.addScaledVector(W,dt*.3);P.addScaledVector(vel,dt);
    const n=P.clone().sub(sw),d=n.length();if(d>swL){n.divideScalar(d);P.copy(sw).addScaledVector(n,swL);vel.addScaledVector(n,-Math.max(0,vel.dot(n)))}
    yaw=Math.atan2(vel.x,-vel.z);pitch=Math.asin(clamp(vel.y/Math.max(vel.length(),1),-1,1));spd=vel.length();rope.geometry.setFromPoints([P,sw]);roll+=(-.5-roll)*dt*3;tornadoPull(dt)}
  // collisions: slide and soft-bounce off walls, land on roofs
  forNear(P.x,P.z,b=>{const h=bH(b);if(P.y>=h+1.2)return false;const c=bClosest(b,P.x,P.z);if(c.d>=1.2)return false;
    const top=h+1.2-P.y;if(c.inside&&top<2.5&&top<c.dist){P.y=h+1.2;return false}
    const push=c.inside?c.dist+1.2:1.2-c.d;P.x+=c.nx*push;P.z+=c.nz*push;const vn=vel.x*c.nx+vel.z*c.nz;if(vn<0){vel.x-=1.2*vn*c.nx;vel.z-=1.2*vn*c.nz}
    spd*=.7;shake=.7;if(t-(stats._ca||-9)>1){stats.crashes++;sfx('thud')}stats._ca=t;if(sw)release();return false});
  if(P.y<3){P.y=3;spd*=.97}if(P.y>CFG.air.ceiling)P.y=CFG.air.ceiling;P.x=clamp(P.x,-E-60,E+60);P.z=clamp(P.z,-E-60,E+60)}

// =====================================================================
// truck: manual driving + road autopilot (Dijkstra path, pure pursuit, brake for corners, cars and the stop)
// =====================================================================
const gAim=V();let gs='drive',gT=0,gPath=[],gFor=0,gRe=0,gStuck=0,gRev=0,gRevS=1,gUT=0,gBlockT=0;
function placeTruck(x,z){const ei=nearestEdge(x,z),e=EDGES[ei];if(!e)return;const A=NODES[e.a],Bn=NODES[e.b];const n=Math.hypot(A.x-x,A.z-z)<Math.hypot(Bn.x-x,Bn.z-z)?A:Bn,o=n===A?Bn:A;
  TR.x=n.x;TR.z=n.z;TR.yaw=Math.atan2(o.x-n.x,-(o.z-n.z));TR.spd=0;gs='drive';gPath=[];gFor=0}
// no reachable call and the truck is sitting in floodwater: drive (wading if needed) to the nearest dry road node and wait there
let ESC=null,escT=-9;
function rubbleRep(){ // earthquake: every call is cut off by rubble. Pick the nearest one and crawl through the blocked roads (speed is capped over rubble).
  if(ESC&&ESC.rub&&!ESC.done&&simT-escT<3)return ESC;const open=reports.filter(r=>!r.done&&!r.claimed&&r.b.stop);if(!open.length)return null;escT=simT;
  const eb=new Uint8Array(EDGES.length);for(let e=0;e<EDGES.length;e++)eb[e]=EDGES[e].dead?1:BLOCK[e]?2:0;const tb=dijkstra(nearestNode(TR.x,TR.z),eb);let best=null,bd=Infinity;
  for(const r of open){const d=tb.d[r.b.curb];if(isFinite(d)&&d<bd){bd=d;best=r}}if(!best)return null;for(const x of reports)x.blk=null;best.blk=eb;best.rub=true;if(!ESC||!ESC.rub)say('roads blocked: crawling over rubble');return ESC=best}
function escapeRep(){if(disaster=='earthquake')return rubbleRep();if(disaster!='flood'&&disaster!='hurricane')return null;if(floodDepth(TR.x,TR.z)<.12&&!ESC)return null;
  if(ESC&&simT-escT<4)return ESC;escT=simT;const dry=n=>floodDepth(n.x,n.z)<.08;if(floodDepth(TR.x,TR.z)<.12){ESC=null;return null}
  const eb=new Uint8Array(EDGES.length);for(let e=0;e<EDGES.length;e++)eb[e]=EDGES[e].dead?1:BLOCK[e]==1?2:BLOCK[e];
  const tb=dijkstra(nearestNode(TR.x,TR.z),eb);let best=-1,bd=Infinity;for(let i=0;i<NODES.length;i++)if(isFinite(tb.d[i])&&tb.d[i]<bd&&dry(NODES[i])){bd=tb.d[i];best=i}
  if(best<0){ESC=null;return null}const n=NODES[best];if(!ESC)say('flooded in: heading to dry ground');return ESC={id:-9,esc:true,hold:0,blk:eb,b:{curb:best,stop:{x:n.x,z:n.z}}}}
function truckPath(r){const tb=dijkstra(r.b.curb,r.blk||BLOCK),hx=Math.sin(TR.yaw),hz=-Math.cos(TR.yaw),e=EDGES[nearestEdge(TR.x,TR.z)];let best=-1,bc=Infinity;
  // start candidates: both ends of the road we're on, plus nodes straight ahead (within ~17 deg of our heading, < 80 m).
  // Turning toward a node off our heading costs extra, more at speed, so we never try to cut across a block.
  const cand=new Set([e.a,e.b]);{const A=NODES[e.a],Bn=NODES[e.b],fwdN=((Bn.x-A.x)*hx+(Bn.z-A.z)*hz)>0?e.b:e.a;let cur=fwdN,prev=fwdN===e.b?e.a:e.b,run=0;
    while(run<80){const C0=NODES[cur],P0=NODES[prev],dx=C0.x-P0.x,dz=C0.z-P0.z,l=Math.hypot(dx,dz)||1;let nxt=-1;   // follow the same road forward while it stays straight
      for(const [v] of C0.adj){if(v===prev)continue;const V2=NODES[v],ex=V2.x-C0.x,ez=V2.z-C0.z,el=Math.hypot(ex,ez)||1;if((dx*ex+dz*ez)/(l*el)>.95){nxt=v;break}}
      if(nxt<0)break;run+=Math.hypot(NODES[nxt].x-C0.x,NODES[nxt].z-C0.z);prev=cur;cur=nxt;cand.add(cur)}}
  for(const i of cand){const n=NODES[i],dx=n.x-TR.x,dz=n.z-TR.z,d=Math.hypot(dx,dz);if(!isFinite(tb.d[i]))continue;const cs=d>3?(dx*hx+dz*hz)/d:1;
    const c=d+tb.d[i]+(cs<-.2?45:0)+(cs<.955?20+Math.abs(TR.spd)*2.5:0);if(c<bc){bc=c;best=i}}
  if(best<0)return null;const out=[];for(let v=best;v>=0;v=tb.prev[v])out.push(v);return out}
const laneOf=(a,b)=>{let w=CFG.truck.lane*2;for(const [v,l,ei] of NODES[a].adj)if(v===b){w=EDGES[ei].w;break}return Math.min(CFG.truck.lane,w*.25)};
function groundAuto(dt){let r=route.find(x=>!(x.hold>simT))||null;if(r){if(r.blk)r.blk=null}else r=escapeRep();
  if(gs=='board'){gT-=dt;TR.spd*=Math.pow(.01,dt);return{st:0,vt:0}}
  if(gRev>0){gRev-=dt;return{st:-gRevS,vt:-4}}
  if(!r||!r.b.stop)return{st:0,vt:0};
  gRe-=dt;if(r.id!==gFor||gRe<=0){gFor=r.id;gRe=2;const p=truckPath(r);gPath=p||[]}
  // polyline: path nodes shifted into the right-hand lane, then the curb stop point
  const pts=[];for(let i=0;i<gPath.length;i++){const n=NODES[gPath[i]],m=NODES[gPath[Math.min(i+1,gPath.length-1)]],p=NODES[gPath[Math.max(i-1,0)]];
    let dx=m.x-p.x,dz=m.z-p.z;const l=Math.hypot(dx,dz)||1;dx/=l;dz/=l;const ln=laneOf(gPath[Math.max(i-1,0)],gPath[Math.min(i+1,gPath.length-1)])||CFG.truck.lane;pts.push([n.x-dz*ln,n.z+dx*ln])}
  pts.push([r.b.stop.x,r.b.stop.z]);
  // start the steering line on the road we're on, in the right-hand lane, so the truck tracks its lane until the first path node
  {const ce=EDGES[nearestEdge(TR.x,TR.z)],A=NODES[ce.a],Bn=NODES[ce.b],ex=Bn.x-A.x,ez=Bn.z-A.z,l2=ex*ex+ez*ez||1,u=clamp(((TR.x-A.x)*ex+(TR.z-A.z)*ez)/l2,0,1),px=A.x+ex*u,pz=A.z+ez*u;
   const tx=pts[0][0]-px,tz=pts[0][1]-pz,sg=(tx*ex+tz*ez)>=0?1:-1,el=Math.sqrt(l2),dx=sg*ex/el,dz=sg*ez/el,ln=Math.min(CFG.truck.lane,ce.w*.25);
   if(Math.hypot(tx,tz)>3)pts.unshift([px-dz*ln,pz+dx*ln])}
  if(pts.length==1)pts.unshift([TR.x,TR.z]);
  let bi=0,bu=0,bd=1e18;for(let i=0;i<pts.length-1;i++){const a=pts[i],b=pts[i+1],dx=b[0]-a[0],dz=b[1]-a[1],l2=dx*dx+dz*dz||1,u=clamp(((TR.x-a[0])*dx+(TR.z-a[1])*dz)/l2,0,1),d=(a[0]+dx*u-TR.x)**2+(a[1]+dz*u-TR.z)**2;if(d<bd){bd=d;bi=i;bu=u}}
  const segL=i=>Math.hypot(pts[i+1][0]-pts[i][0],pts[i+1][1]-pts[i][1]);
  const Ld=3.5+Math.abs(TR.spd)*.25;let rem=Ld+segL(bi)*bu,ax=pts[pts.length-1][0],az=pts[pts.length-1][1];
  for(let i=bi;i<pts.length-1;i++){const l=segL(i);if(l>=rem){ax=pts[i][0]+(pts[i+1][0]-pts[i][0])*rem/l;az=pts[i][1]+(pts[i+1][1]-pts[i][1])*rem/l;break}rem-=l}
  let ds=-segL(bi)*bu;for(let i=bi;i<pts.length-1;i++)ds+=segL(i);ds+=Math.sqrt(bd);
  const err=wrap(Math.atan2(ax-TR.x,-(az-TR.z))-TR.yaw);let vt=cruiseTruck()+(nitroT>0?CFG.truck.nitro:0);gAim.set(ax,0,az);
  // corners measured from the truck itself, so the very next intersection counts too
  const cp=[[TR.x,TR.z]].concat(pts.slice(bi+1));let acc=0,cornerAt=Infinity;for(let i=1;i<cp.length-1;i++){const a=cp[i-1],b=cp[i],c=cp[i+1];acc+=Math.hypot(b[0]-a[0],b[1]-a[1]);const t1=Math.atan2(b[0]-a[0],b[1]-a[1]),t2=Math.atan2(c[0]-b[0],c[1]-b[1]);
    if(Math.abs(wrap(t2-t1))>.6){cornerAt=acc;vt=Math.min(vt,Math.sqrt(CFG.truck.corner**2+2*4.5*Math.max(0,acc-7))); /* corner speed, braking at 4.5 m/s^2 before it */break}if(acc>180)break}
  vt=Math.min(vt,Math.sqrt(2*6*Math.max(0,ds-1)));
  // cars in our corridor: brake behind them. If one blocks us for 1.5 s it pulls over to the curb.
  const hx=Math.sin(TR.yaw),hz=-Math.cos(TR.yaw);let blocker=null,bal=1e9;
  for(const c of CARS)for(const tp of [0,.8]){const dx=c.x+c.hx*c.v*tp-TR.x,dz=c.z+c.hz*c.v*tp-TR.z,al=dx*hx+dz*hz,lat=Math.abs(-dx*hz+dz*hx);if(!(c.ign>simT)&&al>0&&al<10+Math.abs(TR.spd)*.5&&lat<2.3&&al<bal){bal=al;blocker=c}} // now and where it will be in 0.8 s (2.3 m = truck + car half widths)
  if(blocker){vt=Math.min(vt,Math.max(0,(bal-6)*1.3));gBlockT+=dt;if(gBlockT>1.5)blocker.pull=1;if(gBlockT>3){blocker.ign=simT+6;gBlockT=0}}else gBlockT=0; // still stuck after 3 s: squeeze past it
  vt=Math.min(vt,4+22*Math.max(0,1-Math.abs(err)/.9)); // big heading error (sharp re-route): slow down so we don't swing wide
  // nitro discipline: only on a long clear straight (no corner, stop or car within 170 m), already moving, fuel to spare; 7 s apart
  if(nitroCd<=0&&nitroT<=0&&!blocker&&Math.abs(err)<.15&&Math.min(cornerAt,ds)>110&&TR.spd>8&&tbat>15){nitroT=CFG.truck.nitroT;nitroCd=4.5;tbat-=1;shock();caKick=.6;sfx('nitro')}
  if(Math.abs(err)>1.5){vt=Math.min(vt,4.5);gUT+=dt;if(gUT>4){gUT=0;gRev=1.3;gRevS=Math.sign(err)}}else gUT=0;
  const dStop=Math.hypot(r.b.stop.x-TR.x,r.b.stop.z-TR.z);
  if(r.esc){if(dStop<4)return{st:0,vt:0}}else if(dStop<3.2&&Math.abs(TR.spd)<2.5){gs='board';reach(r,'aboard');gT=pickupDoor(r)*(1-CFG.learn.board*learn.urg);return{st:0,vt:0}}
  if(Math.abs(TR.spd)<.8&&dStop>5&&!blocker){gStuck+=dt;if(gStuck>3){gStuck=0;gRev=1.4;gRevS=Math.sign(err)||1;gRe=0;stats.stuck++;learn.urg=Math.min(1,learn.urg+.05)}}else gStuck=Math.max(0,gStuck-dt);
  return{st:clamp(err*2.2,-1,1),vt}}
function truckTick(dt){let st,vt,brake=false;
  if(auto){if(gs=='board'&&gT<=0){gs='drive';gRe=0}const o=groundAuto(dt);st=o.st;vt=o.vt}
  else{st=Math.abs(M.x)<.06?0:clamp(M.x*1.4,-1,1);vt=nitroT>0?CFG.truck.max+CFG.truck.nitro:K.KeyW?CFG.truck.max:K.KeyS?-8:null;brake=!!K.Space}
  nitroT-=dt;nitroCd-=dt;
  // smooth throttle: proportional approach to the target speed, accel low-passed (no jerk), so it eases on and off the pedal
  let aT;if(vt===null)aT=-Math.sign(TR.spd)*Math.min(1.5,Math.abs(TR.spd)/Math.max(dt,.001));else aT=clamp((vt-TR.spd)*3.2,-CFG.truck.brake,CFG.truck.accel*(nitroT>0?2:1));
  TR.acc=lerp(TR.acc||0,aT,1-Math.exp(-dt*7));TR.spd+=TR.acc*dt;
  if(brake)TR.spd*=Math.pow(.05,dt);
  const ei=nearestEdge(TR.x,TR.z),onBridge=ei>=0&&EDGES[ei].bridge&&edgeDist(ei,TR.x,TR.z)<EDGES[ei].w/2+1,fd=onBridge?0:floodDepth(TR.x,TR.z);
  let cap=fd>1?2:fd>.4?6:99;if(disaster=='earthquake'&&ei>=0&&Q.rubble.has(ei))cap=Math.min(cap,5); // crawling over rubble
  if(riverDist(TR.x,TR.z)<0&&!onBridge)cap=3;if(tbat<=0)cap=Math.min(cap,10);TR.spd=clamp(TR.spd,-8,Math.min(cap,CFG.truck.max+CFG.truck.nitro));
  // steering wheel is rate-limited, and the turn rate falls with speed (about 11 m/s^2 sideways at most) instead of snapping
  TR.steer=(TR.steer||0)+clamp(st-(TR.steer||0),-dt*6,dt*6);const yr=TR.steer*Math.min(1.5,11/Math.max(4,Math.abs(TR.spd)))*clamp(Math.abs(TR.spd)/3,0,1)*Math.sign(TR.spd||1)*(brake?1.4:1);TR.yaw+=yr*dt;
  TR.x+=Math.sin(TR.yaw)*TR.spd*dt;TR.z+=-Math.cos(TR.yaw)*TR.spd*dt;TR.y=onBridge?1.3:riverDist(TR.x,TR.z)<0?-.8:0;
  if(disaster=='tornado'){const tx=T.x-TR.x,tz=T.z-TR.z,td=Math.hypot(tx,tz)||1;if(td<90){const k=1-td/90;TR.x+=tx/td*k*8*dt;TR.z+=tz/td*k*8*dt;shake=Math.max(shake,k*.6)}}
  // autopilot keeps clearance from walls (soft push), then hard collision: push out along the wall normal, lose speed
  forNear(TR.x,TR.z,b=>{const c=bClosest(b,TR.x,TR.z);if(auto&&!c.inside&&c.d<3.2&&c.d>1.6){TR.x+=c.nx*(3.2-c.d)*3*dt;TR.z+=c.nz*(3.2-c.d)*3*dt}
    if(c.inside||c.d<1.6){const push=c.inside?c.dist+1.6:1.6-c.d;TR.x+=c.nx*push;TR.z+=c.nz*push;TR.spd*=.4;shake=.6;if(t-(stats._ct||-9)>1){stats.crashes++;sfx('thud')}stats._ct=t;if(auto)gStuck=Math.max(gStuck,2.5)}return false});
  for(const c of CARS){if(Math.abs(c.x-TR.x)<2.4&&Math.abs(c.z-TR.z)<2.4&&Math.abs(c.y-.8-TR.y)<.6){stats.carHits++;if(!auto)TR.spd*=.85;c.pull=1;c.s+=Math.sign((c.x-TR.x)*c.hx+(c.z-TR.z)*c.hz||1)*6*dt}} // overlapping car gets nudged along its lane
  TR.x=clamp(TR.x,-E-20,E+20);TR.z=clamp(TR.z,-E-20,E+20);
  tbat-=dt*(.04+Math.abs(TR.spd)*.003);bat=Math.min(100,bat+3*dt); // truck fuel drains slowly; docked dragonfly recharges 3%/s
  // body motion: nose dips when braking, squats when accelerating, leans out of turns, small road bumps
  TR.odo=(TR.odo||0)+Math.abs(TR.spd)*dt;const kk=1-Math.exp(-dt*6);TR.pitch=lerp(TR.pitch||0,clamp(-(TR.acc||0)*.0045,-.07,.07),kk);TR.roll=lerp(TR.roll||0,clamp(-yr*TR.spd*.006,-.07,.07),kk);
  truck.position.set(TR.x,TR.y+Math.sin(TR.odo*1.9)*.022*clamp(Math.abs(TR.spd)/12,0,1)*(floodDepth(TR.x,TR.z)>.3?0:1),TR.z);truck.rotation.order='YXZ';truck.rotation.set(TR.pitch,Math.PI-TR.yaw,TR.roll);
  const blink=Math.sin(t*14)>0;sirenR.color.setHex(blink?0xff2a2a:0x400808);sirenB.color.setHex(blink?0x0a1440:0x2a6aff)}

// ---------- guide: where to go next (used by the 3D arrow and the on-screen marker) ----------
// air: the next stop's roof. ground: the next point along the road path (manual driving gets a path too).
let guideT=0;const guide={aim:V(),dst:V(),on:false,dist:0};
function guideTick(dt){const r=route.find(x=>!(x.hold>simT))||null;guide.on=!!r&&go&&disaster!='none';if(!guide.on)return;
  if(mode=='air'){const pp=padPoint(r.b);guide.dst.set(pp[0],bH(r.b)+4,pp[1]);guide.aim.copy(guide.dst);guide.dist=Math.hypot(pp[0]-P.x,pp[1]-P.z);return}
  guide.dst.set(r.b.stop.x,1,r.b.stop.z);
  if(auto&&gPath.length){guide.aim.set(gAim.x,1,gAim.z)}
  else{guideT-=dt;if(guideT<=0||r.id!==gFor){guideT=1;gFor=r.id;const p=truckPath(r);gPath=p||[]}
    let k=0;while(k<gPath.length-1&&Math.hypot(NODES[gPath[k]].x-TR.x,NODES[gPath[k]].z-TR.z)<12)k++;const n=gPath.length?NODES[gPath[k]]:null;guide.aim.set(n?n.x:r.b.stop.x,1,n?n.z:r.b.stop.z)}
  let d=0,px=TR.x,pz=TR.z;for(const n of gPath){d+=Math.hypot(NODES[n].x-px,NODES[n].z-pz);px=NODES[n].x;pz=NODES[n].z}guide.dist=gPath.length?d:Math.hypot(r.b.stop.x-TR.x,r.b.stop.z-TR.z)}
