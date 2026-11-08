// ---------- Dragon Flyght start menu: Three.js dragonfly + accessible wing controls ----------
// The old menu DOM lives (hidden) in #legacy so ui.js handlers keep working; this file drives it.
(function(){
const M=$('menu'),cv=$('dfc'),dlg=$('mdlg'),dBody=$('dBody'),reduce=matchMedia('(prefers-reduced-motion: reduce)');
$('mStatus').appendChild($('liveStatus'));
const cap=s=>s.charAt(0).toUpperCase()+s.slice(1);
const vis=()=>M.style.display!=='none';
// ---- dragonfly scene ----
const R=new THREE.WebGLRenderer({canvas:cv,antialias:true,alpha:true});R.setClearColor(0,0);
const S=new THREE.Scene(),cam=new THREE.PerspectiveCamera(34,1,1,400);cam.up.set(0,0,-1);
S.add(new THREE.AmbientLight(0xcfd8ff,.55));const dl=new THREE.DirectionalLight(0xffffff,.55);dl.position.set(-6,20,6);S.add(dl);
const rim=new THREE.PointLight(0xa07cff,.45,60);rim.position.set(8,8,12);S.add(rim);
const mint=new THREE.MeshStandardMaterial({color:0x6fd6aa,roughness:.6,metalness:.05}),dark=new THREE.MeshStandardMaterial({color:0x27403d,roughness:.55}),
 eye=new THREE.MeshStandardMaterial({color:0x4fae3b,roughness:.3,emissive:0x1d4a14,emissiveIntensity:.5}),leg=new THREE.MeshStandardMaterial({color:0x1f2f2d,roughness:.7});
const DF=new THREE.Group();S.add(DF);
const add=(g,m,x,y,z,sx=1,sy=1,sz=1)=>{const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.scale.set(sx,sy,sz);DF.add(o);return o};
const sph=new THREE.SphereGeometry(1,28,20);
const head=add(sph,mint,0,0,-4.3,1.0,.8,.95);add(sph,eye,-.78,.25,-4.55,.55,.5,.6);add(sph,eye,.78,.25,-4.55,.55,.5,.6);
add(sph,mint,0,.05,-2.6,1.15,.95,1.9);
const N=11;for(let i=0;i<N;i++){const z0=-.9+i*.88,r=.58-i*.03;const g=new THREE.CylinderGeometry(r*.92,r,.86,16);g.rotateX(Math.PI/2);add(g,i%2?dark:mint,0,0,z0+.43)}
{const g=new THREE.ConeGeometry(.3,1.1,12);g.rotateX(-Math.PI/2);add(g,dark,0,0,-.9+N*.88+.55)}
for(const sx of[-1,1])for(let k=0;k<3;k++){const g=new THREE.CylinderGeometry(.06,.06,1.8,6);g.rotateZ(Math.PI/2);add(g,leg,sx*1.2,-.5,-3.3+k*.6).rotation.y=sx*(.4-k*.35)}
// wings: pivot at the thorax, flap about the body axis (z); tips angle forward (fore) or back (hind)
const wm=new THREE.MeshStandardMaterial({color:0xf4eddc,roughness:.35,transparent:true,opacity:.5,side:THREE.DoubleSide,depthWrite:false,emissive:0x2a2630,emissiveIntensity:.4}),
 vm=new THREE.LineBasicMaterial({color:0xcfc4aa,transparent:true,opacity:.55});
function wingGeo(L,w){const s=new THREE.Shape();s.moveTo(0,-.35*w);s.bezierCurveTo(L*.22,-1.5*w,L*.75,-1.45*w,L,-.2*w);s.bezierCurveTo(L*.85,.8*w,L*.35,1.25*w,0,.55*w);s.closePath();const g=new THREE.ShapeGeometry(s,16);g.rotateX(-Math.PI/2);return g}
const wings=[];
function mkWing(side,fore){const L=fore?9.2:9.8,w=fore?1:1.3,piv=new THREE.Group();piv.position.set(side*.9,.15,fore?-3.0:-1.9);
  const holder=new THREE.Group();holder.rotation.y=side*(fore?.2:-.22);piv.add(holder);
  const m=new THREE.Mesh(wingGeo(L,w),wm);m.renderOrder=5;if(side<0)m.scale.x=-1;holder.add(m);
  for(let i=0;i<5;i++){const t=(i-2)/2.6,pts=[new THREE.Vector3(0,.02,0),new THREE.Vector3(side*L*.5,.02,-t*.55*w),new THREE.Vector3(side*L*(.93-Math.abs(t)*.12),.02,-t*.3*w*1.0)];holder.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),vm))}
  const anc=new THREE.Object3D();anc.position.set(side*L*.58,0,fore?-.15:.15);holder.add(anc);
  DF.add(piv);wings.push({piv,side,fore,anc,base:fore?.5:-.42,ph:fore?0:.9})}
