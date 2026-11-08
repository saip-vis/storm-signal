'use strict';
// =====================================================================
// characters.js: toon dragonfly (Aerial: hard hat + hi-vis vest) and fire truck with a dragonfly driver (Earth: fire helmet)
// Built from simple shapes in code from Sai's concept art. Cel shading + ink outlines (helpers in core.js).
// =====================================================================
const wingTex=canvasTex(256,80,(g,w,h)=>{g.clearRect(0,0,w,h);g.beginPath();g.ellipse(w/2,h/2,w/2-4,h/2-5,0,0,7);g.fillStyle='rgba(236,246,246,.62)';g.fill();
  g.save();g.clip();g.strokeStyle='rgba(70,82,88,.55)';g.lineWidth=1.6;for(const y of [.32,.5,.68]){g.beginPath();g.moveTo(6,h/2);g.quadraticCurveTo(w*.5,h*y,w-8,h/2+(y-.5)*h*.5);g.stroke()}
  for(let x=40;x<w-20;x+=26){g.beginPath();g.moveTo(x,6);g.lineTo(x+10,h-6);g.stroke()}g.restore();
  g.beginPath();g.ellipse(w/2,h/2,w/2-4,h/2-5,0,0,7);g.strokeStyle='#1d2427';g.lineWidth=4;g.stroke()});
const wingMat=new THREE.MeshBasicMaterial({map:wingTex,transparent:true,side:THREE.DoubleSide,depthWrite:false});
// firefighter badge: gold shield with a red flame
const badgeTex=canvasTex(64,72,(g)=>{g.fillStyle='#f2b630';g.strokeStyle='#5a3a10';g.lineWidth=4;g.beginPath();g.moveTo(32,4);g.lineTo(60,14);g.lineTo(54,50);g.lineTo(32,68);g.lineTo(10,50);g.lineTo(4,14);g.closePath();g.fill();g.stroke();
  g.fillStyle='#e0362c';g.beginPath();g.moveTo(32,18);g.bezierCurveTo(46,30,46,48,32,56);g.bezierCurveTo(18,48,20,34,28,30);g.bezierCurveTo(28,38,34,38,32,18);g.fill();
  g.fillStyle='#ffc83a';g.beginPath();g.moveTo(32,36);g.bezierCurveTo(39,42,38,52,32,54);g.bezierCurveTo(26,52,26,44,32,36);g.fill()});
function makeDragonfly(o){const root=new THREE.Group(),front=new THREE.Group(),wingsOut=[],I=.03;root.add(front);
  // thorax + optional hi-vis vest
  part(new THREE.SphereGeometry(.42,20,14),COL.mint,front,[0,0,0],null,[1,1.05,1.15],I);
  if(o.vest){const v=part(new THREE.CylinderGeometry(.47,.5,.62,20),COL.orange,front,[0,0,0],[Math.PI/2,0,0],null,I);
    for(const z of [-.12,.12])part(new THREE.TorusGeometry(.49,.045,6,24),COL.silver,front,[0,0,z],null,null)}
  // head with big eyes
  const H=new THREE.Group();H.position.set(0,.2,.7);H.scale.setScalar(1.12);front.add(H);
  part(new THREE.SphereGeometry(.5,22,16),COL.mint,H,null,null,null,I);
  for(const sd of [-1,1]){const e=new THREE.Group();e.position.set(sd*.21,.04,.36);H.add(e);
    part(new THREE.SphereGeometry(.23,16,12),COL.white,e,null,null,[1,1.1,.62],.025);
    part(new THREE.SphereGeometry(.16,16,12),COL.iris,e,[sd*-.01,-.01,.1],null,[1,1.08,.35]);
    part(new THREE.SphereGeometry(.085,12,10),COL.pupil,e,[sd*-.01,-.01,.15],null,[1,1,.3]);
    part(new THREE.SphereGeometry(.04,8,6),new THREE.MeshBasicMaterial({color:0xffffff}),e,[sd*.03+.03,.07,.18])}
  part(new THREE.BoxGeometry(.12,.02,.02),COL.dark,H,[0,-.2,.47]); // tiny mouth
  // hats
  if(o.hat=='hard'){part(new THREE.SphereGeometry(.5,22,12,0,Math.PI*2,0,Math.PI/2),COL.red,H,[0,.3,-.06],null,[1,.92,1.05],I);
    part(new THREE.CylinderGeometry(.6,.6,.06,26),COL.red,H,[0,.31,-.03],[.1,0,0],null,I);part(new THREE.BoxGeometry(.1,.07,.9),COL.redD,H,[0,.76,-.06])}
  if(o.hat=='fire'){part(new THREE.SphereGeometry(.52,22,12,0,Math.PI*2,0,Math.PI/2),COL.red,H,[0,.3,-.06],null,[1,.98,1.08],I);
    part(new THREE.CylinderGeometry(.74,.74,.06,26),COL.red,H,[0,.3,-.16],[-.12,0,0],null,I);part(new THREE.BoxGeometry(.12,.11,.96),COL.redD,H,[0,.8,-.08]);
    part(new THREE.PlaneGeometry(.3,.34),new THREE.MeshBasicMaterial({map:badgeTex,transparent:true}),H,[0,.6,.42],[-.5,0,0])}
  // six legs (two segments each)
  for(const z of [.2,0,-.2])for(const sd of [-1,1]){limb(front,[sd*.22,-.25,z],[sd*.45,-.5,z+.05],.05,COL.mint,.02);limb(front,[sd*.45,-.5,z+.05],[sd*.4,-.82,z+.12],.045,COL.mint,.02)}
  // four wings, hinged on top of the thorax (flap = rotation.z of the hinge group)
  for(const [z,len,yw] of [[.14,2.7,-.12],[-.16,2.4,.22]])for(const sd of [-1,1]){const g=new THREE.Group();g.position.set(sd*.12,.34,z);
    const w=new THREE.Mesh(new THREE.PlaneGeometry(len,len*.31).translate(len/2,0,0).rotateX(-Math.PI/2),wingMat);if(sd<0)w.rotation.y=Math.PI;w.rotation.y+=sd*yw;
    w.renderOrder=2;g.add(w);g.userData={sd,ph:z};wingsOut.push(g);front.add(g)}
  // segmented striped tail
  const tail=new THREE.Group();tail.position.set(0,0,-.42);root.add(tail);let z=0;
  for(let i=0;i<10;i++){const r0=.2-i*.012,r1=.2-(i+1)*.012,L=.32;part(new THREE.CylinderGeometry(r0,r1,L,14),i%2?COL.teal:COL.mint,tail,[0,0,z-L/2],[Math.PI/2,0,0],null,.022);z-=L}
  part(new THREE.SphereGeometry(.08,10,8),COL.teal,tail,[0,0,z],null,null,.02);
  if(o.seated){front.rotation.x=-.85;front.position.set(0,.35,.15)}
  return{group:root,wings:wingsOut,front,tail}}
