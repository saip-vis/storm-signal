'use strict';
// =====================================================================
// ui.js: effects, post-processing, camera (with arrow-key orbit), labels, map (canvas or Google), menus,
//        live Houston data (via serve.py), input, main loop, boot
// =====================================================================

// ---------- effects: streaks, contrails, shockwave, slingshot rope ----------
const SN=240,sg=new THREE.BufferGeometry(),sp=new Float32Array(SN*6);for(let i=0;i<SN*6;i++)sp[i]=(Math.random()-.5)*160;
sg.setAttribute('position',new THREE.BufferAttribute(sp,3));const streaks=new THREE.LineSegments(sg,new THREE.LineBasicMaterial({color:0xdff6f4,transparent:true,opacity:0}));streaks.frustumCulled=false;SC.add(streaks);
const TL=12,trails=[0,1].map(()=>{const g=new THREE.BufferGeometry(),p=new Float32Array(TL*3),c=new Float32Array(TL*3);g.setAttribute('position',new THREE.BufferAttribute(p,3));g.setAttribute('color',new THREE.BufferAttribute(c,3));
  const l=new THREE.Line(g,new THREE.LineBasicMaterial({vertexColors:true,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));l.frustumCulled=false;SC.add(l);return{g,p,c,on:new Float32Array(TL)}});
function trailTick(){const on=mode=='air'&&(spd>50||sw)?1:0;[-1,1].forEach((sd,k)=>{const tr=trails[k],w=D.localToWorld(V(sd*2.75,.34,.14));tr.p.copyWithin(3,0,(TL-1)*3);tr.on.copyWithin(1,0,TL-1);tr.p[0]=w.x;tr.p[1]=w.y;tr.p[2]=w.z;tr.on[0]=on;
  for(let i=0;i<TL;i++){const far=i>0&&Math.hypot(tr.p[i*3]-tr.p[i*3-3],tr.p[i*3+1]-tr.p[i*3-2],tr.p[i*3+2]-tr.p[i*3-1])>25,a=far?0:tr.on[i]*(1-i/TL)*.7;if(far)tr.on[i]=0;tr.c[i*3]=a*.85;tr.c[i*3+1]=a*.95;tr.c[i*3+2]=a}tr.g.attributes.position.needsUpdate=tr.g.attributes.color.needsUpdate=true})}
const ring=new THREE.Mesh(new THREE.RingGeometry(.8,1,48),new THREE.MeshBasicMaterial({color:0xffd9a0,transparent:true,opacity:0,side:2,blending:THREE.AdditiveBlending,depthWrite:false}));SC.add(ring);let camHy=0;let ringT=1,caKick=0;
function shock(){ringT=0;ring.position.copy(mode=='air'?P:V(TR.x,1.5,TR.z))}
function ringTick(dt){if(ringT>=1){ring.visible=false;return}ringT+=dt/.45;ring.visible=true;ring.scale.setScalar(.5+ringT*26);ring.material.opacity=(1-ringT)*.85;ring.lookAt(C.position)}
const rope=new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(),V()]),new THREE.LineBasicMaterial({color:0xffb347}));rope.visible=false;rope.frustumCulled=false;SC.add(rope);
function grab(){if(sw||mode!='air')return;const f=fwd();let best=null,bs=1e9;
  for(const b of B){const pp=padPoint(b),a=V(pp[0],bH(b)+14,pp[1]),d=a.clone().sub(P),L=d.length();if(L<25||L>150)continue;if(d.clone().normalize().dot(f)<.15)continue;if(L<bs){bs=L;best=a}}
  if(best){sw=best;swL=bs;vel.copy(f).multiplyScalar(spd);rope.visible=true;sfx('swing');say('swing')}}
function release(){const s=vel.length(),up=vel.y>2;spd=Math.min(115,s*(up?1.38:1.12));yaw=Math.atan2(vel.x,-vel.z);pitch=Math.asin(clamp(vel.y/Math.max(s,1),-1,1))*.6;sw=null;rope.visible=false;shake=up?.9:.2;
  if(up){shock();slowT=.18;caKick=1;style++;sfx('whoosh')}say(up?'perfect release':'release')}

// ---------- post-processing + quality presets ----------
const QUAL={low:{pr:1,post:false,rain:500},medium:{pr:Math.min(devicePixelRatio,1.25),post:true,blur:false,rain:1000},high:{pr:Math.min(devicePixelRatio,2),post:true,blur:true,rain:1500}};
const hasPost=!!(THREE.EffectComposer&&THREE.UnrealBloomPass&&THREE.ShaderPass);let composer=null,bloom=null,finalPass=null;
const FinalShader={uniforms:{tDiffuse:{value:null},uSpeed:{value:0},uCA:{value:0},uVig:{value:0}},
  vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader:`uniform sampler2D tDiffuse;uniform float uSpeed,uCA,uVig;varying vec2 vUv;
  void main(){vec2 c=vUv-.5;float L=length(c);vec3 col=vec3(0.);
   for(int i=0;i<8;i++){float k=float(i)/7.;col+=texture2D(tDiffuse,.5+c*(1.-uSpeed*.05*k*L*2.)).rgb;}col/=8.;
   if(uCA>.001){col.r=mix(col.r,texture2D(tDiffuse,.5+c*(1.+uCA*.012)).r,.85);col.b=mix(col.b,texture2D(tDiffuse,.5+c*(1.-uCA*.012)).b,.85);}
   col=(col-.5)*1.06+.5;col*=vec3(1.03,1.,.97);
   float v=smoothstep(.9,.3,L*(1.+uVig*.5));col*=mix(1.,v,.45+uVig*.4);gl_FragColor=vec4(col,1.);}`};
function applyQuality(){const q=QUAL[set.quality]||QUAL.medium;R.setPixelRatio(q.pr);
  if(q.post&&hasPost){if(!composer){composer=new THREE.EffectComposer(R);composer.addPass(new THREE.RenderPass(SC,C));
      bloom=new THREE.UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight),.65,.45,.9);composer.addPass(bloom);finalPass=new THREE.ShaderPass(FinalShader);composer.addPass(finalPass)}
    composer.setPixelRatio&&composer.setPixelRatio(q.pr);composer.setSize(innerWidth,innerHeight)}
  $('vig').style.display=q.post&&hasPost?'none':'block'}
addEventListener('resize',()=>{R.setSize(innerWidth,innerHeight);C.aspect=innerWidth/innerHeight;C.updateProjectionMatrix();if(composer)composer.setSize(innerWidth,innerHeight)});

// ---------- camera: Roblox-style orbit. Arrows rotate/tilt around you, mouse wheel zooms, C resets. ----------
const CAM={yaw:0,pitch:0,zoom:1};
function camTick(dt){if(K.ArrowLeft)CAM.yaw+=1.8*dt;if(K.ArrowRight)CAM.yaw-=1.8*dt;if(K.ArrowUp)CAM.pitch=Math.min(1.15,CAM.pitch+1.2*dt);if(K.ArrowDown)CAM.pitch=Math.max(-.3,CAM.pitch-1.2*dt)}
addEventListener('wheel',e=>{CAM.zoom=clamp(CAM.zoom*(e.deltaY>0?1.1:1/1.1),.45,3)},{passive:true});