mkWing(-1,1);mkWing(1,1);mkWing(-1,0);mkWing(1,0);
const A=Object.fromEntries(['exp','evt','mode','q'].map(k=>[k,M.querySelector('[data-wing="'+k+'"]')]));
const WK={exp:[0,-1],evt:[1,-1],mode:[0,1],q:[1,1]}; // [side index, fore/hind]; wing order: L-fore,R-fore,L-hind,R-hind
const wIdx={exp:0,evt:1,mode:2,q:3};
const v3=new THREE.Vector3();let W=1,H=1,T0=performance.now(),run=false,rid=0;
function resize(){W=M.clientWidth||innerWidth;H=M.clientHeight||innerHeight;R.setPixelRatio(Math.min(devicePixelRatio,2));R.setSize(W,H,false);cam.aspect=W/H;
  const th=Math.tan(cam.fov*Math.PI/360),D=Math.max((innerWidth<640?22:28)/(2*th*cam.aspect),(innerWidth<640?20:23)/(2*th));cam.position.set(0,D,2.4);cam.lookAt(0,0,2.4);cam.updateProjectionMatrix()}
function place(el,x,y){const w=el.offsetWidth/2,h=el.offsetHeight/2;x=Math.max(w+8,Math.min(W-w-8,x));y=Math.max(h+8,Math.min(H-h-8,y));el.style.left=x+'px';el.style.top=y+'px'}
function pose(t){const f=reduce.matches?0:Math.sin(t*2*Math.PI*.7);
  for(const w of wings){const a=w.base+.2*Math.sin(t*2*Math.PI*.7+w.ph)*(reduce.matches?0:1);w.piv.rotation.z=w.side*a;
    w.piv.rotation.y=Math.sin(t*2*Math.PI*.7+w.ph+1.2)*.03*(reduce.matches?0:1)}
  DF.position.y=reduce.matches?0:Math.sin(t*1.3)*.15;DF.rotation.z=reduce.matches?0:Math.sin(t*.9)*.012}
function layout(){DF.updateMatrixWorld(true);const P=[];
  for(const k of['exp','evt','mode','q']){wings[wIdx[k]].anc.getWorldPosition(v3);v3.project(cam);P.push([k,(v3.x+1)/2*W,(1-v3.y)/2*H])}
  // keep fore/hind buttons on each side apart
  const minGap=A.exp.offsetHeight+10;for(const[i,j]of[[0,2],[1,3]]){const d=P[j][2]-P[i][2];if(d<minGap){const m=(minGap-d)/2;P[i][2]-=m;P[j][2]+=m}}
  for(const[k,x,y]of P)place(A[k],x,y);
  head.getWorldPosition(v3);v3.project(cam);place($('mStart'),(v3.x+1)/2*W,(1-v3.y)/2*H)}