// Aerial character
const DF=makeDragonfly({hat:'hard',vest:true}),D=DF.group,wings=DF.wings;D.scale.setScalar(1.6);SC.add(D);
// Earth: fire truck + driver
const TR={x:0,z:0,yaw:0,spd:0,y:0},truck=new THREE.Group(),sirenR=new THREE.MeshBasicMaterial({color:0xff2a2a}),sirenB=new THREE.MeshBasicMaterial({color:0x2a6aff});
{const T2=truck,K2=.04,box=(w,h,l,c,p,ink)=>part(new THREE.BoxGeometry(w,h,l),c,T2,p,null,null,ink===undefined?K2:ink);
 box(2.6,1.7,5,COL.red,[0,1.55,-.95]);box(2.6,2.05,2.1,COL.red,[0,1.72,2.5]);                 // rear body, cab
 box(2.1,.8,.06,COL.glass,[0,2.15,3.56],0);for(const sd of [-1,1])box(.06,.7,1.2,COL.glass,[sd*1.31,2.15,2.6],0); // windows
 box(1.0,.55,.06,COL.grey,[0,1.2,3.56],.02);for(const y of [1.05,1.2,1.35])box(.9,.05,.08,COL.dark,[0,y,3.58],0); // grille
 for(const sd of [-1,1]){part(new THREE.CylinderGeometry(.27,.27,.08,18),new THREE.MeshBasicMaterial({color:0xffe08a}),T2,[sd*.85,1.2,3.57],[Math.PI/2,0,0],null,.03)}
 box(2.75,.32,.35,0x8f999a,[0,.72,3.62],.03);box(2.75,.32,.3,0x8f999a,[0,.72,-3.5],.03);                    // bumpers
 for(const sd of [-1,1]){box(.05,.17,7.1,COL.yellow,[sd*1.31,1.02,.05],0);box(.05,.07,7.1,COL.yellow,[sd*1.31,1.26,.05],0); // stripes
   for(const y of [1.8,2.2])limb(T2,[sd*1.36,y,-3.1],[sd*1.36,y,1.1],.05,COL.silver,.015);                         // side ladder rails
   for(let z=-2.9;z<1.1;z+=.45)limb(T2,[sd*1.36,1.8,z],[sd*1.36,2.2,z],.04,COL.silver);                           // rungs
   part(new THREE.CylinderGeometry(.45,.45,.1,24),COL.yellow,T2,[sd*1.36,1.25,-1.6],[0,0,Math.PI/2],null,.03);    // hose reel
   part(new THREE.TorusGeometry(.3,.04,6,20),0xd89a20,T2,[sd*1.42,1.25,-1.6],[0,Math.PI/2,0]);
   box(.06,.22,.22,0xff4030,[sd*1,1.2,-3.46],0)}
 box(1.6,1.2,.06,COL.grey,[0,1.55,-3.47],.02);for(let y=1.05;y<2.1;y+=.18)box(1.5,.03,.08,0x6f787a,[0,y,-3.5],0); // rear roller door
 const wg=new THREE.CylinderGeometry(.66,.66,.5,18);wg.rotateZ(Math.PI/2);const hg=new THREE.CylinderGeometry(.34,.34,.52,14);hg.rotateZ(Math.PI/2);
 for(const [x,z] of [[-1.2,2.35],[1.2,2.35],[-1.2,-2.2],[1.2,-2.2]]){part(wg,0x1b1f21,T2,[x,.66,z],null,null,.03);part(hg,COL.grey,T2,[x*1.02,.66,z])}
 part(new THREE.SphereGeometry(.28,14,10,0,Math.PI*2,0,Math.PI/2),sirenB,T2,[0,2.75,2.5],null,null,.03);part(new THREE.BoxGeometry(.22,.16,.22),sirenR,T2,[-.95,2.82,2.9]);part(new THREE.BoxGeometry(.22,.16,.22),sirenR,T2,[.95,2.82,2.9]);
 part(new THREE.TorusGeometry(.32,.05,8,24),COL.dark,T2,[0,2.95,1.55],[-.9,0,0])}                                    // steering wheel
const PILOT=makeDragonfly({hat:'fire',seated:true});PILOT.group.position.set(0,2.55,.55);truck.add(PILOT.group);
truck.scale.setScalar(1.0);SC.add(truck); // a bit smaller than before (was 1.15)