// ---------- floating labels ----------
const LB=[];for(let i=0;i<32;i++){const d=document.createElement('div');d.className='lb';document.body.appendChild(d);LB.push(d)}
const lv=V();
function labelTick(){C.updateMatrixWorld();const U=unitPos(),c=[],cap=mode=='air'?22:12,rng=mode=='air'?360:220;for(const b of B){const d=Math.hypot(b.x-U.x,b.z-U.z);if(d<rng)c.push([d,b])}c.sort((a,b)=>a[0]-b[0]);let n=0;
  for(const [d,b] of c){if(n>=cap)break;lv.set(b.x,bH(b)+8,b.z).project(C);if(lv.z>1||Math.abs(lv.x)>1.1||Math.abs(lv.y)>1.1)continue;
    const el=LB[n++],rep=reports.find(r=>!r.done&&r.b===b),txt=(WSRC==='houston'&&b.n&&d<200?'<span style="font-weight:400;color:#cfe">'+b.n+'</span><br>':'')+b.pop.toLocaleString()+(rep?'<i>'+rep.people.toLocaleString()+' need help</i>':'');
    el.style.display='block';el.style.left=((lv.x*.5+.5)*innerWidth).toFixed(0)+'px';el.style.top=((-lv.y*.5+.5)*innerHeight).toFixed(0)+'px';el.style.opacity=Math.max(.35,1-d/420).toFixed(2);if(el._t!==txt){el._t=txt;el.innerHTML=txt}}
  for(;n<32;n++)LB[n].style.display='none'}

// ---------- map: canvas (always) or Google basemap (live Houston with a key). Click reports to draw your own route. ----------
let mapView={X:null,Z:null,k:1};
function drawMap(){const cv=$('mc'),g=cv.getContext('2d'),W=E*2+80,k=cv.width/W,X=x=>(x+W/2)*k,Z=z=>(z+W/2)*k;mapView={X,Z,k,W};g.clearRect(0,0,cv.width,cv.height);
  // water: bayou + anything currently flooded on the modeled terrain
  const st=24;for(let x=-W/2;x<W/2;x+=st)for(let z=-W/2;z<W/2;z+=st){const rd=riverDist(x,z);if(rd<0){g.fillStyle='#1f4d63';g.fillRect(X(x),Z(z),st*k+1,st*k+1)}else if(waterLevel>0&&floodDepth(x,z)>0){g.fillStyle='rgba(60,140,200,'+Math.min(.6,.15+floodDepth(x,z)*.15)+')';g.fillRect(X(x),Z(z),st*k+1,st*k+1)}}
  g.fillStyle='#24432c';for(const p of PARKS){g.beginPath();p.poly.forEach((q,i)=>i?g.lineTo(X(q[0]),Z(q[1])):g.moveTo(X(q[0]),Z(q[1])));g.fill()}
  g.lineWidth=1;EDGES.forEach((e,i)=>{if(e.dead)return;const a=NODES[e.a],b=NODES[e.b];g.strokeStyle=BLOCK[i]==1?'rgba(255,90,74,.6)':BLOCK[i]==2?'rgba(255,190,80,.55)':'rgba(255,255,255,.1)';g.beginPath();g.moveTo(X(a.x),Z(a.z));g.lineTo(X(b.x),Z(b.z));g.stroke()});
  for(const b of B){g.fillStyle=b.hs<.6?'rgba(255,90,74,.5)':'rgba(120,200,190,'+(.1+.6*Math.min(1,b.pop/POPMAX))+')';g.beginPath();b.poly.forEach((q,i)=>i?g.lineTo(X(q[0]),Z(q[1])):g.moveTo(X(q[0]),Z(q[1])));g.fill()}
  drawHeat(g,X,Z,k,W);hazardMap(g,X,Z,k);
  const U=unitPos();
  const line=(list,lg,col,dash)=>{g.strokeStyle=col;g.setLineDash(dash);g.lineWidth=2.5;g.beginPath();g.moveTo(X(U.x),Z(U.z));
    if(mode=='ground'&&lg.length){for(const leg of lg)for(const n of leg)g.lineTo(X(NODES[n].x),Z(NODES[n].z))}else for(const r of list)g.lineTo(X(r.x),Z(r.z));g.stroke();g.setLineDash([])};
  line(routeBase,legsBase,'#7d8f93',[6,6]);line(route,legs,userRoute.length?'#7fd3ff':'#ffb347',[]);
  for(const r of reports){if(r.done)continue;const rr=6+Math.min(r.people,150)*.06;g.beginPath();g.arc(X(r.x),Z(r.z),rr,0,7);
    if(mode=='ground'&&!route.includes(r)&&!r.claimed){g.strokeStyle='#ff5a4a';g.lineWidth=2;g.stroke()}else{g.fillStyle=r.hold>simT?'#ff9a4a':'#ff5a4a';g.fill()}
    const ui=userRoute.indexOf(r.id);if(ui>=0){g.fillStyle='#7fd3ff';g.font='bold 14px sans-serif';g.fillText('#'+(ui+1),X(r.x)-6,Z(r.z)+24)}}
  g.fillStyle='#fff';g.font='bold 13px sans-serif';route.forEach((r,i)=>g.fillText((i+1)+': '+r.people,X(r.x)+11,Z(r.z)-8));
  g.save();g.translate(X(U.x),Z(U.z));g.rotate(mode=='air'?yaw:TR.yaw);g.fillStyle=mode=='air'?'#2fd3c2':'#ff8a2a';g.beginPath();g.moveTo(0,-11);g.lineTo(7,8);g.lineTo(-7,8);g.fill();g.restore()}
function toggleUserStop(id){const i=userRoute.indexOf(id);if(i>=0)userRoute.splice(i,1);else userRoute.push(id);planT=0;replan();if(mapOn)drawMap()}
$('mc').addEventListener('click',e=>{const cv=$('mc'),rc=cv.getBoundingClientRect(),px=(e.clientX-rc.left)*cv.width/rc.width,py=(e.clientY-rc.top)*cv.height/rc.height;let best=null,bd=18;
  for(const r of reports){if(r.done)continue;const d=Math.hypot(mapView.X(r.x)-px,mapView.Z(r.z)-py);if(d<bd){bd=d;best=r}}if(best)toggleUserStop(best.id)});