function draw(now){const t=(now-T0)/1000;pose(t);R.render(S,cam);layout()}
function loop(now){if(!run)return;rid=requestAnimationFrame(loop);draw(now)}
function start(){if(run||reduce.matches||document.hidden||!vis())return;run=true;rid=requestAnimationFrame(loop)}
function stop(){run=false;cancelAnimationFrame(rid)}
function still(){resize();T0=performance.now();draw(T0)}
addEventListener('resize',()=>{resize();if(!run)draw(performance.now())});
document.addEventListener('visibilitychange',()=>document.hidden?stop():start());
reduce.addEventListener&&reduce.addEventListener('change',()=>{stop();still();start()});
// ---- labels ----
function liveSpans(){return[...$('livePanel').querySelectorAll('[data-live]')]}
function evtLabel(){if(set.app==='live'&&live.server){const s=liveSpans().find(x=>x.dataset.live===liveChoice);if(s)return s.textContent.replace(/^LIVE:\s*/,'').split(',')[0]}return cap(set.disaster)}
function refresh(){
  A.exp.querySelector('b').textContent=set.app==='live'&&live.server?'Live '+CITY.name:'Scenario simulator';
  A.evt.querySelector('b').textContent=evtLabel();
  A.mode.querySelector('b').textContent=set.mode==='air'?'Aerial: dragonfly':'Earth: fire truck';
  A.q.querySelector('b').textContent=cap(set.quality);
  $('mDesc').textContent='Explore disaster response across '+CITY.name+'.';
  const st=$('mStart');const t=go?'RESUME':'START';if(st.textContent!==t){st.textContent=t;st.setAttribute('aria-label',t==='START'?'Start':'Resume')}
  if(vis())layout()}
setInterval(()=>{if(vis()){refresh();if(!run)start()}else stop()},400);
// ---- dialogs ----
let opener=null,kind='';
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
function optBtn(o){return'<button class="dopt" role="radio" aria-checked="'+!!o.on+'" tabindex="-1" data-v="'+esc(o.v)+'"'+(o.dis?' aria-disabled="true"':'')+'>'+esc(o.label)+(o.d?'<span>'+esc(o.d)+'</span>':'')+'</button>'}
function group(opts,label,pills){return'<div role="radiogroup" aria-label="'+esc(label)+'"'+(pills?' class="dpills"':'')+'>'+opts.map(optBtn).join('')+'</div>'}
function content(){
  if(kind==='exp'){const lp=$('livePanel');
    let h='<h3>Experience</h3>'+group([{v:'live',label:'Live '+CITY.name,on:set.app==='live'&&live.server,dis:!live.server,d:'Real downtown map of the chosen city (OpenStreetMap), live NWS alerts and wind, people estimated for the current local time. Serious mode.'},
      {v:'scenario',label:'Scenario simulator',on:!(set.app==='live'&&live.server),d:'Pick a disaster. Autopilot finds the route that saves the most lives, or click reports on the map (M) to pick the order yourself.'}],'Experience');
    if(live.server)h+='<h3>City</h3>'+group([...document.querySelectorAll('[data-city]')].map(c=>({v:c.dataset.city,label:c.textContent,on:c.dataset.city===CITY.key})),'City',true);
    else h+='<p>Live city mode needs the local server. In Terminal: <code>cd prototype/flight &amp;&amp; python3 serve.py</code>, then open <code>http://localhost:8765</code>. This version runs the scenario simulator on the cartoon city.</p>';
    return h}
  if(kind==='evt'){
    if(set.app==='live'&&live.server){const p=$('livePanel').querySelector('p');return(p?'<p>'+esc(p.innerText.replace(/\n+/g,' '))+'</p>':'')+group(liveSpans().map(s=>({v:s.dataset.live,label:s.textContent,on:s.dataset.live===liveChoice,d:s.title})),'Live event')}
    return group([...document.querySelectorAll('.opt[data-k="disaster"]')].map(o=>({v:o.dataset.v,label:o.textContent,on:set.disaster===o.dataset.v,d:ROUTING_NOTE[o.dataset.v]})),'Disaster')}
  if(kind==='mode')return group([{v:'air',label:'Aerial: dragonfly',on:set.mode==='air',d:'Fly the rescue dragonfly over the city. Press E in game to swap.'},{v:'ground',label:'Earth: fire truck',on:set.mode==='ground',d:'Drive the fire truck on the road network (nitro, handbrake).'}],'Mode');
  if(kind==='q')return group([{v:'low',label:'Low',on:set.quality==='low',d:'Fastest, for older laptops.'},{v:'medium',label:'Medium',on:set.quality==='medium'},{v:'high',label:'High',on:set.quality==='high',d:'Sharpest, needs a decent GPU.'}],'Quality');
  if(kind==='keys')return'<div class="dkeys">'+M.querySelector('.keys').innerHTML+'</div>';return''}
function render(focusV){dBody.innerHTML=content();const o=[...dBody.querySelectorAll('.dopt')];
  const sel=o.find(x=>focusV!=null?x.dataset.v===focusV:x.getAttribute('aria-checked')==='true')||o.find(x=>x.getAttribute('aria-disabled')!=='true');
  o.forEach(x=>x.tabIndex=x===sel?0:-1);return sel}
const TITLES={exp:'Experience',evt:'Event',mode:'Mode',q:'Quality',keys:'Flight controls'};
function openDlg(k,from){kind=k;opener=from;$('dTitle').textContent=TITLES[k];dlg.hidden=false;const s=render();$('dDone').style.display=(k==='exp'||k==='keys')?'':'none';(s||$('dDone')).focus()}
function closeDlg(){if(dlg.hidden)return;dlg.hidden=true;refresh();if(opener)opener.focus()}
function pick(v){
  if(kind==='exp'){if(v==='live'||v==='scenario'){if(v==='live'&&!live.server)return;document.querySelector('.appcard[data-app="'+v+'"]').click()}else{const c=document.querySelector('[data-city="'+v+'"]');if(c)c.click()}}
  else if(kind==='evt'){if(set.app==='live'&&live.server){const s=liveSpans().find(x=>x.dataset.live===v);if(s)s.click()}else document.querySelector('.opt[data-k="disaster"][data-v="'+v+'"]').click()}
  else if(kind==='mode')document.querySelector('.opt[data-k="mode"][data-v="'+v+'"]').click();
  else if(kind==='q')document.querySelector('.opt[data-k="quality"][data-v="'+v+'"]').click();
  refresh();if(kind==='exp'){const s=render(v);s&&s.focus()}else closeDlg()}
dBody.addEventListener('click',e=>{const b=e.target.closest('.dopt');if(b&&b.getAttribute('aria-disabled')!=='true')pick(b.dataset.v)});
$('dDone').onclick=closeDlg;dlg.addEventListener('mousedown',e=>{if(e.target===dlg)closeDlg()});
Object.entries(A).forEach(([k,b])=>b.onclick=()=>openDlg(k,b));$('mKeys').onclick=e=>openDlg('keys',e.currentTarget);
$('mStart').onclick=()=>$('start').click();
// keyboard: runs before the game's own key handler while the menu is up
document.addEventListener('keydown',e=>{if(!vis())return;
  if(!dlg.hidden){const grp=e.target.closest&&e.target.closest('[role=radiogroup]');
    if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();closeDlg();return}
    if(e.key==='Tab'){const list=[...dlg.querySelectorAll('button')].filter(b=>b.offsetParent&&b.tabIndex>=0),i=list.indexOf(document.activeElement);
      if(list.length){e.preventDefault();list[(i+(e.shiftKey?-1:1)+list.length)%list.length].focus()}e.stopImmediatePropagation();return}
    if(grp&&/^Arrow/.test(e.key)){const o=[...grp.querySelectorAll('.dopt')].filter(x=>x.getAttribute('aria-disabled')!=='true'),i=o.indexOf(document.activeElement);
      if(i>=0){e.preventDefault();const n=o[(i+(/Right|Down/.test(e.key)?1:-1)+o.length)%o.length];o.forEach(x=>x.tabIndex=x===n?0:-1);n.focus()}}
    e.stopImmediatePropagation();return}
  if(e.code==='Escape'&&!go){e.stopImmediatePropagation();return}
  if(e.code==='KeyH'||e.code==='Escape')return; // game handler toggles the menu
  e.stopImmediatePropagation()},true);
resize();refresh();draw(performance.now());start();
})();