$('clearRoute').onclick=()=>{userRoute=[];planT=0;replan();if(mapOn)showMap(true)};
// Google basemap (live mode only, key served by serve.py from your local .env, never stored in the page)
let gmap=null,gObj={rep:new Map()};
async function loadGoogle(){if(gmap||!live.server)return;try{const cfg=await (await fetch('/api/config')).json();if(!cfg.googleKey)return;
  window.__gmInit=()=>{gmap=new google.maps.Map($('gmap'),{center:ORIGIN,zoom:15,disableDefaultUI:true,gestureHandling:'greedy',styles:[{elementType:'geometry',stylers:[{color:'#1b2a30'}]},{elementType:'labels.text.fill',stylers:[{color:'#e6efed'}]},{elementType:'labels.text.stroke',stylers:[{color:'#0b1418'},{weight:3}]},{featureType:'administrative.neighborhood',elementType:'labels.text.fill',stylers:[{color:'#a9c2bd'}]},{featureType:'road',elementType:'geometry',stylers:[{color:'#3a4d55'}]},{featureType:'road.highway',elementType:'geometry',stylers:[{color:'#5a6a70'}]},{featureType:'road',elementType:'labels.icon',stylers:[{visibility:'off'}]},{featureType:'water',elementType:'geometry',stylers:[{color:'#1f4d63'}]},{featureType:'poi',stylers:[{visibility:'off'}]},{featureType:'transit',stylers:[{visibility:'off'}]}]});
    gObj.route=new google.maps.Polyline({map:gmap,strokeColor:'#ffb347',strokeWeight:4});gObj.base=new google.maps.Polyline({map:gmap,strokeOpacity:0,icons:[{icon:{path:'M 0,-1 0,1',strokeOpacity:1,strokeColor:'#9aa',scale:3},offset:'0',repeat:'14px'}]});
    gObj.unit=new google.maps.Marker({map:gmap,icon:{path:google.maps.SymbolPath.FORWARD_CLOSED_ARROW,scale:6,fillColor:'#2fd3c2',fillOpacity:1,strokeWeight:1}});
    gObj.haz=new google.maps.Circle({map:gmap,strokeWeight:0,fillColor:'#ff5a4a',fillOpacity:.25,radius:CFG.tornado.danger});live.google=true;
    const sw=toLatLng(-E,E),ne=toLatLng(E,-E);gmap.fitBounds({south:sw.lat,west:sw.lng,north:ne.lat,east:ne.lng},20)};
  const s=document.createElement('script');s.src='https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(cfg.googleKey)+'&callback=__gmInit&v=weekly';s.async=true;document.head.appendChild(s)}catch(e){}}
function updateGoogle(){if(!gmap)return;applyLayers();updateGoogleHeat();const U=unitPos(),ll=p=>toLatLng(p.x,p.z);
  const path=[ll(U)];if(mode=='ground'&&legs.length){for(const leg of legs)for(const n of leg)path.push(toLatLng(NODES[n].x,NODES[n].z))}else for(const r of route)path.push(ll(r));gObj.route.setPath(path);
  const bp=[ll(U)];for(const r of routeBase)bp.push(ll(r));gObj.base.setPath(bp);
  gObj.unit.setPosition(ll(U));const ic=gObj.unit.getIcon();ic.rotation=(mode=='air'?yaw:TR.yaw)*180/Math.PI;gObj.unit.setIcon(ic);
  gObj.haz.setVisible(disaster=='tornado');if(disaster=='tornado')gObj.haz.setCenter(toLatLng(T.x,T.z));
  const open=new Set();for(const r of reports){if(r.done)continue;open.add(r.id);let m=gObj.rep.get(r.id);
    if(!m){m=new google.maps.Marker({map:gmap,position:ll(r),label:{text:String(r.people),color:'#fff',fontSize:'11px'},icon:{path:google.maps.SymbolPath.CIRCLE,scale:9,fillColor:'#ff5a4a',fillOpacity:.9,strokeWeight:0}});m.addListener('click',()=>toggleUserStop(r.id));gObj.rep.set(r.id,m)}}
  for(const [id,m] of gObj.rep)if(!open.has(id)){m.setMap(null);gObj.rep.delete(id)}}
function showMap(on){mapOn=on;$('map').style.display=on?'flex':'none';const useG=on&&gmap&&WSRC==='houston';$('gmap').style.display=useG?'block':'none';$('mc').style.display=useG?'none':'block';document.querySelectorAll('#mapbar [data-layer=radar],#mapbar [data-layer=alerts]').forEach(b=>b.style.display=useG?'':'none');if(on){if(useG)updateGoogle();else drawMap()}}

// ---------- live Houston data (only when serve.py is running locally) ----------
async function getJSON(u,ms=4000){const c=new AbortController(),tm=setTimeout(()=>c.abort(),ms);try{const r=await fetch(u,{signal:c.signal});if(!r.ok){let m=r.status;try{m=(await r.json()).error||m}catch(e){}throw new Error(m)}return await r.json()}finally{clearTimeout(tm)}}
// real past events, used when there is no active alert. Parameters are game-scaled; descriptions summarize public reports.
const SAMPLES_ALL={houston:{
  beryl:{label:'Hurricane Beryl, Jul 8 2024',d:'hurricane',info:'Cat 1 landfall near Matagorda, then north through Houston. Most of the city lost power. Wind from the SSW eye path, light surge downtown.',over:{eye0:[-900,3200],vmax:38,maxLevel:1.6}},
  derecho:{label:'Houston derecho, May 16 2024',d:'hurricane',info:'Straight-line winds near 100 mph through downtown, high-rise windows blown out, 1M+ without power. Modeled as a fast gust front moving east.',over:{derecho:true,maxLevel:.3}},
  harvey:{label:'Harvey flooding, Aug 2017',d:'flood',info:'Days of extreme rain (feet, not inches) across Harris County. Modeled as fast-rising water from Buffalo Bayou over the terrain.',over:{maxLevel:6.2,riseTime:260}},
  pasadena:{label:'Pasadena EF3 tornado, Jan 24 2023',d:'tornado',info:'An EF3 tornado tracked through Pasadena and Baytown, southeast of downtown. Moved here to show the routing.'},
  normal:{label:'Normal day (no hazard)',d:'none',info:'Routine calls with live Houston wind. Good for comparing Aerial vs Earth travel times.'}},
  dallas:{
  tornado19:{label:'Dallas EF3 tornado, Oct 20 2019',d:'tornado',info:'A night-time EF3 hit north Dallas (Preston Hollow to Richardson), damaging 1,000+ buildings, no deaths. Moved to downtown to show the routing.'},
  storm24:{label:'DFW windstorm, May 28 2024',d:'hurricane',info:'Severe storms with gusts near 80 mph across Dallas-Fort Worth, big power outages and broken glass. Modeled as a fast gust front.',over:{derecho:true,maxLevel:.3}},
  flood22:{label:'Dallas flash flood, Aug 22 2022',d:'flood',info:'Record rainfall (9+ inches in places) closed roads and flooded cars and homes. Modeled as fast-rising water from the Trinity River side of downtown.',over:{maxLevel:3.6,riseTime:240}},
  normal:{label:'Normal day (no hazard)',d:'none',info:'Routine calls with live Dallas wind. Good for comparing Aerial vs Earth travel times.'}},
  richardson:{
  tornado19:{label:'North Texas EF3 tornado, Oct 20 2019',d:'tornado',info:'A night-time EF3 hit north Dallas, southwest of Richardson, damaging 1,000+ buildings with no deaths. Moved to the UT Dallas area to show the routing.'},
  storm24:{label:'DFW windstorm, May 28 2024',d:'hurricane',info:'Severe storms with gusts near 80 mph across Dallas-Fort Worth, big power outages and broken glass. Modeled as a fast gust front.',over:{derecho:true,maxLevel:.3}},
  flood22:{label:'North Texas flash flood, Aug 22 2022',d:'flood',info:'Record rainfall (9+ inches in places) closed roads and flooded cars and homes across Dallas-Fort Worth. Modeled as fast-rising water over the low ground.',over:{maxLevel:3.2,riseTime:240}},
  normal:{label:'Normal day (no hazard)',d:'none',info:'Routine calls with live Richardson wind. Good for comparing Aerial vs Earth travel times.'}},
  sf:{
  quake89:{label:'Loma Prieta quake, Oct 17 1989',d:'earthquake',info:'A M6.9 quake during the World Series: the Bay Bridge span fell, the Marina District burned and collapsed. Modeled as a main shock, collapses and aftershocks.'},
  river23:{label:'Atmospheric river floods, Jan 2023',d:'flood',info:'A chain of strong storms flooded streets and caused landslides and outages around the Bay Area. Modeled as water rising from the Bay over low ground.',over:{maxLevel:2.4,riseTime:280}},
  normal:{label:'Normal day (no hazard)',d:'none',info:'Routine calls with live San Francisco wind. Good for comparing Aerial vs Earth travel times.'}},
  miami:{
  irma17:{label:'Hurricane Irma, Sep 2017',d:'hurricane',info:'Irma passed west of Miami after hitting the Keys. Miami saw strong winds and a surge that flooded Brickell and downtown streets, with construction cranes in the wind. Game-scaled.',over:{eye0:[2400,2200],vmax:36,maxLevel:2.2}},
  andrew92:{label:'Hurricane Andrew, Aug 1992',d:'hurricane',info:'Category 5 landfall in south Miami-Dade, one of the costliest US storms. Modeled here as a direct hit on the city for the routing.',over:{eye0:[-2200,1600],vmax:46,maxLevel:2.8}},
  king:{label:'Sunny-day flooding (king tide)',d:'flood',info:'High tides push water up storm drains and flood low streets with no rain, a regular thing in Miami and Miami Beach. Modeled as slow, shallow flooding.',over:{maxLevel:1.1,riseTime:420}},
  normal:{label:'Normal day (no hazard)',d:'none',info:'Routine calls with live Miami wind. Good for comparing Aerial vs Earth travel times.'}},
  nyc:{
  sandy12:{label:'Superstorm Sandy, Oct 29 2012',d:'hurricane',info:'A storm surge of about 14 ft at the Battery flooded Lower Manhattan, tunnels and subways, and knocked out power south of 39th St. Game-scaled wind and surge.',over:{eye0:[-2300,2600],vmax:34,maxLevel:4.3}},
  ida21:{label:'Ida flash flood, Sep 1 2021',d:'flood',info:'A record 3 inches of rain in one hour flooded subway stations and basement apartments. Modeled as fast-rising street flooding.',over:{maxLevel:2.6,riseTime:150}},
  normal:{label:'Normal day (no hazard)',d:'none',info:'Routine calls with live New York wind. Good for comparing Aerial vs Earth travel times.'}},
  anchorage:{
  quake18:{label:'Anchorage quake, Nov 30 2018',d:'earthquake',info:'A M7.1 quake 7 miles north of Anchorage cracked roads and bridges, damaged buildings and shook the city for about a minute. Modeled with collapses and aftershocks.'},
  quake64:{label:'Good Friday quake, Mar 27 1964',d:'earthquake',info:'The M9.2 megathrust quake, second largest ever recorded, devastated Anchorage with landslides and collapses. Modeled the same way as any quake here (not its real size).'},
  normal:{label:'Normal day (no hazard)',d:'none',info:'Routine calls with live Anchorage wind. Good for comparing Aerial vs Earth travel times.'}}};
let SAMPLES=SAMPLES_ALL[CITY.key]||SAMPLES_ALL.houston;
// map an NWS alert to a hazard module
function alertHazard(a){const e=(a.event||'').toLowerCase();if(e.includes('tornado'))return'tornado';if(e.includes('hurricane')||e.includes('tropical')||e.includes('storm surge'))return'hurricane';
  if(e.includes('flood'))return'flood';if(e.includes('red flag')||e.includes('fire'))return'wildfire';if(e.includes('thunderstorm')||e.includes('wind'))return'hurricane';return null}
async function checkServer(){try{const s=await getJSON('/api/status',5000);live.server=!!s.ok;live.hasKey=!!s.google;live.nvidia=!!s.nvidia}catch(e){live.server=false}
  renderLivePanel();syncCity();if(!live.server)return;
  loadGoogle();refreshLive();setInterval(refreshLive,60000);
  loadCity()}
let cityLoading=0;
async function loadCity(){const tok=++cityLoading,nm=CITY.name;$('liveStatus').textContent='Loading downtown '+nm+' buildings from OpenStreetMap (first time can take 30-90 s, then cached)...';
  try{const data=await getJSON('/api/city?c='+CITY.key,180000);if(tok!==cityLoading)return;buildWorld(data,'houston');resetSim();gmapRefit();$('liveStatus').textContent='Real downtown '+nm+' loaded: '+B.length.toLocaleString()+' buildings, '+EDGES.filter(e=>!e.dead).length.toLocaleString()+' road segments (OpenStreetMap).'}
  catch(e){$('liveStatus').innerHTML='Could not load '+nm+' map data: '+String(e.message).replace(/</g,'&lt;')+'. Using the cartoon city. <u id="retryH" style="cursor:pointer;color:#ffb347">Retry</u> (the Terminal running serve.py shows details)';const rb=$('retryH');if(rb)rb.onclick=ev=>{ev.stopPropagation();loadCity()}}}
async function refreshLive(){try{const [al,ob,qk]=await Promise.all([getJSON('/api/alerts?c='+CITY.key).catch(()=>null),getJSON('/api/obs?c='+CITY.key).catch(()=>null),getJSON('/api/quakes?c='+CITY.key).catch(()=>null)]);
  if(al)live.alerts=al.alerts||[];if(ob)live.obs=ob;if(qk)live.quakes=qk.quakes||[];renderLivePanel()}catch(e){}}
let liveChoice='';
function renderLivePanel(){const el=$('livePanel');if(!live.server){$('liveStatus').textContent='Needs the local server (see Experience).';el.innerHTML='<p><b>Live city mode needs the local server.</b> Your Google key and the live data feeds only work on your machine. In Terminal: <code>cd prototype/flight && python3 serve.py</code>, then open <code>http://localhost:8765</code>.</p><p>This published version runs the scenario simulator on the cartoon city.</p>';return}
  const opts=[];for(const a of live.alerts){const h=alertHazard(a);if(h)opts.push({k:'alert:'+a.id,label:'LIVE: '+a.event+' ('+a.severity+')',d:h,info:a.headline||''})}
  for(const q of live.quakes)if(q.mag>=3)opts.push({k:'quake:'+q.id,label:'LIVE: M'+q.mag.toFixed(1)+' quake, '+q.place,d:'earthquake',info:'USGS, '+new Date(q.time).toLocaleString()});
  const obs=live.obs?(CITY.name+' now: '+(live.obs.desc||'')+', wind '+(live.obs.wind==null?'n/a':Math.round(live.obs.wind)+' m/s')+(live.obs.temp!=null?', '+Math.round(live.obs.temp)+' C':'')):'';
  el.innerHTML='<p>'+(live.alerts.length?'<b>'+live.alerts.length+' active NWS alert(s) for downtown '+CITY.name+'.</b>':'<b>No active NWS alerts for downtown '+CITY.name+' right now.</b> Pick a real past event or a normal day.')+'<br>'+obs+'</p>'+
    '<div class="row">'+opts.concat(Object.entries(SAMPLES).map(([k,s])=>({k:'sample:'+k,label:s.label,d:s.d,info:s.info}))).map(o=>'<span class="opt'+(liveChoice===o.k?' on':'')+'" data-live="'+o.k+'" title="'+(o.info||'').replace(/"/g,'')+'">'+o.label+'</span>').join('')+'</div><p id="liveInfo"></p>';
  el.querySelectorAll('[data-live]').forEach(o=>o.onclick=()=>{liveChoice=o.dataset.live;renderLivePanel();const all=opts.concat(Object.entries(SAMPLES).map(([k,s])=>({k:'sample:'+k,d:s.d,info:s.info})));const c=all.find(x=>x.k===liveChoice);$('liveInfo').textContent=c?c.info:''});
  if(!liveChoice)liveChoice=opts.length?opts[0].k:'sample:normal'}

// ---------- city switch (Houston / Dallas): needs the local server for real map data ----------
function syncCity(){document.querySelectorAll('[data-city]').forEach(o=>o.classList.toggle('on',o.dataset.city===CITY.key));$('cityRow').style.display=live.server?'flex':'none';
  const ln=$('liveName');if(ln)ln.textContent='Live '+CITY.name}
function switchCity(k){if(k===CITY.key)return;set.city=k;store.set('df.city',k);setCity(k);SAMPLES=SAMPLES_ALL[k];liveChoice='';live.alerts=[];live.obs=null;live.quakes=[];
  syncCity();renderLivePanel();if(live.server){loadCity();refreshLive();gmapRefit()}}
document.querySelectorAll('[data-city]').forEach(o=>o.onclick=()=>switchCity(o.dataset.city));
function gmapRefit(){if(!gmap)return;gmap.setCenter({lat:ORIGIN.lat,lng:ORIGIN.lng});const sw=toLatLng(-E,E),ne=toLatLng(E,-E);gmap.fitBounds({south:sw.lat,west:sw.lng,north:ne.lat,east:ne.lng},20);if(gHeat){gHeat.setMap(null);gHeat=null}}
// ---------- mode swap, reset, menu ----------
function swapMode(to){if(to===mode)return;
  if(landR){landR.claimed=false;landR=null}ap='go';pad.visible=false;if(sw){sw=null;rope.visible=false}
  if(to=='ground'){placeTruck(P.x,P.z);mode='ground';say('Earth mode: fire truck')}
  else{P.set(TR.x,TR.y+5,TR.z);yaw=TR.yaw;pitch=.45;spd=26;vel.copy(fwd()).multiplyScalar(spd);mode='air';say('Aerial mode: dragonfly')}
  set.mode=mode;store.set('df.mode',mode);planT=0;gFor=0;syncMenu()}
const BASE_CFG=JSON.parse(JSON.stringify({hurricane:CFG.hurricane,flood:CFG.flood}));
function applyScenarioOverrides(){Object.assign(CFG.hurricane,BASE_CFG.hurricane);Object.assign(CFG.flood,BASE_CFG.flood);H.derecho=false;
  if(app==='live'&&liveChoice.startsWith('sample:')){const s=SAMPLES[liveChoice.slice(7)],o=s.over||{};if(s.d=='hurricane'){Object.assign(CFG.hurricane,o);H.derecho=!!o.derecho}if(s.d=='flood')Object.assign(CFG.flood,o)}}
function resetSim(){for(const r of reports)if(!r.done)closeReport(r);reports.length=0;userRoute=[];Object.assign(stats,{saved:0,missed:0,crashes:0,carHits:0,guards:0,stuck:0,dodges:0,unsafeSkips:0});learn.urg=0;style=0;
  simT=0;spawnT=0;landR=null;ap='go';pad.visible=false;applyScenarioOverrides();hazardReset();
  // spawn: south of the center, above everything nearby
  const sp=spawnPt();let top=60;forNear(sp.x,sp.z,b=>{top=Math.max(top,bH(b));return false});P.set(sp.x,Math.min(CFG.air.ceiling-20,top+40),sp.z);yaw=0;pitch=0;spd=30;bat=100;tbat=100;placeTruck(sp.x,sp.z);
  if(disaster!='earthquake'&&disaster!='none')for(let i=0;i<4;i++)addReport();planT=0;CAM.yaw=0;CAM.pitch=0}
function syncMenu(){document.querySelectorAll('.opt[data-k]').forEach(o=>o.classList.toggle('on',set[o.dataset.k]===o.dataset.v));
  document.querySelectorAll('.appcard').forEach(o=>o.classList.toggle('on',set.app===o.dataset.app));$('livePanel').style.display=set.app=='live'?'block':'none';$('scenPanel').style.display=set.app=='scenario'?'block':'none'}
document.querySelectorAll('.opt[data-k]').forEach(o=>o.onclick=()=>{const k=o.dataset.k,v=o.dataset.v;if(k=='mode')swapMode(v);else{set[k]=v;store.set('df.'+k,v)}
  if(k=='disaster'&&v!==disaster&&app=='scenario'){disaster=v;resetSim()}if(k=='quality')applyQuality();syncMenu()});
document.querySelectorAll('.appcard').forEach(o=>o.onclick=()=>{set.app=o.dataset.app;syncMenu()});
function openMenu(on){paused=on;$('menu').style.display=on?'block':'none'}
$('start').onclick=()=>{const prevApp=app,prevD=disaster;app=set.app;live.on=app==='live'&&live.server;
  if(app==='live'){if(!live.server){set.app=app='scenario';syncMenu()}else{const k=liveChoice||'sample:normal';const al=live.alerts.find(a=>'alert:'+a.id===k),qk=live.quakes.find(q=>'quake:'+q.id===k);
    disaster=al?alertHazard(al):qk?'earthquake':SAMPLES[k.slice(7)]?SAMPLES[k.slice(7)].d:'none';live.note=al?al.event+': '+(al.headline||''):qk?'M'+qk.mag+' '+qk.place:SAMPLES[k.slice(7)]?SAMPLES[k.slice(7)].label:''}}
  else disaster=set.disaster;
  if(!go||app!==prevApp||disaster!==prevD||app==='live')resetSim();go=true;openMenu(false);audioInit();if(AU.ctx)AU.ctx.resume();setTimeout(()=>radio('shift start: brief the crew',true),1500)};
function toggleFS(){try{if(document.fullscreenElement||document.webkitFullscreenElement){(document.exitFullscreen||document.webkitExitFullscreen).call(document)}else{const el=document.documentElement;(el.requestFullscreen||el.webkitRequestFullscreen).call(el)}}catch(e){say('full screen not available here')}}
$('fsbtn').onclick=e=>{e.stopPropagation();toggleFS()};
addEventListener('fullscreenchange',()=>{$('fsbtn').innerHTML=document.fullscreenElement?'&#x26F6; Exit full screen':'&#x26F6; Full screen'});
addEventListener('keydown',e=>{if(e.code=='Space'||e.code.startsWith('Arrow'))e.preventDefault();if(e.repeat)return;K[e.code]=1;
  if(e.code=='KeyH'||e.code=='Escape'){openMenu(!paused);return}if(!go||paused)return;
  if(e.code=='KeyM')showMap(!mapOn);
  if(e.code=='KeyA'){auto=!auto;ap='go';if(landR){landR.claimed=false;landR=null}pad.visible=false;gs='drive';gFor=0;say(auto?'autopilot: '+(userRoute.length?'your route':'best route'):'manual control')}
  if(e.code=='KeyE')swapMode(mode=='air'?'ground':'air');
  if(e.code=='KeyC'){CAM.yaw=0;CAM.pitch=0;CAM.zoom=1;say('camera reset')}
  if(e.code=='KeyQ'){const o=['low','medium','high'];set.quality=o[(o.indexOf(set.quality)+1)%3];store.set('df.quality',set.quality);applyQuality();syncMenu();say('quality: '+set.quality)}
  if(e.code=='KeyG')toggleFS();
  if(e.code=='KeyN'){audioInit();audioToggle()}
  if(e.code=='KeyV'){DSP.voice=!DSP.voice;store.set('df.voice',DSP.voice?'on':'off');if(!DSP.voice&&window.speechSynthesis)speechSynthesis.cancel();say('dispatcher voice '+(DSP.voice?'on':'off'))}
  if(e.code=='KeyF')$('fps').style.display=$('fps').style.display=='block'?'none':'block';
  if(e.code=='ShiftLeft'&&mode=='air'&&dashCd<=0&&!parked()){spd+=32;dashCd=1.6;shock();caKick=.6;sfx('whoosh');say('dash')}
  if(e.code=='ShiftLeft'&&mode=='ground'&&nitroCd<=0){nitroT=CFG.truck.nitroT;nitroCd=CFG.truck.nitroCd;TR.spd=Math.max(TR.spd,8)+6;tbat-=1;shock();caKick=1;slowT=.08;sfx('nitro');say('NITRO')}
  if(e.code=='Space'&&mode=='air'&&!parked())grab()});
addEventListener('keyup',e=>{K[e.code]=0;if(e.code=='Space'&&sw)release()});
addEventListener('mousemove',e=>{M.x=(e.clientX/innerWidth-.5)*2;M.y=(e.clientY/innerHeight-.5)*2});

// ---------- main loop ----------
function step(rdt){
  if(slowT>0){slowT-=rdt;timeScale=.4}else timeScale+=(1-timeScale)*Math.min(1,rdt*6);
  const dt=rdt*timeScale;t+=dt;
  if(go&&!paused&&worldReady){simT+=dt;hazardTick(dt);simTick(dt);debTick(dt);
    const U=unitPos();lastWind.copy(windAt(U.x,U.z));
    if(mode=='air')airTick(dt,lastWind);else truckTick(dt);
    if(Math.random()<dt*(disaster=='hurricane'?.35:disaster=='tornado'?.22:disaster=='flood'?.15:0)){flash=1;sfx('thunder')}}
  if(worldReady)carTick(dt);figTick(dt);
  bat=Math.max(0,bat);tbat=Math.max(0,tbat);hitCd-=dt;warnCd-=dt;dashCd-=dt;shake*=Math.pow(.02,dt);caKick*=Math.pow(.05,dt);
  if(msgT>0){msgT-=rdt;if(msgT<=0)$('msg').style.opacity=0}
  if(pad.visible)pad.material.opacity=.5+.4*Math.sin(t*6);ringTick(dt)}
let popT=0;
function visuals(rdt){const dt=rdt*timeScale,q=QUAL[set.quality]||QUAL.medium;camTick(rdt);
  flash*=Math.pow(.003,dt);skyU.flash.value=flash;$('fl').style.opacity=flash*.35;hemi.intensity=(hemi.userData.base||1.1)+flash*1.2;waterU.uT.value=t;skyU.tm.value=t;if(MTN){MTN.position.x=C.position.x;MTN.position.z=C.position.z}
  if(mode=='air'){D.position.copy(P);D.rotation.set(0,0,0);D.rotateY(Math.PI-yaw);D.rotateX(-pitch);D.rotateZ(roll)}
  D.visible=mode=='air';PILOT.group.visible=mode=='ground';
  for(const g of PILOT.wings)g.rotation.z=g.userData.sd*(.15+Math.sin(t*(3+Math.abs(TR.spd)*.3)+g.userData.ph*3)*.08);
  const perched=(auto&&ap=='board'),fr=perched?3:14+spd*.35,amp=perched?.07:(.5+.25*Math.min(1,spd/60));for(const g of wings)g.rotation.z=g.userData.sd*Math.sin(t*fr+g.userData.ph*3)*amp;
  {const o=new THREE.Object3D();TREES.forEach((tr,i)=>{const w=windAt(tr.x,tr.z),l=w.length(),bend=Math.min(.45,l*.011)+Math.sin(t*3+tr.ph)*.012*l;
    o.position.set(tr.x,0,tr.z);o.rotation.set(0,0,0);if(l>.01)o.rotateOnWorldAxis(V(w.z,0,-w.x).normalize(),-bend);o.scale.set(tr.s,tr.s*3,tr.s);o.updateMatrix();trunkM.setMatrixAt(i,o.matrix);o.scale.setScalar(tr.s);o.updateMatrix();crownM.setMatrixAt(i,o.matrix)});
   if(trunkM){trunkM.instanceMatrix.needsUpdate=crownM.instanceMatrix.needsUpdate=true}}
  // camera: follow from behind, orbit offsets from the arrow keys (CAM.yaw/pitch), wheel zoom
  camHy+=wrap(TR.yaw-camHy)*(1-Math.exp(-dt*5));const U=mode=='air'?P.clone():V(TR.x,TR.y+1.5,TR.z),hy=mode=='air'?yaw:camHy,sv=mode=='air'?spd:Math.abs(TR.spd);
  const dist=(mode=='air'?7+spd*.07:16+Math.abs(TR.spd)*.15)*CAM.zoom,basePitch=mode=='air'?.28-pitch*.5:.3,pc=clamp(basePitch+CAM.pitch,-.25,1.3),cy=hy+Math.PI+CAM.yaw;
  const want=V(U.x+Math.sin(cy)*Math.cos(pc)*dist,U.y+Math.sin(pc)*dist+(mode=='air'?1.5:1),U.z-Math.cos(cy)*Math.cos(pc)*dist);
  const fh=V(Math.sin(hy),0,-Math.cos(hy)),la=Math.max(0,Math.cos(CAM.yaw))*(mode=='air'?16:10),look=U.clone().addScaledVector(fh,la).add(V(0,1,0));
  C.position.lerp(want,1-Math.exp(-dt*(sw?6:mode=='air'?12:7)));
  for(let k=0;k<6;k++){let inside=false;forNear(C.position.x,C.position.z,b=>{if(C.position.y<bH(b)+1&&bDist(b,C.position.x,C.position.z)<1){inside=true;return true}return false});if(!inside)break;C.position.lerp(look,.25)}
  if(C.position.y<1.5)C.position.y=1.5;
  C.position.x+=(Math.random()-.5)*shake*.5;C.position.y+=(Math.random()-.5)*shake*.5;
  C.up.set(mode=='air'&&Math.abs(CAM.yaw)<.3?Math.sin(roll*.35):0,1,0);C.lookAt(look);
  const fovT=mode=='air'?58+spd*.3+(sw?6:0):58+Math.abs(TR.spd)*.35+(nitroT>0?12:0);fov+=(fovT-fov)*Math.min(1,dt*4);C.fov=fov;C.updateProjectionMatrix();sky.position.copy(C.position);
  // speed streaks
  const rel=(mode=='air'?vel.clone():V(Math.sin(TR.yaw)*TR.spd,0,-Math.cos(TR.yaw)*TR.spd)).multiplyScalar(-1),svv=mode=='air'?spd:Math.abs(TR.spd)*1.6,L=Math.min(svv*.12,10),dir=rel.lengthSq()?rel.clone().normalize():V(0,0,1),arr=sg.attributes.position.array;
  for(let i=0;i<SN;i++){const o=i*6;let x=arr[o]+rel.x*dt*1.2,y=arr[o+1]+rel.y*dt*1.2,z=arr[o+2]+rel.z*dt*1.2;
    if(Math.abs(x)>80||Math.abs(y)>80||Math.abs(z)>80){x=(Math.random()-.5)*160;y=(Math.random()-.5)*160;z=(Math.random()-.5)*160}arr[o]=x;arr[o+1]=y;arr[o+2]=z;arr[o+3]=x-dir.x*L;arr[o+4]=y-dir.y*L;arr[o+5]=z-dir.z*L}
  streaks.position.copy(unitPos());sg.attributes.position.needsUpdate=true;streaks.material.opacity=Math.min(.55,Math.max(0,(svv-35)/70));
  hazardVisuals(dt,q);D.updateMatrixWorld();trailTick();
  const speedK=clamp((svv-45)/60,0,1);$('vig').style.opacity=Math.min(.75,speedK*.9);
  if(finalPass){finalPass.uniforms.uSpeed.value=q.blur?speedK:0;finalPass.uniforms.uCA.value=q.blur?Math.min(1,caKick+speedK*.25):0;finalPass.uniforms.uVig.value=speedK}
  // HUD
  const Uh=unitPos(),Wd=windAt(Uh.x,Uh.z),spdShow=mode=='air'?spd:Math.abs(TR.spd);
  $('spd').firstChild.nodeValue=Math.round(spdShow);$('alt').textContent=Math.round(mode=='air'?P.y:TR.y);const bv=mode=='air'?bat:tbat;$('bat').style.width=bv+'%';$('bat').style.background=bv<20?'#ff5a4a':'';
  $('st').textContent=mode=='air'?(parked()?{approach:'gliding in',board:'boarding',lift:'lifting off'}[ap]:sw?'swinging':spd>75?'boosting':P.y<8?'low':'cruise'):(auto&&gs=='board'?'loading at the door':floodDepth(TR.x,TR.z)>.4?'driving through floodwater':Math.abs(TR.spd)<.5?'stopped':'driving');
  $('w').textContent=Math.round(Wd.length());const hd=mode=='air'?fwd():V(Math.sin(TR.yaw),0,-Math.cos(TR.yaw)),tl=Wd.dot(hd);$('wd').textContent=tl>3?'tailwind':tl<-3?'headwind':'crosswind';
  const dn={tornado:'Tornado',hurricane:H.derecho?'Wind storm (derecho)':'Hurricane',flood:'Flood',wildfire:'Wildfire',earthquake:'Earthquake',none:'Normal day'}[disaster];
  $('badge').innerHTML=(app==='live'?'<b style="color:#ff7a6a">LIVE '+CITY.name.toUpperCase()+'</b> &middot; ':'')+'<b>'+(mode=='air'?'Aerial':'Earth')+'</b> &middot; '+dn+'<br>'+(auto?'AUTOPILOT':'MANUAL')+' (A) &middot; E swap &middot; arrows: camera';
  guideTick(rdt);guideVisuals(rdt);nitroVisuals();routeLineTick(rdt);
  labelTick();if(mapOn){popT-=rdt;if(popT<=0){popT=WSRC==='houston'&&gmap?1:.15;if(WSRC==='houston'&&gmap)updateGoogle();else drawMap()}}}
function hudSim(){const u=learn.urg,open=reports.filter(r=>!r.done).length;
  if(disaster=='none'){$('sim').innerHTML=(app==='live'?'<b style="color:#8fd">Normal day in '+CITY.name+'</b>':'<b>Free roam</b>')+'<br><span class="k">No hazard, no calls. Fly or drive around.</span>'+(live.obs&&live.obs.wind!=null?'<br><span class="k">'+CITY.name+' now: '+(live.obs.desc||'')+', wind '+Math.round(live.obs.wind)+' m/s</span>':'')+'<br><span class="k">'+popLabel+'</span>';return}
  $('sim').innerHTML=(app==='live'&&live.note?'<b style="color:#ff7a6a">'+live.note.slice(0,110)+'</b><br>':'')+
   'reached <b>'+stats.saved+'</b> people &middot; missed '+stats.missed+' &middot; open '+open+
   '<br><span class="k">rescue-priority</span> '+Math.round(est.a)+' <span class="k">vs nearest-first</span> '+Math.round(est.b)+' <span class="k">lives (modeled)</span>'+
   (est.user!=null?'<br><span style="color:#7fd3ff">your route</span> '+Math.round(est.user)+' <span class="k">vs optimizer</span> '+Math.round(est.a):'')+
   '<br><span class="k">best by air</span> '+Math.round(est.air)+' <span class="k">vs by road</span> '+Math.round(est.ground)+(est.unreach?' <span style="color:#ff7a6a">('+est.unreach+' unreachable by road)</span>':'')+
   (mode=='ground'&&est.unreach&&!route.length?'<br><b style="color:#ff7a6a">No report reachable by truck. Press E for Aerial.</b>':'')+
   (stats.unsafeSkips?'<br><span class="k">stops deferred for safety</span> '+stats.unsafeSkips:'')+
   (u>.01?'<br><span class="k">adaptive urgency</span> '+Math.round(u*100)+'% <span class="k">(+'+Math.round(u*CFG.learn.speed*100)+'% speed, '+Math.round(u*CFG.learn.board*100)+'% faster boarding)</span>':'')+
   '<br><span class="k">'+ROUTING_NOTE[disaster]+'</span>'+
   '<br><span class="k">'+popLabel+'</span>'}
const clock=new THREE.Clock();let fpsA=60,hudT=0,popRefresh=60;
function frame(){requestAnimationFrame(frame);const rdt=Math.min(clock.getDelta(),.05);step(rdt);if(worldReady)visuals(rdt);audioTick(rdt);dispatchTick();
  hudT-=rdt;if(hudT<=0){hudT=.25;hudSim();$('fps').textContent=Math.round(fpsA)+' fps · '+set.quality}fpsA+=(1/Math.max(rdt,1e-3)-fpsA)*.05;
  popRefresh-=rdt;if(popRefresh<=0){popRefresh=60;updatePopulation()}
  if(composer&&(QUAL[set.quality]||{}).post)composer.render();else R.render(SC,C)}

// ---------- guide: 3D arrow above you + on-screen waypoint marker with distance ----------
const guideArrow=new THREE.Group();{const sh=new THREE.Shape();sh.moveTo(0,1.6);sh.lineTo(1.2,-.4);sh.lineTo(.45,-.1);sh.lineTo(.45,-1.2);sh.lineTo(-.45,-1.2);sh.lineTo(-.45,-.1);sh.lineTo(-1.2,-.4);sh.closePath();
  const g=new THREE.ExtrudeGeometry(sh,{depth:.35,bevelEnabled:false});g.translate(0,0,-.17);g.rotateX(-Math.PI/2); // arrow lies flat, tip toward +z... after rotation tip points to -z, flip below
  g.rotateY(Math.PI);part(g,new THREE.MeshBasicMaterial({color:0xffb347}),guideArrow,null,null,null,.06)}
guideArrow.visible=false;SC.add(guideArrow);
function guideVisuals(rdt){const on=guide.on&&!mapOn;guideArrow.visible=on;const el=$('wp');if(!on){el.style.display='none';return}
  const U=mode=='air'?P:V(TR.x,TR.y,TR.z),dx=guide.aim.x-U.x,dz=guide.aim.z-U.z;
  guideArrow.position.set(U.x,(mode=='air'?U.y+3.4:U.y+6.4)+Math.sin(t*3)*.18,U.z);guideArrow.rotation.set(0,Math.atan2(dx,dz),0);guideArrow.scale.setScalar(mode=='air'?.9:1.1);
  // screen marker: on the target if visible, else pinned to the screen edge pointing toward it
  const v=guide.dst.clone().project(C);let x=v.x,y=v.y,off=v.z>1||Math.abs(x)>.92||Math.abs(y)>.88;if(v.z>1){x=-x;y=-y}
  if(off){const m=Math.max(Math.abs(x)/.9,Math.abs(y)/.85,1e-3);x/=m;y/=m}
  el.style.display='block';el.style.left=((x*.5+.5)*innerWidth)+'px';el.style.top=((-y*.5+.5)*innerHeight)+'px';
  el.firstChild.style.transform=off?'rotate('+(Math.atan2(-y,x)*180/Math.PI-90)+'deg)':'none';el.lastChild.textContent=guide.dist>=1000?(guide.dist/1000).toFixed(1)+' km':Math.round(guide.dist)+' m'}
// ---------- route line in the world (first stops), follows the road for the truck ----------
const RL=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0xffb347,transparent:true,opacity:.6}));RL.frustumCulled=false;SC.add(RL);let rlT=0;
function routeLineTick(rdt){rlT-=rdt;if(rlT>0)return;rlT=.3;RL.visible=guide.on;if(!guide.on)return;const pts=[];
  if(mode=='air'){pts.push(P.clone());for(const r of route.slice(0,3)){const pp=padPoint(r.b);pts.push(V(pp[0],bH(r.b)+12,pp[1]))}}
  else{pts.push(V(TR.x,.6,TR.z));for(const n of gPath)pts.push(V(NODES[n].x,.6,NODES[n].z));const r=route[0];if(r)pts.push(V(r.b.stop.x,.6,r.b.stop.z))}
  RL.geometry.dispose();RL.geometry=new THREE.BufferGeometry().setFromPoints(pts)}
// ---------- truck nitro: exhaust flames ----------
const flames=[-.7,.7].map(x=>{const m=new THREE.Mesh(new THREE.ConeGeometry(.32,2.2,10).rotateX(-Math.PI/2).translate(0,0,-1.1),new THREE.MeshBasicMaterial({color:0xff8a2a,transparent:true,opacity:.9,blending:THREE.AdditiveBlending,depthWrite:false}));m.position.set(x,.9,-3.55);m.visible=false;truck.add(m);return m});
function nitroVisuals(){const on=mode=='ground'&&nitroT>0;for(const f of flames){f.visible=on;if(on){f.scale.set(1,1,.7+Math.random()*.8);f.material.color.setHex(Math.random()<.5?0xff8a2a:0x6ad8ff)}}}

// ---------- map layers: hazard heat map (both maps), weather radar + NWS alert areas (Google map in Live Houston) ----------
const layers={radar:false,heat:true,alerts:true};
document.querySelectorAll('#mapbar [data-layer]').forEach(b=>{b.classList.toggle('on',layers[b.dataset.layer]);b.onclick=()=>{layers[b.dataset.layer]=!layers[b.dataset.layer];b.classList.toggle('on',layers[b.dataset.layer]);applyLayers();if(mapOn)showMap(true)}});
// 0..1 intensity of the current hazard at a point (what the heat map shows)
function heatAt(x,z){const d=disaster;
  if(d=='tornado'){const r=Math.hypot(x-T.x,z-T.z);return Math.max(clamp(1-r/420,0,1),dangerAt(x,z,8)>=.75?.55:0)}
  if(d=='hurricane'||d=='none')return clamp((windAt(x,z).length()-(d=='none'?2:10))/(d=='none'?18:34),0,1);
  if(d=='flood'){const now=floodDepth(x,z),soon=Math.max(0,floodLevelAt(simT+90)-elevAt(x,z));return riverDist(x,z)<0?0:Math.max(clamp(now/2.5,0,1),soon>0?.3:0)}
  if(d=='wildfire'){const a=fireArrival(x,z);return a>=999?0:clamp(1-a/150,0,1)}
  if(d=='earthquake'){let v=0;for(const b of Q.collapsed){const r=Math.hypot(x-b.x,z-b.z);if(r<110)v=Math.max(v,1-r/110)}for(const b of Q.damaged){const r=Math.hypot(x-b.x,z-b.z);if(r<50)v=Math.max(v,.4*(1-r/50))}return v}return 0}
const heatCol=v=>{const r=255,g=Math.round(230-200*v),b=Math.round(80-80*v);return'rgba('+r+','+g+','+b+','+(.12+.5*v).toFixed(2)+')'};
const HEAT_LABEL={tornado:'Heat: funnel + 8 s forecast track',hurricane:'Heat: wind speed',flood:'Heat: water depth now + next 90 s',wildfire:'Heat: forecast fire arrival',earthquake:'Heat: collapse / damage zones',none:'Heat: wind speed'};
function drawHeat(g,X,Z,k,W){if(!layers.heat)return;const st=28;for(let x=-W/2;x<W/2;x+=st)for(let z=-W/2;z<W/2;z+=st){const v=heatAt(x+st/2,z+st/2);if(v<.04)continue;g.fillStyle=heatCol(v);g.fillRect(X(x),Z(z),st*k+1,st*k+1)}
  g.fillStyle='#cfe';g.font='12px sans-serif';g.fillText(HEAT_LABEL[disaster]+' (modeled)',10,cvH()-10)}
const cvH=()=>$('mc').height;
let gRadar=null,gAlerts=[],gHeat=null,gHeatT=0,alertsSig='';
function applyLayers(){if(!gmap)return;
  if(layers.radar&&!gRadar){gRadar=new google.maps.ImageMapType({tileSize:new google.maps.Size(256,256),opacity:.62,name:'radar',
     // live NEXRAD base reflectivity mosaic (NOAA data, tiles by Iowa Environmental Mesonet), refreshed every 5 min
     getTileUrl:(c,z)=>'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/'+z+'/'+c.x+'/'+c.y+'.png?'+Math.floor(Date.now()/300000)});gmap.overlayMapTypes.push(gRadar)}
  if(!layers.radar&&gRadar){gmap.overlayMapTypes.clear();gRadar=null}
  const sig=layers.alerts?live.alerts.map(a=>a.id).join():'';if(sig!==alertsSig){alertsSig=sig;for(const p of gAlerts)p.setMap(null);gAlerts=[];
    if(layers.alerts)for(const a of live.alerts)for(const ring of a.poly||[])gAlerts.push(new google.maps.Polygon({map:gmap,paths:ring.map(q=>({lat:q[0],lng:q[1]})),strokeColor:'#ff5a4a',strokeWeight:2,fillColor:'#ff5a4a',fillOpacity:.12}))}
  if(!layers.heat&&gHeat){gHeat.setMap(null);gHeat=null}}
function updateGoogleHeat(){if(!gmap||!layers.heat||disaster=='none')return;gHeatT-=1;if(gHeatT>0)return;gHeatT=3; // rebuild the heat image every ~3 map updates, not every frame
  const n=96,cv=document.createElement('canvas');cv.width=cv.height=n;const g=cv.getContext('2d'),W=E*2;for(let i=0;i<n;i++)for(let j=0;j<n;j++){const v=heatAt(-E+(i+.5)*W/n,-E+(j+.5)*W/n);if(v<.04)continue;g.fillStyle=heatCol(v);g.fillRect(i,j,1,1)}
  const sw=toLatLng(-E,E),ne=toLatLng(E,-E),ov=new google.maps.GroundOverlay(cv.toDataURL(),{south:sw.lat,west:sw.lng,north:ne.lat,east:ne.lng},{opacity:.85,clickable:false});ov.setMap(gmap);if(gHeat)gHeat.setMap(null);gHeat=ov}

// ---------- boot ----------
buildWorld(proceduralData(),'procedural');disaster=set.disaster;resetSim();applyQuality();syncMenu();syncCity();
if(set.mode=='ground'){mode='air';swapMode('ground')}
if(location.protocol.startsWith('http'))checkServer();else renderLivePanel();
if(URLQ.get('test')){window.GAME={step,visuals,get state(){return{P,TR,ap,gs,auto,mode,stats,learn,route,reports,spd}},start(a){app='scenario';go=true;openMenu(false);auto=a},swapMode,resetSim,buildWorld,setDisaster(d){disaster=d;resetSim()}}}
frame();
