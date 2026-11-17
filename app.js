(function(){
'use strict';
var $=function(id){return document.getElementById(id);};
if(typeof THREE==='undefined'||typeof fflate==='undefined'||!THREE.OrbitControls||!THREE.LineSegments2){
  var w0=$('warn'); w0.textContent='The viewer’s 3D engine didn’t load. Reload the page; if this keeps happening, reinstall the app.'; w0.classList.add('on'); return;
}
var view=$('view'), overlay=$('overlay');
var renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
renderer.setClearColor(0x000000,0);
view.insertBefore(renderer.domElement,view.firstChild);
var scene=new THREE.Scene();
var persp=new THREE.PerspectiveCamera(35,1,0.001,1000);
var ortho=new THREE.OrthographicCamera(-1,1,1,-1,-100,100); ortho.userData.halfH=1;
[persp,ortho].forEach(function(c){scene.add(c); var k=new THREE.DirectionalLight(0xffffff,0.62); k.position.set(-0.6,1,0.8); c.add(k);});
var camera=persp;
function setOrthoFrustum(){var a=view.clientWidth/Math.max(1,view.clientHeight),h=ortho.userData.halfH; ortho.left=-h*a; ortho.right=h*a; ortho.top=h; ortho.bottom=-h; ortho.updateProjectionMatrix();}
scene.add(new THREE.AmbientLight(0xffffff,0.42));
scene.add(new THREE.HemisphereLight(0xffffff,0x8a939a,0.25));

// ---------- SolidWorks-style mouse ----------
var controls=new THREE.OrbitControls(camera,renderer.domElement);
controls.enableDamping=true; controls.dampingFactor=0.14; controls.screenSpacePanning=true;
controls.rotateSpeed=0.8; controls.enableZoom=true; controls.zoomSpeed=1.2;
controls.mouseButtons={LEFT:-1,MIDDLE:THREE.MOUSE.ROTATE,RIGHT:THREE.MOUSE.PAN};
// Left button selects (click or drag a box). Middle-drag rotates, Ctrl+drag pans, Shift+middle-drag zooms.
// Alt+left-drag also rotates, for touchpads with no middle button.
view.addEventListener('pointerdown',function(e){
  if(e.pointerType!=='mouse')return;
  var pan=e.ctrlKey||e.metaKey;
  if(state.is2d){   // drawings: middle-drag pans, Ctrl/Alt + left-drag pans, Shift + middle-drag zooms
    controls.mouseButtons.LEFT=(pan||e.altKey)?THREE.MOUSE.PAN:-1;
    controls.mouseButtons.MIDDLE=e.shiftKey?THREE.MOUSE.DOLLY:THREE.MOUSE.PAN;
    return;
  }
  // OrbitControls turns a rotate drag into a pan when Ctrl/Cmd is held, so ROTATE covers both.
  controls.mouseButtons.LEFT=pan?THREE.MOUSE.ROTATE:-1;
  controls.mouseButtons.MIDDLE=pan?THREE.MOUSE.ROTATE:(e.shiftKey?THREE.MOUSE.DOLLY:-1);
},true);
var hud=document.createElement('div'); hud.className='overlay'; view.insertBefore(hud,$('mpanel'));
var pivotEl=document.createElement('div'); pivotEl.className='pivot'; pivotEl.style.display='none'; hud.appendChild(pivotEl);
var Y_AXIS=new THREE.Vector3(0,1,0);
// Turn the view about a fixed point P (the point picked when the drag started), keeping P still on screen.
function rotateAbout(P,dx,dy){
  var h=renderer.domElement.clientHeight||1, az=2*Math.PI*dx/h*0.8, el=2*Math.PI*dy/h*0.8;
  var off=camera.position.clone().sub(controls.target), phi=off.angleTo(Y_AXIS);
  var np=Math.max(0.02,Math.min(Math.PI-0.02,phi-el)); el=phi-np;
  var right=new THREE.Vector3().crossVectors(Y_AXIS,off);
  if(right.lengthSq()<1e-12)right.set(1,0,0).applyQuaternion(camera.quaternion);
  right.normalize();
  var q=new THREE.Quaternion().setFromAxisAngle(Y_AXIS,-az).multiply(new THREE.Quaternion().setFromAxisAngle(right,-el));
  camera.position.sub(P).applyQuaternion(q).add(P);
  controls.target.sub(P).applyQuaternion(q).add(P);
  controls.update(); needsRender=true;
}
var comEl=document.createElement('div'); comEl.className='com'; comEl.style.display='none'; comEl.title='Centre of mass'; hud.appendChild(comEl);
renderer.domElement.addEventListener('contextmenu',function(e){e.preventDefault();});
var reverseZoom=false;
try{reverseZoom=localStorage.getItem('edv.reverseZoom')==='1';}catch(e){}
$('revZoom').checked=reverseZoom;
$('revZoom').onchange=function(){reverseZoom=this.checked; try{localStorage.setItem('edv.reverseZoom',reverseZoom?'1':'0');}catch(e){}};
// Scroll forward = zoom in, centred on the pointer.
view.addEventListener('wheel',function(e){
  if(!state.meshes.length)return;
  e.preventDefault(); e.stopPropagation();
  var dy=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?400:1);
  if(reverseZoom)dy=-dy;
  dy=Math.max(-300,Math.min(300,dy));
  zoomAt(e.clientX,e.clientY,Math.exp(dy*0.0016));
},{capture:true,passive:false});
function worldAt(cx,cy){
  var rect=renderer.domElement.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2((cx-rect.left)/rect.width*2-1,-((cy-rect.top)/rect.height)*2+1),camera);
  var plane=new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()),controls.target);
  return ray.ray.intersectPlane(plane,new THREE.Vector3())||controls.target.clone();
}
function zoomAt(cx,cy,factor){
  if(camera.isOrthographicCamera){
    var before=worldAt(cx,cy), z=camera.zoom/factor;
    if(z>1e5||z<1e-3)return;
    camera.zoom=z; camera.updateProjectionMatrix();
    var dlt=before.sub(worldAt(cx,cy));
    camera.position.add(dlt); controls.target.add(dlt);
    controls.update(); needsRender=true; return;
  }
  var rect=renderer.domElement.getBoundingClientRect();
  var ndc=new THREE.Vector2((cx-rect.left)/rect.width*2-1,-((cy-rect.top)/rect.height)*2+1);
  ray.setFromCamera(ndc,camera);
  var n=camera.getWorldDirection(new THREE.Vector3());
  var plane=new THREE.Plane().setFromNormalAndCoplanarPoint(n,controls.target);
  var P=ray.ray.intersectPlane(plane,new THREE.Vector3())||controls.target.clone();
  var dist=camera.position.distanceTo(controls.target);
  if(factor<1&&dist<state.radius*1e-4)return;
  if(factor>1&&dist>state.radius*60)return;
  camera.position.sub(P).multiplyScalar(factor).add(P);
  controls.target.sub(P).multiplyScalar(factor).add(P);
  updateClip(); controls.update(); needsRender=true;
}
function updateClip(){
  if(camera.isOrthographicCamera){var od=camera.position.distanceTo(controls.target); camera.near=-state.radius*20; camera.far=od+state.radius*20; camera.updateProjectionMatrix(); return;}
  var d=camera.position.distanceTo(controls.target);
  camera.near=Math.max(d/3000,state.radius/1e5); camera.far=d+state.radius*40; camera.updateProjectionMatrix();
}

var modelRoot=new THREE.Group(); scene.add(modelRoot);
var css=function(n){return getComputedStyle(document.documentElement).getPropertyValue(n).trim();};
var edgeMat=new THREE.LineBasicMaterial({color:new THREE.Color(css('--edge')||'#27313A'),transparent:true,opacity:0.55});
var selMat=new THREE.MeshPhongMaterial({color:new THREE.Color(css('--accent')||'#2463D9'),side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1,shininess:40});
var fatSel=new THREE.LineMaterial({color:new THREE.Color(css('--measure')||'#C8246F').getHex(),linewidth:4,depthTest:false,transparent:true});
var fatDim=new THREE.LineMaterial({color:new THREE.Color(css('--measure')||'#C8246F').getHex(),linewidth:2,depthTest:false,transparent:true,dashed:false});
var fatHover=new THREE.LineMaterial({color:new THREE.Color(css('--measure')||'#C8246F').getHex(),linewidth:5,depthTest:false,transparent:true,opacity:0.55});
var fatSel2d=new THREE.LineMaterial({color:new THREE.Color(css('--accent')||'#2463D9').getHex(),linewidth:3,depthTest:false,transparent:true});
var faceSelMat=new THREE.MeshBasicMaterial({color:new THREE.Color(css('--measure')||'#C8246F'),transparent:true,opacity:0.5,side:THREE.DoubleSide,depthWrite:false});
var faceHoverMat=new THREE.MeshBasicMaterial({color:new THREE.Color(css('--measure')||'#C8246F'),transparent:true,opacity:0.28,side:THREE.DoubleSide,depthWrite:false});
function refreshThemeColors(){
  edgeMat.color.set(css('--edge')||'#27313A'); selMat.color.set(css('--accent')||'#2463D9'); selEdgeMat.color.set(css('--accent')||'#2463D9'); fatSel2d.color.set(css('--accent')||'#2463D9');
  [fatSel,fatDim,fatHover,faceSelMat,faceHoverMat].forEach(function(m){m.color.set(css('--measure')||'#C8246F');}); needsRender=true;
}
if(window.matchMedia){var mq=matchMedia('(prefers-color-scheme: dark)'); (mq.addEventListener?mq.addEventListener('change',refreshThemeColors):mq.addListener(refreshThemeColors));}

var needsRender=true;
// Display styles: shaded with edges, shaded, hidden lines removed, wireframe.
var hiddenMat=new THREE.MeshBasicMaterial({visible:false,side:THREE.DoubleSide});
var hlrMat=new THREE.MeshBasicMaterial({colorWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});
var selEdgeMat=new THREE.LineBasicMaterial({color:new THREE.Color(css('--accent')||'#2463D9')});
var displayMode='shadedEdges'; try{displayMode=localStorage.getItem('edv.display')||'shadedEdges';}catch(e){}
if(['shadedEdges','shaded','hlr','wire'].indexOf(displayMode)<0)displayMode='shadedEdges';
function styleMesh(m){
  if(m.userData.is2d)return;
  var lines=displayMode==='wire'||displayMode==='hlr', sel=!!m.userData.sel;
  m.material=displayMode==='wire'?hiddenMat:(displayMode==='hlr'?hlrMat:(sel?selMat:m.userData.base));
  var ed=m.userData.edges;
  if(ed){ed.material=(sel&&lines)?selEdgeMat:edgeMat; ed.visible=m.visible&&displayMode!=='shaded';}
}
function setDisplay(mode){
  displayMode=mode; $('selDisplay').value=mode; try{localStorage.setItem('edv.display',mode);}catch(e){}
  edgeMat.opacity=(mode==='wire'||mode==='hlr')?0.9:0.55;
  state.meshes.forEach(styleMesh); needsRender=true;
}
var state={kind:'easm',is2d:false,sel2d:new Set(),up:'y',unitScale:1,unitless:false,fileKind:'',model:null,root:null,meshes:[],measuring:false,ents:[],sel:[],radius:1,units:'mm',mObjs:[],massOn:false,comAt:null,pivotAt:null};
var matCache=new Map();
function matFor(rgb){
  var k=rgb.join(','), m=matCache.get(k);
  if(!m){m=new THREE.MeshPhongMaterial({color:new THREE.Color(rgb[0]/255,rgb[1]/255,rgb[2]/255),side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1,shininess:28,specular:0x222222});matCache.set(k,m);}
  return m;
}
function resize(){
  var w=view.clientWidth,h=view.clientHeight; if(!w||!h)return;
  renderer.setSize(w,h,false); persp.aspect=w/h; persp.updateProjectionMatrix(); setOrthoFrustum();
  fatSel.resolution.set(w,h); fatDim.resolution.set(w,h); fatHover.resolution.set(w,h); fatSel2d.resolution.set(w,h); needsRender=true;
}
window.addEventListener('resize',resize);
if(window.ResizeObserver)new ResizeObserver(resize).observe(view);
resize();
controls.addEventListener('change',function(){needsRender=true;});
(function loop(){
  requestAnimationFrame(loop);
  controls.update();
  if(needsRender){renderer.render(scene,camera); needsRender=false; updateOverlay();}
})();

// ---------- loading ----------
function busy(on,text,frac){
  $('busy').classList.toggle('on',!!on);
  if(text)$('busyText').textContent=text;
  if(frac!=null)$('busyBar').style.width=Math.round(frac*100)+'%';
}
var tick=function(){return new Promise(function(r){setTimeout(r,16);});};
function showWarn(msg){var w=$('warn'); w.textContent=msg||''; w.title=msg?'Click to dismiss':''; w.classList.toggle('on',!!msg);}
$('warn').addEventListener('click',function(){this.classList.remove('on');});
async function openFile(file){
  if(!file)return;
  var kind=FMT.kind(file.name);
  if(!kind){showWarn('This viewer opens .easm, .eprt, .step, .stp, .stl, .3mf, .dxf and .dwg files.'); return;}
  showWarn(''); $('preview').style.display='none';
  busy(true,'Reading '+file.name+'…',0.02); await tick();
  try{
    var buf=new Uint8Array(await file.arrayBuffer()), m;
    if(kind==='easm'){
      busy(true,'Unpacking…',0.08); await tick();
      var u=EASM.unpack(buf);
      if(u.preview){var bin=''; for(var k=0;k<u.preview.length;k+=8192)bin+=String.fromCharCode.apply(null,u.preview.subarray(k,k+8192)); var img=$('preview'); img.src='data:image/jpeg;base64,'+btoa(bin); img.style.display='block';}
      busy(true,'Decompressing model data…',0.15); await tick();
      var raw=EASM.inflateModel(u.eModel);
      busy(true,'Reading model structure…',0.35); await tick();
      var model=EASM.parse(raw);
      if(!model.shellCount)throw new Error('No 3D surfaces were found in this file. Drawings (.edrw) aren’t supported.');
      await build(model,file.name);
      if(model.warnings.length)showWarn(model.warnings[0]+' Some geometry may be missing.');
      return;
    }
    if(kind==='stl'){busy(true,'Reading triangles…',0.1); await tick(); m=FMT.parseSTL(buf,file.name); m.up=pref('up.stl')||'z';}
    else if(kind==='3mf'){busy(true,'Unpacking…',0.1); await tick(); m=FMT.parse3MF(buf,file.name); m.up='z';}
    else if(kind==='step'){var up=FMT.upGuess('step',buf); m=FMT.fromOcct(await readStep(buf),file.name); m.up=up;}
    else{
      var text=FMT.decodeText(kind==='dwg'?await convertDwg(buf):buf);
      busy(true,'Reading drawing…',0.5); await tick();
      m=FMT.parseDXF(text,file.name);
      await build2D(m,kind);
      if(m.warnings.length)showWarn(m.warnings.join(' '));
      return;
    }
    await buildMesh(m,kind);
    if(m.warnings&&m.warnings.length)showWarn(m.warnings.join(' '));
  }catch(e){console.error(e); showWarn((e&&e.message)?e.message:'This file couldn’t be read.');}
  finally{busy(false);}
}
function pref(k){try{return localStorage.getItem('edv.'+k);}catch(e){return null;}}
function setPref(k,v){try{localStorage.setItem('edv.'+k,v);}catch(e){}}
// STEP (OpenCascade) and DWG conversion run in workers so the page stays responsive.
var stepWorker=null, dwgWorker=null;
function workerJob(make,msg,transfer,label,frac){
  return new Promise(function(resolve,reject){
    var w; try{w=make();}catch(err){reject(new Error('This file type needs the viewer opened from its web address, not from a saved copy.')); return;}
    var t0=performance.now(), iv=setInterval(function(){busy(true,label+' '+Math.round((performance.now()-t0)/1000)+' s',frac);},1000);
    busy(true,label,frac);
    w.onmessage=function(ev){clearInterval(iv); if(ev.data&&ev.data.error)reject(new Error(ev.data.error)); else resolve(ev.data);};
    w.onerror=function(ev){clearInterval(iv); if(ev.preventDefault)ev.preventDefault(); reject(new Error('the converter stopped unexpectedly, possibly because the file is too large for this device'));};
    w.postMessage(msg,transfer);
  });
}
async function readStep(buf){
  try{
    var r=await workerJob(function(){if(!stepWorker)stepWorker=new Worker('step-worker.js'); return stepWorker;},{buffer:buf.buffer,params:{linearUnit:'meter'}},[buf.buffer],'Converting STEP geometry…',0.3);
    return r.result;
  }catch(e){if(stepWorker){stepWorker.terminate(); stepWorker=null;} throw new Error('This STEP file couldn’t be converted: '+e.message+'.');}
}
async function convertDwg(buf){
  try{
    var r=await workerJob(function(){if(!dwgWorker)dwgWorker=new Worker('dwg-worker.js',{type:'module'}); return dwgWorker;},{buffer:buf.buffer},[buf.buffer],'Converting DWG…',0.2);
    return r.dxf;
  }catch(e){if(dwgWorker){dwgWorker.terminate(); dwgWorker=null;} throw new Error('This DWG couldn’t be converted ('+e.message+'). DWG files from AutoCAD R13 to 2018 are supported; saving the drawing as DXF usually works.');}
}
var geomCache=new Map();
function clearModel(){
  clearAll(); setMeasuring(false);
  if(state.is2d)setMode2d(false);
  d2.ents=[]; d2.layers=[]; d2.grid=null; state.kind='easm'; state.up='y'; state.unitScale=1; state.unitless=false; state.fileKind='';
  modelRoot.rotation.set(0,0,0); modelRoot.scale.set(1,1,1); modelRoot.updateMatrixWorld(true);
  while(modelRoot.children.length)modelRoot.remove(modelRoot.children[0]);
  geomCache.forEach(function(g){if(g){g.geo.dispose(); if(g.edges)g.edges.dispose();}});
  geomCache.clear(); state.meshes=[]; $('tree').innerHTML='';
}
function buildGeometry(model,seg){
  if(geomCache.has(seg.path))return geomCache.get(seg.path);
  var total=0,parts=[];
  for(var i=0;i<seg.shells.length;i++){var r=EASM.decodeShell(model,seg.shells[i]); if(r.idx.length){parts.push(r); total+=seg.shells[i].n;}}
  if(!parts.length){geomCache.set(seg.path,null);return null;}
  var pos=new Float32Array(total*3), idxCount=0;
  for(i=0;i<parts.length;i++)idxCount+=parts[i].idx.length;
  var IA=total>65535?Uint32Array:Uint16Array;
  var idx=new IA(idxCount), edges=[], eshell=[], shellStart=[], vo=0, io=0;
  for(i=0;i<parts.length;i++){
    var r2=parts[i], n=r2.pos.length/3;
    pos.set(r2.pos,vo*3); shellStart.push(io);
    for(var j=0;j<r2.idx.length;j++)idx[io++]=r2.idx[j]+vo;
    var be=EASM.boundaryEdges(r2.idx,n);
    for(j=0;j<be.length;j+=2){edges.push(be[j]+vo,be[j+1]+vo); eshell.push(i);}
    vo+=n;
  }
  var geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
  geo.setIndex(new THREE.BufferAttribute(idx,1));
  geo.computeVertexNormals(); geo.computeBoundingBox(); geo.computeBoundingSphere();
  var eg=null, edgeIdx=new IA(edges);
  if(edges.length){eg=new THREE.BufferGeometry(); eg.setAttribute('position',geo.getAttribute('position')); eg.setIndex(new THREE.BufferAttribute(edgeIdx,1)); eg.boundingSphere=geo.boundingSphere; eg.boundingBox=geo.boundingBox;}
  shellStart.push(io);
  var g={geo:geo,edges:eg,tris:idxCount/3,edgeIdx:edgeIdx,edgeShell:new Int32Array(eshell),shellStart:new Uint32Array(shellStart),topo:null};
  geomCache.set(seg.path,g);
  return g;
}
function localMatrix(m){
  var M=new THREE.Matrix4(); if(!m)return M;
  M.set(m[0],m[3],m[6],m[9], m[1],m[4],m[7],m[10], m[2],m[5],m[8],m[11], 0,0,0,1);
  return M;
}
function faceVis(s){return (s.vis&&(s.vis[0]&1))?!!(s.vis[1]&1):null;}
function isLibrary(path){return /^\/\??include library/.test(path);}

async function build(model,fileName){
  clearModel();
  state.model=model;
  var title=(model.title||fileName).replace(/\.(sldasm|sldprt|easm|eprt)$/i,'');
  $('title').textContent=title;
  var rootNode={name:title,children:[],meshes:[],visible:true,parent:null,depth:0};
  state.root=rootNode;
  var jobs=[];
  function visit(path,M,color,node,chain){
    var s=model.segs.get(path); if(!s||chain.indexOf(path)>=0)return;
    chain=chain.concat(path);
    var W=M.clone().multiply(localMatrix(s.matrix));
    color=s.color||color;
    var nm=EASM.nameOf(s.opts), fv=faceVis(s);
    if(nm){
      var child={name:nm,children:[],meshes:[],visible:!(/defaultvisibility=off/.test(s.opts)||fv===false),parent:node,depth:node.depth+1};
      node.children.push(child); node=child;
    }else if(fv===false)return;
    if(s.shells.length)jobs.push({seg:s,M:W,color:color,node:node});
    for(var i=0;i<s.kids.length;i++){
      if(path==='/'&&isLibrary(s.kids[i]))continue; // libraries are drawn only where they’re included
      visit(s.kids[i],W,color,node,chain);
    }
    for(i=0;i<s.includes.length;i++)visit(s.includes[i],W,color,node,chain);
  }
  visit(model.root,new THREE.Matrix4(),[190,196,202],rootNode,[]);
  var tris=0;
  for(var i=0;i<jobs.length;i++){
    var jb=jobs[i];
    if(i%40===0){busy(true,'Building 3D view… '+i+' of '+jobs.length+' bodies',0.4+0.55*i/jobs.length); await tick();}
    var g=buildGeometry(model,jb.seg); if(!g)continue;
    var mesh=new THREE.Mesh(g.geo,matFor(jb.color));
    mesh.userData.g=g; mesh.userData.node=jb.node; mesh.userData.base=mesh.material;
    mesh.matrixAutoUpdate=false; mesh.matrix.copy(jb.M);
    modelRoot.add(mesh);
    if(g.edges){var ln=new THREE.LineSegments(g.edges,edgeMat); ln.matrixAutoUpdate=false; ln.matrix.copy(jb.M); ln.raycast=function(){}; modelRoot.add(ln); mesh.userData.edges=ln;}
    jb.node.meshes.push(mesh); state.meshes.push(mesh); tris+=g.tris;
  }
  finishBuild(rootNode,state.meshes.length.toLocaleString()+' bodies, '+fmtTris(tris)+'<br>Model units: metres');
}
function fmtTris(n){return n<10000?n.toLocaleString()+' triangles':n<1e6?Math.round(n/1000).toLocaleString()+'k triangles':(n/1e6).toFixed(1)+'M triangles';}
function finishBuild(rootNode,statsHtml){
  // A part with several bodies: list them so each can be hidden.
  if(!state.is2d&&!rootNode.children.length&&rootNode.meshes.length>1){
    rootNode.meshes.forEach(function(m,k){rootNode.children.push({name:'Body '+(k+1),children:[],meshes:[m],visible:true,parent:rootNode,depth:1}); m.userData.node=rootNode.children[k];});
    rootNode.meshes=[];
  }
  applyModelTransform();
  renderTree(rootNode); applyVisibility();
  ['btnFit','selView','selProj','selDisplay','btnMeasure','btnMass','search','btnShowAll'].forEach(function(id){$(id).disabled=false;});
  $('empty').style.display='none';
  renderStats(statsHtml);
  state.radius=1;
  if(state.is2d){fit(null,new THREE.Vector3(0,0,1)); d2Fit();} else setView('iso');
  updateMass();
}
var UNIT_SCALE={mm:0.001,cm:0.01,m:1,in:0.0254};
function applyModelTransform(){
  modelRoot.scale.setScalar(state.unitScale);
  modelRoot.rotation.set(state.up==='z'&&!state.is2d?-Math.PI/2:0,0,0);
  modelRoot.updateMatrixWorld(true);
}
// Read-outs use the model's own axes: Z-up files are turned to Y-up for viewing.
function dispVec(v){return (state.up==='z'&&!state.is2d)?new THREE.Vector3(v.x,-v.z,v.y):v;}
function renderStats(html){
  var st=$('stats'), extra='';
  if(state.unitless)extra+='<label>File units <select id="selFileUnit" aria-label="Units the file was drawn in">'+['mm','cm','m','in'].map(function(u){return '<option value="'+u+'"'+(UNIT_SCALE[u]===state.unitScale?' selected':'')+'>'+u+'</option>';}).join('')+'</select></label>';
  if(state.kind==='mesh')extra+='<label>Up <select id="selUp" aria-label="Up axis"><option value="z"'+(state.up==='z'?' selected':'')+'>Z</option><option value="y"'+(state.up==='y'?' selected':'')+'>Y</option></select></label>';
  st.innerHTML=html+'<br>'+(extra?'<span class="opts">'+extra+'</span> ':'')+'viewer version 9';
  var fu=$('selFileUnit');
  if(fu)fu.onchange=function(){state.unitScale=UNIT_SCALE[this.value]; setPref('unit.'+state.fileKind,this.value); clearMeasure(); applyModelTransform(); if(state.is2d){d2SetSel([]); fit(null,new THREE.Vector3(0,0,1)); d2Fit();} else fit(); updateMass();};
  var su=$('selUp');
  if(su)su.onchange=function(){state.up=this.value; if(state.fileKind==='stl')setPref('up.stl',this.value); clearMeasure(); applyModelTransform(); setView('iso'); updateMass();};
}

// ---------- STL, 3MF and STEP ----------
function meshGeometry(b){
  if(geomCache.has(b.key))return geomCache.get(b.key);
  var pos=b.pos, idx=b.idx, ss=b.shellStart, normals=b.normals||null;
  if(!idx.length){geomCache.set(b.key,null); return null;}
  if(!ss){var sg=FMT.segmentFaces(pos,idx,30); pos=sg.pos; idx=sg.idx; ss=sg.shellStart; normals=null;}
  var nv=pos.length/3, IA=nv>65535?Uint32Array:Uint16Array, edges=[], eshell=[];
  for(var f=0;f+1<ss.length;f++){
    if(ss[f+1]<=ss[f])continue;
    var be=EASM.boundaryEdges(idx.subarray(ss[f],ss[f+1]),nv);
    for(var j=0;j<be.length;j+=2){edges.push(be[j],be[j+1]); eshell.push(f);}
  }
  var geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.BufferAttribute(pos instanceof Float32Array?pos:new Float32Array(pos),3));
  geo.setIndex(new THREE.BufferAttribute((IA===Uint32Array&&idx instanceof Uint32Array)?idx:new IA(idx),1));
  if(normals&&normals.length===pos.length)geo.setAttribute('normal',new THREE.BufferAttribute(normals,3)); else geo.computeVertexNormals();
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  var edgeIdx=new IA(edges), eg=null;
  if(edges.length){eg=new THREE.BufferGeometry(); eg.setAttribute('position',geo.getAttribute('position')); eg.setIndex(new THREE.BufferAttribute(edgeIdx,1)); eg.boundingSphere=geo.boundingSphere; eg.boundingBox=geo.boundingBox;}
  var g={geo:geo,edges:eg,tris:idx.length/3,edgeIdx:edgeIdx,edgeShell:new Int32Array(eshell),shellStart:new Uint32Array(ss),topo:null};
  geomCache.set(b.key,g);
  return g;
}
async function buildMesh(model,kind){
  clearModel();
  state.kind='mesh'; state.fileKind=kind; state.model={massProps:null}; state.up=model.up||'z';
  state.unitless=!!model.unitless;
  state.unitScale=model.unitless?(UNIT_SCALE[pref('unit.'+kind)]||model.scale):model.scale;
  $('title').textContent=model.title;
  var rootNode={name:model.title,children:[],meshes:[],visible:true,parent:null,depth:0}, jobs=[];
  state.root=rootNode;
  (function conv(src,node){
    src.bodies.forEach(function(b){jobs.push({b:b,node:node});});
    src.children.forEach(function(c){var ch={name:c.name||'Part',children:[],meshes:[],visible:true,parent:node,depth:node.depth+1}; node.children.push(ch); conv(c,ch);});
  })(model.root,rootNode);
  var tris=0;
  for(var i=0;i<jobs.length;i++){
    if(i%10===0){busy(true,'Building 3D view… '+i+' of '+jobs.length+' bodies',0.5+0.45*i/jobs.length); await tick();}
    var jb=jobs[i], g=meshGeometry(jb.b); if(!g)continue;
    var mesh=new THREE.Mesh(g.geo,matFor(jb.b.color||[176,184,191])), M=localMatrix(jb.b.matrix);
    mesh.userData.g=g; mesh.userData.node=jb.node; mesh.userData.base=mesh.material;
    mesh.matrixAutoUpdate=false; mesh.matrix.copy(M);
    modelRoot.add(mesh);
    if(g.edges){var ln=new THREE.LineSegments(g.edges,edgeMat); ln.matrixAutoUpdate=false; ln.matrix.copy(M); ln.raycast=function(){}; modelRoot.add(ln); mesh.userData.edges=ln;}
    jb.node.meshes.push(mesh); state.meshes.push(mesh); tris+=g.tris;
  }
  var unitNote=(model.unitless||kind==='step')?'':'Model units: '+({0.001:'mm',0.01:'cm',1:'m',0.0254:'in',0.3048:'ft',0.000001:'µm'}[model.scale]||'file units');
  finishBuild(rootNode,state.meshes.length.toLocaleString()+' bod'+(state.meshes.length===1?'y':'ies')+', '+fmtTris(tris)+(unitNote?'<br>'+unitNote:''));
}

// ---------- 2D drawings (DXF, DWG) ----------
var d2={ents:[],layers:[],grid:null,hidden:null,selObj:null,ox:0,oy:0};
var INK=[226,230,234];
function d2Color(c){
  if(!c)return INK;
  var l=0.299*c[0]+0.587*c[1]+0.114*c[2];
  if((c[0]>245&&c[1]>245&&c[2]>245)||l<18)return INK;           // white and black follow the background
  if(l<80)return [Math.round(c[0]+(255-c[0])*0.45),Math.round(c[1]+(255-c[1])*0.45),Math.round(c[2]+(255-c[2])*0.45)];
  return c;
}
function setMode2d(on){
  state.is2d=on; view.classList.toggle('two-d',on);
  controls.enableRotate=!on;
  controls.touches.ONE=on?THREE.TOUCH.PAN:THREE.TOUCH.ROTATE;
  ['selView','selProj','selDisplay'].forEach(function(id){$(id).hidden=on;});
  $('btnMass').textContent=on?'Properties':'Mass';
  if(on){state.prevProj=camera===ortho?'ortho':'persp'; setProjection('ortho',true); camera.up.set(0,1,0);}
  else if(state.prevProj==='persp')setProjection('persp',true);
  if(d2.selObj){scene.remove(d2.selObj); d2.selObj.geometry.dispose(); d2.selObj=null;}
  state.sel2d=new Set();
}
function d2EachSeg(e,f){
  var p=e.pts,k;
  if(e.pairs){for(k=0;k+3<p.length;k+=4)f(p[k],p[k+1],p[k+2],p[k+3]); return;}
  for(k=0;k+3<p.length;k+=2)f(p[k],p[k+1],p[k+2],p[k+3]);
  if(e.closed&&p.length>=6)f(p[p.length-2],p[p.length-1],p[0],p[1]);
}
function d2Rebuild(li){
  var lay=d2.layers[li], n=0, ox=d2.ox, oy=d2.oy;
  lay.ents.forEach(function(id){if(d2.hidden[id])return; var e=d2.ents[id]; n+=e.pairs?e.pts.length/4:(e.pts.length/2-1+(e.closed&&e.pts.length>=6?1:0));});
  var pos=new Float32Array(n*6), col=new Float32Array(n*6), o=0;
  lay.ents.forEach(function(id){
    if(d2.hidden[id])return;
    var e=d2.ents[id], r=e.color[0]/255, g=e.color[1]/255, b=e.color[2]/255;
    d2EachSeg(e,function(x1,y1,x2,y2){pos[o]=x1-ox;pos[o+1]=y1-oy;pos[o+3]=x2-ox;pos[o+4]=y2-oy; col[o]=r;col[o+1]=g;col[o+2]=b;col[o+3]=r;col[o+4]=g;col[o+5]=b; o+=6;});
  });
  var geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.BufferAttribute(pos,3)); geo.setAttribute('color',new THREE.BufferAttribute(col,3));
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  if(lay.obj.geometry)lay.obj.geometry.dispose();
  lay.obj.geometry=geo; needsRender=true;
}
function d2BuildIndex(){
  var minx=Infinity,miny=Infinity,maxx=-Infinity,maxy=-Infinity,segs=0;
  d2.ents.forEach(function(e){if(e.minx<minx)minx=e.minx; if(e.miny<miny)miny=e.miny; if(e.maxx>maxx)maxx=e.maxx; if(e.maxy>maxy)maxy=e.maxy; segs+=e.pts.length/4;});
  var G=Math.max(16,Math.min(512,Math.ceil(Math.sqrt(segs/2)))), cw=Math.max((maxx-minx)/G,1e-9), ch=Math.max((maxy-miny)/G,1e-9), cells=new Map();
  function cx(x){return Math.max(0,Math.min(G-1,Math.floor((x-minx)/cw)));}
  function cy(y){return Math.max(0,Math.min(G-1,Math.floor((y-miny)/ch)));}
  d2.ents.forEach(function(e,id){
    d2EachSeg(e,function(x1,y1,x2,y2){
      for(var gy=cy(Math.min(y1,y2));gy<=cy(Math.max(y1,y2));gy++)for(var gx=cx(Math.min(x1,x2));gx<=cx(Math.max(x1,x2));gx++){
        var key=gy*G+gx, l=cells.get(key); if(!l){l=[]; cells.set(key,l);} if(l[l.length-1]!==id)l.push(id);
      }
    });
  });
  d2.grid={G:G,cells:cells,cx:cx,cy:cy};
}
function d2Near(x,y,r){
  var gr=d2.grid, out=new Set(); if(!gr)return out;
  for(var gy=gr.cy(y-r);gy<=gr.cy(y+r);gy++)for(var gx=gr.cx(x-r);gx<=gr.cx(x+r);gx++){var l=gr.cells.get(gy*gr.G+gx); if(l)for(var i=0;i<l.length;i++)out.add(l[i]);}
  return out;
}
function d2Visible(id){return !d2.hidden[id]&&d2.layers[d2.ents[id].layer].obj.visible;}
function d2Local(cx,cy){var w=worldAt(cx,cy); modelRoot.worldToLocal(w); return w;}
function d2World(x,y){return modelRoot.localToWorld(new THREE.Vector3(x,y,0));}
function d2Wpp(){return (camera.top-camera.bottom)/camera.zoom/(renderer.domElement.clientHeight||1)/state.unitScale;}
function segDist(px,py,x1,y1,x2,y2){var vx=x2-x1,vy=y2-y1,l2=vx*vx+vy*vy,t=l2?Math.max(0,Math.min(1,((px-x1)*vx+(py-y1)*vy)/l2)):0; return Math.hypot(x1+vx*t-px,y1+vy*t-py);}
function d2Pick(cx,cy,px,noText){
  var L=d2Local(cx,cy), r=px*d2Wpp(), best=r, bid=-1;
  d2Near(L.x,L.y,r).forEach(function(id){
    var e=d2.ents[id]; if((noText&&e.text)||!d2Visible(id))return;
    d2EachSeg(e,function(x1,y1,x2,y2){var dd=segDist(L.x,L.y,x1,y1,x2,y2); if(dd<best){best=dd; bid=id;}});
  });
  return bid;
}
// Measure in drawings: end points (snap) > lines, arcs and circles.
function measurePick2d(cx,cy){
  var L=d2Local(cx,cy), w=d2Wpp(), best=11*w, bp=null, bk=null;
  d2Near(L.x,L.y,12*w).forEach(function(id){
    var e=d2.ents[id]; if(e.text||e.closed||!d2Visible(id))return;
    var p=e.pts;
    [[p[0],p[1],0],[p[p.length-2],p[p.length-1],1]].forEach(function(q){var dd=Math.hypot(q[0]-L.x,q[1]-L.y); if(dd<best){best=dd; bp=q; bk='p'+id+'_'+q[2];}});
  });
  if(bp)return {type:'point',p:d2World(bp[0],bp[1]),snapped:true,key:bk};
  var id=d2Pick(cx,cy,9,true); if(id<0)return null;
  var e=d2.ents[id], pts=[];
  for(var k=0;k+1<e.pts.length;k+=2)pts.push(d2World(e.pts[k],e.pts[k+1]));
  var c=classify({pts:pts,closed:e.closed}); c.key='e'+id; return c;
}
function d2SetSel(ids){
  state.sel2d=new Set(ids.filter(function(id){return id>=0&&d2Visible(id);}));
  if(d2.selObj){scene.remove(d2.selObj); d2.selObj.geometry.dispose(); d2.selObj=null;}
  if(state.sel2d.size){
    var arr=[];
    state.sel2d.forEach(function(id){d2EachSeg(d2.ents[id],function(x1,y1,x2,y2){var a=d2World(x1,y1),b=d2World(x2,y2); arr.push(a.x,a.y,0,b.x,b.y,0);});});
    var g=new THREE.LineSegmentsGeometry(); g.setPositions(arr);
    d2.selObj=new THREE.LineSegments2(g,fatSel2d); d2.selObj.renderOrder=997; scene.add(d2.selObj);
  }
  $('btnHideSel').disabled=!state.sel2d.size; $('btnIsolate').disabled=!state.sel2d.size;
  d2ShowSelInfo(); updateMass(); needsRender=true;
}
function d2EntLength(e){var L=0; if(!e.text)d2EachSeg(e,function(x1,y1,x2,y2){L+=Math.hypot(x2-x1,y2-y1);}); return L*state.unitScale;}
function d2ShowSelInfo(){
  var sp=$('spanel'), s=state.sel2d;
  if(state.measuring||!s.size){sp.classList.remove('on'); return;}
  var layers=new Set(), len=0;
  s.forEach(function(id){var e=d2.ents[id]; layers.add(d2.layers[e.layer].name); len+=d2EntLength(e);});
  sp.innerHTML='';
  var h=document.createElement('h2'); h.textContent=s.size===1?'1 item selected':s.size.toLocaleString()+' items selected'; sp.appendChild(h);
  var pp=document.createElement('p'); pp.className='hint';
  var ln=Array.from(layers);
  pp.textContent=(len>0?'Length '+fmt(len)+'. ':'')+(ln.length>1?'Layers ':'Layer ')+ln.slice(0,3).join(', ')+(ln.length>3?' and '+(ln.length-3)+' more':'')+'.';
  sp.appendChild(pp);
  var acts=document.createElement('div'); acts.className='acts';
  [['Hide',function(){$('btnHideSel').click();}],['Isolate',function(){$('btnIsolate').click();}],['Zoom to',function(){d2ZoomTo(Array.from(state.sel2d));}]].forEach(function(a){
    var b=document.createElement('button'); b.className='btn'; b.textContent=a[0]; b.onclick=a[1]; acts.appendChild(b);});
  sp.appendChild(acts); sp.classList.add('on');
}
function d2Bounds(ids){
  var b={minx:Infinity,miny:Infinity,maxx:-Infinity,maxy:-Infinity};
  ids.forEach(function(id){var e=d2.ents[id]; if(e.minx<b.minx)b.minx=e.minx; if(e.miny<b.miny)b.miny=e.miny; if(e.maxx>b.maxx)b.maxx=e.maxx; if(e.maxy>b.maxy)b.maxy=e.maxy;});
  return b;
}
function d2ZoomTo(ids){if(ids.length)d2ZoomBox(d2Bounds(ids));}
function d2Fit(){if(d2.fitBox)d2ZoomBox(d2.fitBox);}
// "Zoom extents" that ignores a few stray items far from the rest of the drawing.
function d2FitBox(){
  var n=d2.ents.length, all=d2Bounds(d2AllVisible());
  if(n<50)return {box:all,trimmed:false};
  var x0=[],x1=[],y0=[],y1=[];
  d2.ents.forEach(function(e,id){if(!d2Visible(id))return; x0.push(e.minx); x1.push(e.maxx); y0.push(e.miny); y1.push(e.maxy);});
  if(x0.length<50)return {box:all,trimmed:false};
  [x0,x1,y0,y1].forEach(function(a){a.sort(function(p,q){return p-q;});});
  var lo=Math.floor(x0.length*0.005), hi=Math.ceil(x0.length*0.995)-1;
  var b={minx:x0[lo],maxx:x1[hi],miny:y0[lo],maxy:y1[hi]};
  var trimmed=(b.maxx-b.minx)<(all.maxx-all.minx)*0.2||(b.maxy-b.miny)<(all.maxy-all.miny)*0.2;
  return {box:trimmed?b:all,trimmed:trimmed};
}
function d2ZoomBox(b){
  var a=d2World(b.minx,b.miny), c2=d2World(b.maxx,b.maxy), c=a.clone().add(c2).multiplyScalar(0.5);
  var w=Math.max(Math.abs(c2.x-a.x),1e-6), h=Math.max(Math.abs(c2.y-a.y),1e-6), asp=view.clientWidth/Math.max(1,view.clientHeight);
  ortho.userData.halfH=Math.max(h/2,w/2/asp)*1.15; ortho.zoom=1; setOrthoFrustum();
  controls.target.copy(c); ortho.position.set(c.x,c.y,state.radius*4+1); camera.up.set(0,1,0);
  updateClip(); controls.update(); needsRender=true;
}
function d2LayerIds(li){return d2.layers[li].ents.filter(d2Visible);}
function d2AllVisible(){var out=[]; for(var i=0;i<d2.ents.length;i++)if(d2Visible(i))out.push(i); return out;}
// Box select: left to right takes items fully inside; right to left takes anything the box touches.
function d2BoxSelect(x0,y0,x1,y1,crossing){
  var a=d2Local(Math.min(x0,x1),Math.min(y0,y1)), b=d2Local(Math.max(x0,x1),Math.max(y0,y1));
  var L=Math.min(a.x,b.x),R=Math.max(a.x,b.x),B=Math.min(a.y,b.y),T=Math.max(a.y,b.y), out=[];
  function inside(x,y){return x>=L&&x<=R&&y>=B&&y<=T;}
  function hits(x1,y1,x2,y2){
    if(inside(x1,y1)||inside(x2,y2))return true;
    var t0=0,t1=1,dx=x2-x1,dy=y2-y1,p=[-dx,dx,-dy,dy],q=[x1-L,R-x1,y1-B,T-y1];
    for(var i=0;i<4;i++){if(p[i]===0){if(q[i]<0)return false;}else{var t=q[i]/p[i]; if(p[i]<0){if(t>t1)return false; if(t>t0)t0=t;}else{if(t<t0)return false; if(t<t1)t1=t;}}}
    return true;
  }
  for(var id=0;id<d2.ents.length;id++){
    var e=d2.ents[id]; if(!d2Visible(id)||e.maxx<L||e.minx>R||e.maxy<B||e.miny>T)continue;
    if(!crossing){if(e.minx>=L&&e.maxx<=R&&e.miny>=B&&e.maxy<=T)out.push(id); continue;}
    var hit=false; d2EachSeg(e,function(x1,y1,x2,y2){if(!hit&&hits(x1,y1,x2,y2))hit=true;}); if(hit)out.push(id);
  }
  return out;
}
function d2HideIds(ids){
  var touched=new Set();
  ids.forEach(function(id){d2.hidden[id]=1; touched.add(d2.ents[id].layer);});
  touched.forEach(d2Rebuild);
}
async function build2D(model,kind){
  clearModel();
  state.kind='2d'; state.fileKind=kind; state.model={massProps:null}; state.unitless=!!model.unitless;
  state.unitScale=model.unitless?(UNIT_SCALE[pref('unit.'+kind)]||model.scale):model.scale;
  setMode2d(true);
  $('title').textContent=model.title;
  var rootNode={name:model.title,children:[],meshes:[],visible:true,parent:null,depth:0};
  state.root=rootNode;
  var minx=Infinity,miny=Infinity,maxx=-Infinity,maxy=-Infinity;
  model.layers.forEach(function(Ly,li){
    var node={name:Ly.name,children:[],meshes:[],visible:!Ly.off,parent:rootNode,depth:1,layer:li};
    rootNode.children.push(node);
    var lay={name:Ly.name,node:node,ents:[],obj:null}; d2.layers.push(lay);
    Ly.prims.forEach(function(p){
      var a=p.pts, ex0=Infinity,ey0=Infinity,ex1=-Infinity,ey1=-Infinity;
      for(var k=0;k+1<a.length;k+=2){var x=a[k],y=a[k+1]; if(x<ex0)ex0=x; if(x>ex1)ex1=x; if(y<ey0)ey0=y; if(y>ey1)ey1=y;}
      if(!isFinite(ex0)||!isFinite(ey0)||!isFinite(ex1)||!isFinite(ey1))return;
      lay.ents.push(d2.ents.length);
      d2.ents.push({layer:li,pts:a,closed:!!p.closed,pairs:!!p.pairs,text:!!p.text,color:d2Color(p.color||Ly.color),minx:ex0,miny:ey0,maxx:ex1,maxy:ey1});
      if(ex0<minx)minx=ex0; if(ey0<miny)miny=ey0; if(ex1>maxx)maxx=ex1; if(ey1>maxy)maxy=ey1;
    });
  });
  d2.ox=(minx+maxx)/2; d2.oy=(miny+maxy)/2; d2.hidden=new Uint8Array(d2.ents.length);
  busy(true,'Drawing '+d2.ents.length.toLocaleString()+' items…',0.8); await tick();
  d2.layers.forEach(function(lay,li){
    var obj=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({vertexColors:true}));
    obj.position.set(d2.ox,d2.oy,0); obj.userData.is2d=true; obj.raycast=function(){};
    lay.obj=obj; lay.node.meshes.push(obj); modelRoot.add(obj); state.meshes.push(obj); d2Rebuild(li);
  });
  d2BuildIndex();
  var fb=d2FitBox(); d2.fitBox=fb.box;
  if(fb.trimmed)model.warnings.push('A few items sit far away from the rest of the drawing, so Fit shows the main drawing. Zoom out to see them.');
  var offL=d2.layers.filter(function(l){return !l.node.visible;}).length;
  if(offL)model.warnings.push(offL+' layer'+(offL>1?'s are':' is')+' switched off in this drawing. Tick '+(offL>1?'them':'it')+' in the tree, or use Show all, to see '+(offL>1?'them':'it')+'.');
  var unitNote=model.unitless?'':'Drawing units: '+({0.001:'mm',0.01:'cm',1:'m',0.0254:'in',0.3048:'ft',0.1:'dm',0.9144:'yd',0.000001:'µm'}[model.scale]||'file units');
  finishBuild(rootNode,d2.ents.length.toLocaleString()+' items on '+d2.layers.length+' layer'+(d2.layers.length===1?'':'s')+(unitNote?'<br>'+unitNote:''));
}

// ---------- visibility & tree ----------
function applyVisibility(){
  (function rec(n,on){
    var v=on&&n.visible;
    for(var i=0;i<n.meshes.length;i++){var m=n.meshes[i]; m.visible=v; styleMesh(m);}
    if(n.row)n.row.classList.toggle('off',!v);
    if(n.cb)n.cb.checked=n.visible;
    for(i=0;i<n.children.length;i++)rec(n.children[i],v);
  })(state.root,true);
  if(state.is2d&&state.sel2d.size)d2SetSel(Array.from(state.sel2d));
  if(state.massOn)updateMass();
  needsRender=true;
}
var caretSvg='<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1.5 7 5 3 8.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function renderTree(root){
  var tree=$('tree'); tree.innerHTML='';
  (function make(n,parentEl){
    var wrap=document.createElement('div');
    var row=document.createElement('div'); row.className='row'; row.setAttribute('role','treeitem');
    row.style.paddingLeft=(4+n.depth*14)+'px';
    var car=document.createElement('button'); car.className='caret'+(n.children.length?'':' leaf'); car.innerHTML=caretSvg;
    car.setAttribute('aria-label','Expand '+n.name); car.setAttribute('aria-expanded',n.depth<1?'true':'false');
    var cb=document.createElement('input'); cb.type='checkbox'; cb.checked=n.visible; cb.setAttribute('aria-label','Show '+n.name);
    var nm=document.createElement('button'); nm.className='nm'; nm.textContent=n.name; nm.title=n.name;
    row.appendChild(car); row.appendChild(cb); row.appendChild(nm); wrap.appendChild(row);
    var kids=document.createElement('div'); kids.className='kids'+(n.depth<1?' open':''); kids.setAttribute('role','group'); wrap.appendChild(kids);
    n.row=row; n.cb=cb; n.kidsEl=kids; n.caret=car; n.wrap=wrap;
    car.onclick=function(){var o=!kids.classList.contains('open'); kids.classList.toggle('open',o); car.setAttribute('aria-expanded',o?'true':'false');};
    cb.onchange=function(){n.visible=cb.checked; applyVisibility();};
    nm.onclick=function(e){
      var add=e.shiftKey||e.ctrlKey||e.metaKey;
      if(state.is2d){var ids=n.layer!=null?d2LayerIds(n.layer):d2AllVisible(); d2SetSel(add?Array.from(state.sel2d).concat(ids):ids); return;}
      if(add)toggleSelect(n); else select(n);
    };
    for(var i=0;i<n.children.length;i++)make(n.children[i],kids);
    parentEl.appendChild(wrap);
  })(root,tree);
}
function expandTo(n){var p=n.parent; while(p){if(p.kidsEl){p.kidsEl.classList.add('open'); p.caret.setAttribute('aria-expanded','true');} p=p.parent;}}
function forEachNode(n,f){f(n); for(var i=0;i<n.children.length;i++)forEachNode(n.children[i],f);}
function meshesUnder(n){var out=[]; forEachNode(n,function(x){out.push.apply(out,x.meshes);}); return out;}
$('search').addEventListener('input',function(){
  var q=this.value.trim().toLowerCase(); if(!state.root)return;
  (function rec(n){
    var hit=!q||n.name.toLowerCase().indexOf(q)>=0, anyKid=false;
    for(var i=0;i<n.children.length;i++)if(rec(n.children[i]))anyKid=true;
    n.wrap.style.display=(hit||anyKid)?'':'none';
    if(q&&anyKid){n.kidsEl.classList.add('open'); n.caret.setAttribute('aria-expanded','true');}
    return hit||anyKid;
  })(state.root);
});
$('btnShowAll').onclick=function(){forEachNode(state.root,function(n){n.visible=true;}); if(state.is2d&&d2.hidden){d2.hidden.fill(0); d2.layers.forEach(function(l,i){d2Rebuild(i);});} applyVisibility();};
$('btnHideSel').onclick=function(){
  if(state.is2d){if(state.sel2d.size){d2HideIds(Array.from(state.sel2d)); d2SetSel([]);} return;}
  if(!state.sel.length)return;
  state.sel.forEach(function(n){n.visible=false;});
  var none=[]; setSelection(none); applyVisibility();
};
$('btnIsolate').onclick=function(){
  if(state.is2d){
    var keep=new Set(state.sel2d); if(!keep.size)return;
    for(var i=0;i<d2.ents.length;i++)d2.hidden[i]=keep.has(i)?0:1;
    keep.forEach(function(id){d2.layers[d2.ents[id].layer].node.visible=true;});
    d2.layers.forEach(function(l,li){d2Rebuild(li);}); applyVisibility(); d2ZoomTo(Array.from(keep)); return;
  }
  var s=state.sel.slice(); if(!s.length)return;
  forEachNode(state.root,function(n){n.visible=false;});
  s.forEach(function(x){var p=x; while(p){p.visible=true; p=p.parent;} forEachNode(x,function(n){n.visible=true;});});
  applyVisibility(); fit(selMeshes());
};

// ---------- part selection (one or many) ----------
function selMeshes(){
  var set=new Set();
  state.sel.forEach(function(n){meshesUnder(n).forEach(function(m){set.add(m);});});
  return Array.from(set);
}
function setSelection(nodes,opts){
  selMeshes().forEach(function(m){m.userData.sel=false; styleMesh(m);});
  state.sel.forEach(function(n){if(n.row)n.row.classList.remove('sel');});
  state.sel=nodes.filter(function(n,i){return n&&nodes.indexOf(n)===i;});
  selMeshes().forEach(function(m){m.userData.sel=true; styleMesh(m);});
  state.sel.forEach(function(n){if(n.row)n.row.classList.add('sel');});
  if(state.sel.length===1&&state.sel[0].row&&!(opts&&opts.noScroll)){expandTo(state.sel[0]); state.sel[0].row.scrollIntoView({block:'nearest'});}
  $('btnHideSel').disabled=!state.sel.length; $('btnIsolate').disabled=!state.sel.length;
  showSelInfo(); updateMass(); needsRender=true;
}
function select(n){setSelection(n?[n]:[]);}
function toggleSelect(n){
  var i=state.sel.indexOf(n);
  setSelection(i>=0?state.sel.filter(function(x){return x!==n;}):state.sel.concat([n]),{noScroll:i>=0});
}
function pathOf(n){var a=[],p=n; while(p&&p.parent){a.unshift(p.name); p=p.parent;} return a;}
function showSelInfo(){
  var sp=$('spanel'), s=state.sel;
  if(state.measuring||!s.length){sp.classList.remove('on');return;}
  sp.innerHTML='';
  var h=document.createElement('h2'); h.textContent=s.length===1?s[0].name:s.length+' components selected'; sp.appendChild(h);
  var pp=document.createElement('p'); pp.className='hint';
  if(s.length===1){var path=pathOf(s[0]); pp.textContent=path.length>1?path.slice(0,-1).join(' › '):'';}
  else pp.textContent=s.slice(0,3).map(function(n){return n.name;}).join(', ')+(s.length>3?' and '+(s.length-3)+' more':'');
  if(pp.textContent)sp.appendChild(pp);
  var acts=document.createElement('div'); acts.className='acts';
  [['Hide',function(){$('btnHideSel').click();}],['Isolate',function(){$('btnIsolate').click();}],['Zoom to',function(){fit(selMeshes());}]].forEach(function(a){
    var b=document.createElement('button'); b.className='btn'; b.textContent=a[0]; b.onclick=a[1]; acts.appendChild(b);});
  sp.appendChild(acts); sp.classList.add('on');
}
// Drag a box with the left button. Left to right: parts fully inside. Right to left: anything the box touches.
function boxSelect(x0,y0,x1,y1,crossing){
  var rect=rectOf(), L=Math.min(x0,x1), R=Math.max(x0,x1), T=Math.min(y0,y1), B=Math.max(y0,y1);
  var v=new THREE.Vector3(), per=new Map();
  state.meshes.forEach(function(m){
    if(!m.visible)return;
    var node=m.userData.node, st=per.get(node); if(!st){st={all:true,any:false}; per.set(node,st);}
    var bb=m.geometry.boundingBox, minx=1e9, maxx=-1e9, miny=1e9, maxy=-1e9, behind=false;
    for(var i=0;i<8;i++){
      v.set(i&1?bb.max.x:bb.min.x, i&2?bb.max.y:bb.min.y, i&4?bb.max.z:bb.min.z).applyMatrix4(m.matrixWorld);
      var sc=toScreen(v,rect); if(sc.z>1)behind=true;
      if(sc.x<minx)minx=sc.x; if(sc.x>maxx)maxx=sc.x; if(sc.y<miny)miny=sc.y; if(sc.y>maxy)maxy=sc.y;
    }
    if(maxx<L||minx>R||maxy<T||miny>B){st.all=false; return;}
    if(!behind&&minx>=L&&maxx<=R&&miny>=T&&maxy<=B){st.any=true; return;}
    var pa=m.geometry.getAttribute('position'), n=pa.count, step=Math.max(1,Math.floor(n/400)), ins=0, tot=0;
    for(var k=0;k<n;k+=step){
      v.fromBufferAttribute(pa,k).applyMatrix4(m.matrixWorld);
      var s2=toScreen(v,rect); tot++;
      if(s2.z<=1&&s2.x>=L&&s2.x<=R&&s2.y>=T&&s2.y<=B)ins++;
    }
    if(ins>0)st.any=true;
    if(ins<tot)st.all=false;
  });
  if(crossing){
    var mx=(L+R)/2, my=(T+B)/2;
    [[mx,my],[L,T],[R,T],[L,B],[R,B],[mx,T],[mx,B],[L,my],[R,my]].forEach(function(p){
      var h=rayHit(p[0],p[1]); if(h){var st=per.get(h.object.userData.node); if(st)st.any=true;}
    });
  }
  var out=[];
  per.forEach(function(st,node){if(crossing?st.any:(st.all&&st.any))out.push(node);});
  return out;
}

// ---------- mass properties ----------
var DENSITIES=[['steel','Steel',7850],['stainless','Stainless steel',8000],['aluminium','Aluminium',2700],['brass','Brass',8500],
  ['abs','ABS plastic',1050],['nylon','Nylon',1150],['acetal','Acetal (POM)',1410],['hdpe','HDPE',950],['pc','Polycarbonate',1200]];
var densityKey=''; try{densityKey=localStorage.getItem('edv.density')||'';}catch(e){}
function esc(t){return String(t).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function num(v,dp){return v.toLocaleString(undefined,{minimumFractionDigits:dp,maximumFractionDigits:dp});}
function fmtMass(kg){
  if(state.units==='in')return num(kg*2.2046226,2)+' lb';
  return kg>=1?num(kg,2)+' kg':num(kg*1000,1)+' g';
}
function fmtVol(m3){
  if(state.units==='in')return num(m3*61023.7441,2)+' in³';
  if(state.units==='m')return num(m3,6)+' m³';
  var cm3=m3*1e6; return cm3>=1e4?num(m3,4)+' m³':num(cm3,2)+' cm³';
}
function fmtArea(m2){
  if(state.units==='in')return num(m2*1550.0031,2)+' in²';
  if(state.units==='m')return num(m2,4)+' m²';
  var cm2=m2*1e4; return cm2>=1e4?num(m2,3)+' m²':num(cm2,2)+' cm²';
}
function fmtInertia(v){return state.units==='in'?num(v*3417.1717,1)+' lb·in²':num(v,2)+' kg·m²';}
// Volume and surface area of one body, from its triangles (signed-volume sum; assumes a closed solid).
function geoProps(g){
  if(g.props)return g.props;
  var p=g.geo.getAttribute('position').array, ix=g.geo.getIndex().array, vol=0, area=0;
  for(var t=0;t<ix.length;t+=3){
    var a=ix[t]*3,b=ix[t+1]*3,c=ix[t+2]*3;
    var ax=p[a],ay=p[a+1],az=p[a+2],bx=p[b],by=p[b+1],bz=p[b+2],cx=p[c],cy=p[c+1],cz=p[c+2];
    vol+=(ax*(by*cz-bz*cy)-ay*(bx*cz-bz*cx)+az*(bx*cy-by*cx))/6;
    var ux=bx-ax,uy=by-ay,uz=bz-az,wx=cx-ax,wy=cy-ay,wz=cz-az;
    area+=0.5*Math.hypot(uy*wz-uz*wy,uz*wx-ux*wz,ux*wy-uy*wx);
  }
  g.props={v:Math.abs(vol),a:area};
  return g.props;
}
function geometryTotals(meshes){
  var vol=0, area=0, verts=0, box=new THREE.Box3(), v=new THREE.Vector3();
  meshes.forEach(function(m){verts+=m.geometry.getAttribute('position').count;});
  var exact=verts<=1500000;
  meshes.forEach(function(m){
    var pr=geoProps(m.userData.g), det=Math.abs(m.matrixWorld.determinant());
    vol+=pr.v*det; area+=pr.a*Math.pow(det,2/3);
    if(exact){var pa=m.geometry.getAttribute('position'); for(var i=0;i<pa.count;i++){v.fromBufferAttribute(pa,i).applyMatrix4(m.matrixWorld); box.expandByPoint(v);}}
    else box.expandByObject(m);
  });
  return {vol:vol,area:area,size:box.isEmpty()?null:box.getSize(new THREE.Vector3()),exact:exact,count:meshes.length};
}
function row(k,v){return '<dt>'+k+'</dt><dd>'+v+'</dd>';}
function updateMass(){
  var pp=$('ppanel');
  if(!state.massOn||!state.root||!state.model){pp.classList.remove('on'); state.comAt=null; comEl.style.display='none'; return;}
  if(state.is2d){
    var sel=state.sel2d.size, ids=sel?Array.from(state.sel2d):d2AllVisible(), tl=0, nt=0;
    ids.forEach(function(id){var e=d2.ents[id]; if(e.text)nt++; else tl+=d2EntLength(e);});
    var bb=d2Bounds(ids), sc=state.unitScale;
    var h2='<h2>'+esc(sel?(sel===1?'1 item selected':sel.toLocaleString()+' items selected'):state.root.name)+'</h2><dl>';
    if(ids.length)h2+=row('Width',fmt((bb.maxx-bb.minx)*sc))+row('Height',fmt((bb.maxy-bb.miny)*sc));
    h2+=row('Total line length',fmt(tl))+row('Lines, arcs and curves',(ids.length-nt).toLocaleString())+row('Text items',nt.toLocaleString())+'</dl>';
    h2+='<p class="hint">Total line length adds up every visible line, arc and curve'+(sel?' in the selection':'')+'. For a flat pattern that is the cut length. Text isn’t included.</p>';
    pp.innerHTML=h2; pp.classList.add('on'); state.comAt=null; comEl.style.display='none'; return;
  }
  var s=state.sel, whole=!s.length||(s.length===1&&s[0]===state.root), mp=state.model.massProps, html='';
  state.comAt=null;
  if(whole){
    html+='<h2>'+esc(state.root.name)+'</h2>';
    if(mp){
      html+='<p class="sub">Saved in the file by SolidWorks</p><dl>'+row('Mass',fmtMass(mp.mass))+row('Volume',fmtVol(mp.volume))+row('Surface area',fmtArea(mp.area))+'</dl>';
      if(isFinite(mp.grav_center_x)){
        html+='<h3>Centre of mass</h3><dl>'+row('X',fmt(mp.grav_center_x))+row('Y',fmt(mp.grav_center_y))+row('Z',fmt(mp.grav_center_z))+'</dl>';
        state.comAt=new THREE.Vector3(mp.grav_center_x,mp.grav_center_y,mp.grav_center_z);
      }
      if(isFinite(mp.px))html+='<h3>Principal moments of inertia</h3><dl>'+row('Px',fmtInertia(mp.px))+row('Py',fmtInertia(mp.py))+row('Pz',fmtInertia(mp.pz))+'</dl>';
      html+='<p class="hint">The file only stores mass properties for the whole model. Select components to see their volume and an estimated mass.</p>';
    }else html+='<p class="hint">This file has no saved mass properties, so these figures are worked out from the visible geometry.</p>';
  }
  if(!whole||!mp){
    var meshes=whole?state.meshes.filter(function(m){return m.visible;}):selMeshes();
    var vis=meshes.filter(function(m){return m.visible;}); if(vis.length)meshes=vis;
    var g=geometryTotals(meshes);
    if(!whole)html+='<h2>'+esc(s.length===1?s[0].name:s.length+' components selected')+'</h2>';
    html+='<p class="sub">Estimated from the geometry</p><dl>'+row('Volume',fmtVol(g.vol))+row('Surface area',fmtArea(g.area));
    if(g.size){var gs=dispVec(g.size); html+=row('Size X',fmt(Math.abs(gs.x)))+row('Size Y',fmt(Math.abs(gs.y)))+row('Size Z',fmt(Math.abs(gs.z)));}
    html+='</dl>';
    var dens=0, opts='<option value="">Choose a material</option>';
    DENSITIES.forEach(function(d){opts+='<option value="'+d[0]+'"'+(densityKey===d[0]?' selected':'')+'>'+d[1]+' ('+d[2].toLocaleString()+' kg/m³)</option>'; if(densityKey===d[0])dens=d[2];});
    if(mp&&mp.volume>0){var avg=mp.mass/mp.volume; opts+='<option value="avg"'+(densityKey==='avg'?' selected':'')+'>Model average ('+Math.round(avg).toLocaleString()+' kg/m³)</option>'; if(densityKey==='avg')dens=avg;}
    html+='<h3>Estimated mass</h3><select class="btn" id="selDensity" aria-label="Material for the mass estimate">'+opts+'</select>';
    html+='<div class="big" style="margin-top:6px">'+(dens?fmtMass(g.vol*dens):'—')+'</div>';
    html+='<p class="hint">Volume × material density. '+(g.exact?'':'Size is approximate for a selection this large. ')+'Bodies that aren’t closed solids, such as surfaces, give unreliable volumes.</p>';
  }
  pp.innerHTML=html; pp.classList.add('on');
  var sd=$('selDensity'); if(sd)sd.onchange=function(){densityKey=this.value; try{localStorage.setItem('edv.density',densityKey);}catch(e){} updateMass();};
  comEl.style.display=state.comAt?'':'none'; needsRender=true;
}
$('btnMass').onclick=function(){state.massOn=!state.massOn; this.setAttribute('aria-pressed',state.massOn); updateMass();};

// ---------- camera ----------
function boxOf(list){
  var box=new THREE.Box3();
  for(var i=0;i<list.length;i++)if(list[i].visible)box.expandByObject(list[i]);
  if(box.isEmpty())for(i=0;i<list.length;i++)box.expandByObject(list[i]);
  return box;
}
function fit(list,dir){
  list=list||state.meshes; if(!list.length)return;
  var box=boxOf(list), c=box.getCenter(new THREE.Vector3()), r=box.getSize(new THREE.Vector3()).length()/2||1;
  if(list===state.meshes)state.radius=r;
  dir=dir||camera.position.clone().sub(controls.target).normalize();
  if(!isFinite(dir.x)||dir.lengthSq()<1e-9)dir=new THREE.Vector3(1,0.75,1.15).normalize();
  if(camera.isOrthographicCamera){
    var asp=view.clientWidth/Math.max(1,view.clientHeight);
    ortho.userData.halfH=r*0.9*Math.max(1,1/asp); ortho.zoom=1; setOrthoFrustum();
    controls.target.copy(c); ortho.position.copy(c).addScaledVector(dir,r*4);
    updateClip(); controls.update(); needsRender=true; return;
  }
  var vf=THREE.MathUtils.degToRad(camera.fov), hf=2*Math.atan(Math.tan(vf/2)*camera.aspect);
  var dist=r/Math.sin(Math.min(vf,hf)/2)*0.82;
  controls.target.copy(c); camera.position.copy(c).addScaledVector(dir,dist);
  updateClip(); controls.update(); needsRender=true;
}
var dirs={iso:[1,0.75,1.15],front:[0,0,1],back:[0,0,-1],top:[0,1,0.0001],bottom:[0,-1,0.0001],right:[1,0,0],left:[-1,0,0]};
function setView(v){var d=dirs[v]||dirs.iso; camera.up.set(0,1,0); fit(null,new THREE.Vector3(d[0],d[1],d[2]).normalize()); $('selView').value=v;}
$('btnFit').onclick=function(){if(state.is2d)d2Fit(); else fit();};
// Turn the view to look straight along dir (pointing from the model towards the eye), keeping the
// pivot point where it already is on screen.
function lookAlong(dir,pivot){
  var cur=camera.position.clone().sub(controls.target), dist=cur.length()||1; cur.normalize();
  dir=dir.clone().normalize();
  if(Math.abs(dir.y)>0.9999){   // straight up or down: keep the nearest quarter-turn so the model doesn't spin
    var az=Math.round(Math.atan2(cur.x,cur.z)/(Math.PI/2))*(Math.PI/2);
    dir.set(Math.sin(az)*1e-4,dir.y>0?1:-1,Math.cos(az)*1e-4).normalize();
  }
  camera.updateMatrixWorld();
  var e=camera.matrixWorld.elements, r=new THREE.Vector3(e[0],e[1],e[2]), u=new THREE.Vector3(e[4],e[5],e[6]);
  var o=(pivot||controls.target).clone().sub(controls.target), a=o.dot(r), b=o.dot(u), w=o.dot(cur);
  var r2=new THREE.Vector3().crossVectors(Y_AXIS,dir).normalize(), u2=new THREE.Vector3().crossVectors(dir,r2);
  var t2=(pivot||controls.target).clone().addScaledVector(r2,-a).addScaledVector(u2,-b).addScaledVector(dir,-w);
  controls.target.copy(t2); camera.position.copy(t2).addScaledVector(dir,dist); camera.up.set(0,1,0);
  updateClip(); controls.update(); needsRender=true;
}
function shellOfHit(h){
  var ss=h.object.userData.g.shellStart, ti=h.faceIndex*3, lo=0, hi=ss.length-2;
  while(lo<hi){var mid=(lo+hi+1)>>1; if(ss[mid]<=ti)lo=mid; else hi=mid-1;}
  return lo;
}
// F: look square-on at the flat face under the pointer (or the last flat face picked in Measure);
// with no flat face there, snap to the nearest standard view.
function normalTo(){
  if(!state.meshes.length)return;
  if(state.is2d){d2Fit(); return;}
  var cur=camera.position.clone().sub(controls.target).normalize(), n=null, pivot=null;
  if(mouse.inside){
    var h=rayHit(mouse.x,mouse.y);
    if(h&&h.faceIndex!=null){var fe=faceEntity(h.object,shellOfHit(h)); if(fe.planar){n=fe.n.clone(); pivot=h.point.clone();}}
  }
  if(!n)for(var i=state.ents.length-1;i>=0;i--){var en=state.ents[i]; if(en.type==='face'&&en.planar){n=en.n.clone(); pivot=en.c.clone(); break;}}
  if(n){if(n.dot(cur)<0)n.negate(); lookAlong(n,pivot); return;}
  var names={front:[0,0,1],back:[0,0,-1],top:[0,1,0],bottom:[0,-1,0],right:[1,0,0],left:[-1,0,0]}, best=-2, pick='front';
  Object.keys(names).forEach(function(k){var d=cur.x*names[k][0]+cur.y*names[k][1]+cur.z*names[k][2]; if(d>best){best=d; pick=k;}});
  lookAlong(new THREE.Vector3(names[pick][0],names[pick][1],names[pick][2]),null); $('selView').value=pick;
}
var mouse={x:0,y:0,inside:false}, lastMid=null;
function setProjection(mode,noSave){
  var next=mode==='ortho'?ortho:persp;
  $('selProj').value=mode; if(!noSave){try{localStorage.setItem('edv.proj',mode);}catch(e){}}
  if(next===camera)return;
  var t=controls.target, dir=camera.position.clone().sub(t), dist=dir.length()||1; dir.normalize();
  var tanH=Math.tan(THREE.MathUtils.degToRad(persp.fov/2));
  var halfVis=camera.isOrthographicCamera?camera.userData.halfH/camera.zoom:dist*tanH;
  next.up.copy(camera.up);
  if(next===ortho){ortho.userData.halfH=halfVis; ortho.zoom=1; setOrthoFrustum(); ortho.position.copy(t).addScaledVector(dir,Math.max(dist,state.radius*4));}
  else persp.position.copy(t).addScaledVector(dir,halfVis/tanH);
  next.quaternion.copy(camera.quaternion);
  camera=next; controls.object=camera; updateClip(); controls.update(); needsRender=true;
}
$('selProj').onchange=function(){setProjection(this.value);};
(function(){var m='ortho'; try{m=localStorage.getItem('edv.proj')||'ortho';}catch(e){} setProjection(m);})();
$('selView').onchange=function(){setView(this.value);};
$('selDisplay').onchange=function(){setDisplay(this.value);};
$('selDisplay').value=displayMode; edgeMat.opacity=(displayMode==='wire'||displayMode==='hlr')?0.9:0.55;
$('btnHelp').onclick=function(){var h=$('help'), o=h.hidden; h.hidden=!o; this.setAttribute('aria-expanded',o);};

// ---------- picking ----------
var ray=new THREE.Raycaster();
function rectOf(){return renderer.domElement.getBoundingClientRect();}
function toNdc(cx,cy,rect){return new THREE.Vector2((cx-rect.left)/rect.width*2-1,-((cy-rect.top)/rect.height)*2+1);}
function toScreen(v,rect){var s=v.clone().project(camera); return {x:(s.x+1)/2*rect.width+rect.left,y:(1-s.y)/2*rect.height+rect.top,z:s.z};}
function rayHit(cx,cy){
  var rect=rectOf(); ray.setFromCamera(toNdc(cx,cy,rect),camera);
  var vis=state.meshes.filter(function(m){return m.visible;});
  var h=ray.intersectObjects(vis,false); return h.length?h[0]:null;
}
// Body topology for measuring: which boundary segments belong to which CAD face, and where faces meet.
function topo(g){
  if(g.topo)return g.topo;
  var pos=g.geo.getAttribute('position').array, E=g.edgeIdx, S=g.edgeShell, ns=E.length/2;
  var cmap=new Map(), cv=new Int32Array(pos.length/3).fill(-1), rep=[];
  function canon(i){
    if(cv[i]>=0)return cv[i];
    var k=Math.round(pos[3*i]*1e6)+','+Math.round(pos[3*i+1]*1e6)+','+Math.round(pos[3*i+2]*1e6);
    var c=cmap.get(k); if(c===undefined){c=rep.length; cmap.set(k,c); rep.push(i);} cv[i]=c; return c;
  }
  var A=new Int32Array(ns),B=new Int32Array(ns),other=new Int32Array(ns).fill(-1),pairs=new Map(),inc=new Map();
  for(var k=0;k<ns;k++){
    var a=canon(E[2*k]),b=canon(E[2*k+1]); A[k]=a; B[k]=b;
    var pk=a<b?a+'_'+b:b+'_'+a, l=pairs.get(pk); if(!l)pairs.set(pk,l=[]); l.push(k);
    var la=inc.get(a); if(!la)inc.set(a,la=[]); la.push(k);
    var lb=inc.get(b); if(!lb)inc.set(b,lb=[]); lb.push(k);
  }
  pairs.forEach(function(l){for(var i=0;i<l.length;i++)for(var j=0;j<l.length;j++)if(S[l[i]]!==S[l[j]])other[l[i]]=S[l[j]];});
  var corner=new Uint8Array(rep.length);
  inc.forEach(function(l,v){var sh={},cnt=0; for(var i=0;i<l.length;i++){if(!sh[S[l[i]]]){sh[S[l[i]]]=1;cnt++;}} if(cnt>=3)corner[v]=1;});
  g.topo={A:A,B:B,other:other,inc:inc,rep:rep,corner:corner,pos:pos};
  return g.topo;
}
function cpos(T,c,M){var i=T.rep[c]; return new THREE.Vector3(T.pos[3*i],T.pos[3*i+1],T.pos[3*i+2]).applyMatrix4(M);}
// Walk a face boundary from one segment to the full CAD edge (until the neighbouring face changes).
function chainFrom(g,k,M){
  var T=topo(g),S=g.edgeShell,s=S[k],o=T.other[k];
  function lpos(c){var i=T.rep[c]; return new THREE.Vector3(T.pos[3*i],T.pos[3*i+1],T.pos[3*i+2]);}
  function nextSeg(cur,v){var l=T.inc.get(v)||[]; for(var i=0;i<l.length;i++){var j=l[i]; if(j!==cur&&S[j]===s)return j;} return -1;}
  function turn(p,v,n){var a=lpos(v).sub(lpos(p)).normalize(),b=lpos(n).sub(lpos(v)).normalize(); return Math.acos(Math.max(-1,Math.min(1,a.dot(b))));}
  function walk(start,from,to){
    var out=[],cur=start,prev=from,v=to,guard=0;
    for(;;){
      var nx=nextSeg(cur,v); if(nx<0)return {pts:out,closed:false};
      if(nx===k)return {pts:out,closed:true};
      if(T.other[nx]!==o)return {pts:out,closed:false};
      if(T.corner[v])return {pts:out,closed:false};
      var w=T.A[nx]===v?T.B[nx]:T.A[nx];
      if(o<0&&turn(prev,v,w)>0.87)return {pts:out,closed:false};
      out.push(w); prev=v; v=w; cur=nx;
      if(++guard>200000)return {pts:out,closed:false};
    }
  }
  var f=walk(k,T.A[k],T.B[k]);
  var ids=[T.A[k],T.B[k]].concat(f.pts);
  if(!f.closed){var b=walk(k,T.B[k],T.A[k]); ids=b.pts.reverse().concat(ids);}
  return {pts:ids.map(function(c){return cpos(T,c,M);}),closed:f.closed};
}
function classify(ch){
  var P=ch.pts, n=P.length, L=0, i;
  for(i=1;i<n;i++)L+=P[i].distanceTo(P[i-1]);
  if(ch.closed)L+=P[n-1].distanceTo(P[0]);
  if(!ch.closed){
    var a=P[0],b=P[n-1],d=b.clone().sub(a),dl=d.length(),dev=0;
    if(dl>0){d.divideScalar(dl); for(i=1;i<n-1;i++){var q=P[i].clone().sub(a); dev=Math.max(dev,q.sub(d.clone().multiplyScalar(q.dot(d))).length());}}
    if(n===2||dev<Math.max(1e-7,0.003*dl))return {type:'line',a:a,b:b,length:dl,pts:[a,b]};
  }
  if(n>=3){
    var p1=P[0],p2=P[Math.floor(n/3)],p3=P[Math.floor(2*n/3)];
    if(!ch.closed){p2=P[Math.floor(n/2)]; p3=P[n-1];}
    var c=circumcenter(p1,p2,p3);
    if(c){
      var r=c.distanceTo(p1),ok=true;
      for(i=0;i<n;i++)if(Math.abs(P[i].distanceTo(c)-r)>Math.max(1e-6,0.015*r)){ok=false;break;}
      if(ok)return {type:'arc',c:c,r:r,length:L,closed:ch.closed,pts:P};
    }
  }
  return {type:'curve',length:L,pts:P,closed:ch.closed};
}
function circumcenter(a,b,c){
  var ab=b.clone().sub(a),ac=c.clone().sub(a),n=ab.clone().cross(ac),n2=n.lengthSq();
  if(n2<1e-24)return null;
  var t=ac.clone().multiplyScalar(ab.lengthSq()).cross(n).add(n.clone().cross(ab).multiplyScalar(ac.lengthSq()));
  return a.clone().add(t.divideScalar(2*n2));
}
// Measure pick: corner (snap) > edge > face. Used for both the hover highlight and the click.
function measurePick(cx,cy,quick){
  var rect=rectOf(), h0=rayHit(cx,cy), hit=h0;
  var offs=quick?[[6,0],[-6,0],[0,6],[0,-6]]:[[7,0],[-7,0],[0,7],[0,-7],[5,5],[-5,-5],[5,-5],[-5,5]];
  for(var i=0;i<offs.length&&!hit;i++)hit=rayHit(cx+offs[i][0],cy+offs[i][1]);
  if(!hit)return null;
  var mesh=hit.object,g=mesh.userData.g,M=mesh.matrixWorld,T=topo(g);
  camera.updateMatrixWorld();
  var mv=new THREE.Matrix4().multiplyMatrices(camera.matrixWorldInverse,M), mvp=new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,mv);
  var a=mvp.elements,b=mv.elements,W=rect.width,H=rect.height,X0=rect.left,Y0=rect.top,ortho2=camera.isOrthographicCamera;
  var hitDepth=-hit.point.clone().applyMatrix4(camera.matrixWorldInverse).z;
  var wpp=ortho2?(camera.top-camera.bottom)/camera.zoom/H:2*hitDepth*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))/H;
  var maxDepth=hitDepth+Math.abs(wpp)*30, P=T.pos, sx=0, sy=0, sd=0;
  function proj(x,y,z){
    var w=a[3]*x+a[7]*y+a[11]*z+a[15]; if(!ortho2&&w<=0)return false;
    sx=((a[0]*x+a[4]*y+a[8]*z+a[12])/w+1)/2*W+X0; sy=(1-(a[1]*x+a[5]*y+a[9]*z+a[13])/w)/2*H+Y0;
    sd=-(b[2]*x+b[6]*y+b[10]*z+b[14]); return true;
  }
  var best=11,bestC=-1;
  for(var c=0;c<T.corner.length;c++){
    if(!T.corner[c])continue;
    var i3=T.rep[c]*3; if(!proj(P[i3],P[i3+1],P[i3+2]))continue;
    var d=Math.hypot(sx-cx,sy-cy); if(d<best&&sd<=maxDepth){best=d;bestC=c;}
  }
  if(bestC>=0)return {type:'point',p:cpos(T,bestC,M),snapped:true,mesh:mesh,key:'c'+mesh.id+'_'+bestC};
  var E=g.edgeIdx,bestE=-1; best=9;
  for(var k=0;k<E.length;k+=2){
    var i1=E[k]*3,i2=E[k+1]*3;
    if(!proj(P[i1],P[i1+1],P[i1+2]))continue;
    var ax=sx,ay=sy,ad=sd;
    if(!proj(P[i2],P[i2+1],P[i2+2]))continue;
    var vx=sx-ax,vy=sy-ay,l2=vx*vx+vy*vy,t=l2?Math.max(0,Math.min(1,((cx-ax)*vx+(cy-ay)*vy)/l2)):0;
    var dd=Math.hypot(ax+vx*t-cx,ay+vy*t-cy);
    if(dd<best&&ad+(sd-ad)*t<=maxDepth){best=dd;bestE=k/2;}
  }
  if(bestE>=0){
    var e=classify(chainFrom(g,bestE,M)), sum=0;
    e.pts.forEach(function(p){sum+=p.x+p.y*1.7+p.z*2.3;});
    e.mesh=mesh; e.key='e'+mesh.id+'_'+e.pts.length+'_'+Math.round(sum*1e4); return e;
  }
  if(!h0||h0.faceIndex==null)return null;
  var fg=h0.object.userData.g, ti=h0.faceIndex*3, ss=fg.shellStart, lo=0, hi=ss.length-2;
  while(lo<hi){var mid=(lo+hi+1)>>1; if(ss[mid]<=ti)lo=mid; else hi=mid-1;}
  return {type:'face',mesh:h0.object,shell:lo,key:'f'+h0.object.id+'_'+lo};
}
// Everything needed to measure one CAD face: its triangles, area, perimeter and (if flat) its plane.
function faceEntity(mesh,si){
  var g=mesh.userData.g, ix=g.geo.getIndex().array, pos=g.geo.getAttribute('position').array, M=mesh.matrixWorld;
  var s0=g.shellStart[si], n=g.shellStart[si+1]-s0, tri=new Float32Array(n*3), seen=new Map();
  function wv(vi){var w=seen.get(vi); if(!w){w=new THREE.Vector3(pos[vi*3],pos[vi*3+1],pos[vi*3+2]).applyMatrix4(M); seen.set(vi,w);} return w;}
  for(var k=0;k<n;k++){var w=wv(ix[s0+k]); tri[k*3]=w.x; tri[k*3+1]=w.y; tri[k*3+2]=w.z;}
  var area=0, va=new THREE.Vector3(), c=new THREE.Vector3(), A=new THREE.Vector3(), B=new THREE.Vector3(), C=new THREE.Vector3(), cr=new THREE.Vector3();
  for(k=0;k<n*3;k+=9){
    A.set(tri[k],tri[k+1],tri[k+2]); B.set(tri[k+3],tri[k+4],tri[k+5]); C.set(tri[k+6],tri[k+7],tri[k+8]);
    cr.crossVectors(B.clone().sub(A),C.clone().sub(A)); var ta=cr.length()/2;
    area+=ta; va.addScaledVector(cr,0.5); c.addScaledVector(A.add(B).add(C),ta/3);
  }
  if(area>0)c.divideScalar(area);
  var all=Array.from(seen.values()), nrm=null, planar=false;
  if(area>0&&va.length()/area>0.999){
    nrm=va.clone().normalize(); planar=true;
    var tol=Math.max(1e-6,2e-4*Math.sqrt(area));
    for(k=0;k<all.length;k++)if(Math.abs(all[k].clone().sub(c).dot(nrm))>tol){planar=false;break;}
  }
  var perim=0, E=g.edgeIdx, S=g.edgeShell;
  for(k=0;k<S.length;k++)if(S[k]===si)perim+=wv(E[2*k]).distanceTo(wv(E[2*k+1]));
  var step=Math.max(1,Math.ceil(all.length/800)), pts=all.filter(function(p,i){return i%step===0;});
  return {type:'face',mesh:mesh,shell:si,key:'f'+mesh.id+'_'+si,tri:tri,area:area,perim:perim,planar:planar,n:planar?nrm:null,c:c,pts:pts};
}
function faceOverlay(e,mat,list){
  var geo=new THREE.BufferGeometry(); geo.setAttribute('position',new THREE.BufferAttribute(e.tri,3));
  var m=new THREE.Mesh(geo,mat); m.renderOrder=998; m.raycast=function(){}; scene.add(m); list.push(m); return m;
}
// Hover preview while measuring: shows what a click would pick.
var hover={key:null,objs:[],el:null,pt:null,timer:null,last:0,x:0,y:0};
function clearHover(){
  hover.objs.forEach(function(o){scene.remove(o); o.geometry.dispose();}); hover.objs=[];
  if(hover.el){hover.el.remove(); hover.el=null;} hover.pt=null;
  if(hover.key!==null){hover.key=null; needsRender=true;}
}
function doHover(){
  hover.timer=null; hover.last=performance.now();
  if(!state.measuring||down||rot){clearHover(); return;}
  var e=state.is2d?measurePick2d(hover.x,hover.y):measurePick(hover.x,hover.y,true), key=e?e.key:null;
  if(key===hover.key)return;
  clearHover(); hover.key=key; needsRender=true;
  if(!e)return;
  if(e.type==='point'){hover.el=document.createElement('div'); hover.el.className='dot snap hov'; hud.appendChild(hover.el); hover.pt=e.p;}
  else if(e.type==='face')faceOverlay(faceEntity(e.mesh,e.shell),faceHoverMat,hover.objs);
  else{
    fatLines(polySegs(e.pts,e.closed),fatHover,hover.objs);
    if(e.type==='arc'){hover.el=document.createElement('div'); hover.el.className='dot ctr hov'; hud.appendChild(hover.el); hover.pt=e.c;}
  }
}
function queueHover(x,y){
  hover.x=x; hover.y=y;
  if(hover.timer===null)hover.timer=setTimeout(doHover,Math.max(0,60-(performance.now()-hover.last)));
}

// ---------- measuring ----------
var UNITS={mm:[1000,2],cm:[100,3],m:[1,4],in:[39.37007874,3]};
function fmt(v){var u=UNITS[state.units]; return (v*u[0]).toFixed(u[1])+' '+state.units;}
function fmtA(rad){return (rad*180/Math.PI).toFixed(2)+'°';}
function setMeasuring(on){
  state.measuring=on; $('btnMeasure').setAttribute('aria-pressed',on);
  view.classList.toggle('measuring',on);
  clearHover();
  if(on){$('spanel').classList.remove('on'); select(null);} else clearMeasure();
  updatePanel();
}
$('btnMeasure').onclick=function(){setMeasuring(!state.measuring);};
function clearMeasure(){
  state.ents=[]; state.mObjs.forEach(function(o){scene.remove(o); o.geometry.dispose();}); state.mObjs=[]; state.dim=null;
  overlay.innerHTML=''; updatePanel(); needsRender=true;
}
function clearAll(){clearMeasure(); select(null); if(state.is2d&&state.sel2d.size)d2SetSel([]);}
function fatLines(points,mat,list){
  var arr=[]; for(var i=0;i<points.length;i+=2)arr.push(points[i].x,points[i].y,points[i].z,points[i+1].x,points[i+1].y,points[i+1].z);
  var g=new THREE.LineSegmentsGeometry(); g.setPositions(arr);
  var l=new THREE.LineSegments2(g,mat); l.renderOrder=999; l.computeLineDistances&&l.computeLineDistances();
  scene.add(l); (list||state.mObjs).push(l); return l;
}
function polySegs(P,closed){var out=[]; for(var i=1;i<P.length;i++)out.push(P[i-1],P[i]); if(closed&&P.length>2)out.push(P[P.length-1],P[0]); return out;}
function anchor(e){return e.type==='point'?e.p:e.type==='arc'?e.c:null;}
function closestOnLine(p,a,b,clamp){var d=b.clone().sub(a),l2=d.lengthSq(),t=l2?p.clone().sub(a).dot(d)/l2:0; if(clamp)t=Math.max(0,Math.min(1,t)); return a.clone().add(d.multiplyScalar(t));}
function segSeg(a0,a1,b0,b1){ // closest points between two segments
  var best={d:Infinity};
  var samples=[[a0,closestOnLine(a0,b0,b1,true)],[a1,closestOnLine(a1,b0,b1,true)],[closestOnLine(b0,a0,a1,true),b0],[closestOnLine(b1,a0,a1,true),b1]];
  var u=a1.clone().sub(a0),v=b1.clone().sub(b0),w=a0.clone().sub(b0),A=u.dot(u),B=u.dot(v),C=v.dot(v),D=u.dot(w),E=v.dot(w),den=A*C-B*B;
  if(den>1e-18){var s=(B*E-C*D)/den,t=(A*E-B*D)/den; if(s>=0&&s<=1&&t>=0&&t<=1)samples.push([a0.clone().addScaledVector(u,s),b0.clone().addScaledVector(v,t)]);}
  samples.forEach(function(p){var d=p[0].distanceTo(p[1]); if(d<best.d)best={d:d,p:p[0],q:p[1]};});
  return best;
}
function nearestSets(P,Q){var best={d:Infinity}; for(var i=0;i<P.length;i++)for(var j=0;j<Q.length;j++){var d=P[i].distanceTo(Q[j]); if(d<best.d)best={d:d,p:P[i],q:Q[j]};} return best;}
function compute(){
  var E=state.ents, r={rows:[],title:'',big:'',dim:null,label:''};
  if(E.length===1){
    var e=E[0];
    if(e.type==='point'){var dp=dispVec(e.p); r.title=state.is2d?'End point':(e.snapped?'Corner':'Point on face'); r.big=''; r.rows=[['X',fmt(dp.x)],['Y',fmt(dp.y)]]; if(!state.is2d)r.rows.push(['Z',fmt(dp.z)]); r.hint='Pick a second item to measure between them.';}
    else if(e.type==='line'){r.title='Edge (straight)'; r.big=fmt(e.length); r.rows=[['Length',fmt(e.length)]]; r.dim=[e.a,e.b]; r.label=fmt(e.length);}
    else if(e.type==='arc'){r.title=e.closed?'Edge (circle)':'Edge (arc)'; r.big='Ø '+fmt(2*e.r); r.rows=[['Diameter',fmt(2*e.r)],['Radius',fmt(e.r)],[e.closed?'Circumference':'Arc length',fmt(e.length)]]; r.label='Ø '+fmt(2*e.r);}
    else if(e.type==='face'){r.title=e.planar?'Face (flat)':'Face (curved)'; r.big=fmtArea(e.area); r.rows=[['Area',fmtArea(e.area)],['Perimeter',fmt(e.perim)]]; r.label=fmtArea(e.area);}
    else {r.title='Edge (curve)'; r.big=fmt(e.length); r.rows=[['Length',fmt(e.length)]]; r.label=fmt(e.length);}
    return r;
  }
  var a=E[0],b=E[1],pa=anchor(a),pb=anchor(b);
  if(pa&&pb){
    var d=pb.clone().sub(pa), dd=dispVec(d);
    r.title=(a.type==='arc'&&b.type==='arc')?'Centre distance':(a.type==='arc'||b.type==='arc')?'Distance to centre':'Distance';
    r.big=fmt(d.length()); r.rows=[['ΔX',fmt(Math.abs(dd.x))],['ΔY',fmt(Math.abs(dd.y))]]; if(!state.is2d)r.rows.push(['ΔZ',fmt(Math.abs(dd.z))]);
    r.dim=[pa,pb]; r.label=fmt(d.length()); return r;
  }
  if((pa&&b.type==='line')||(pb&&a.type==='line')){
    var p=pa||pb,l=pa?b:a,f=closestOnLine(p,l.a,l.b,false),dd=p.distanceTo(f);
    r.title='Normal distance to edge'; r.big=fmt(dd); r.rows=[['Distance',fmt(dd)],['To nearest end',fmt(Math.min(p.distanceTo(l.a),p.distanceTo(l.b)))]];
    r.dim=[p,f]; r.label=fmt(dd); return r;
  }
  if(a.type==='line'&&b.type==='line'){
    var u=a.b.clone().sub(a.a).normalize(),v=b.b.clone().sub(b.a).normalize(),ang=Math.acos(Math.min(1,Math.abs(u.dot(v))));
    if(ang<0.5*Math.PI/180){
      var m=a.a.clone().add(a.b).multiplyScalar(0.5),ft=closestOnLine(m,b.a,b.b,false),pd=m.distanceTo(ft);
      r.title='Parallel edges'; r.big=fmt(pd); r.rows=[['Perpendicular distance',fmt(pd)],['Angle','0.00°']]; r.dim=[m,ft]; r.label=fmt(pd);
    }else{
      var ss=segSeg(a.a,a.b,b.a,b.b);
      r.title='Two edges'; r.big=fmtA(ang); r.rows=[['Angle',fmtA(ang)],['Minimum distance',fmt(ss.d)]]; r.dim=ss.d>1e-9?[ss.p,ss.q]:null; r.label=fmtA(ang);
    }
    return r;
  }
  var fa=a.type==='face'?a:null, fb=b.type==='face'?b:null;
  if(fa&&fb&&fa.planar&&fb.planar){
    var fang=Math.acos(Math.min(1,Math.abs(fa.n.dot(fb.n))));
    if(fang<0.5*Math.PI/180){
      var gap=fb.c.clone().sub(fa.c).dot(fb.n), foot=fa.c.clone().addScaledVector(fb.n,gap);
      r.title='Parallel faces'; r.big=fmt(Math.abs(gap)); r.rows=[['Distance',fmt(Math.abs(gap))],['Angle','0.00°']]; r.dim=[fa.c,foot]; r.label=fmt(Math.abs(gap));
    }else{r.title='Two faces'; r.big=fmtA(fang); r.rows=[['Angle',fmtA(fang)]]; r.label=fmtA(fang); r.labelAt=fa.c.clone().add(fb.c).multiplyScalar(0.5);}
    return r;
  }
  var pf=(fa&&fa.planar)?fa:((fb&&fb.planar)?fb:null), other=pf===a?b:a;
  if(pf){
    var op=anchor(other);
    if(op){
      var sd=op.clone().sub(pf.c).dot(pf.n);
      r.title=other.type==='arc'?'Centre to face':'Point to face'; r.big=fmt(Math.abs(sd)); r.rows=[['Normal distance',fmt(Math.abs(sd))]];
      r.dim=[op,op.clone().addScaledVector(pf.n,-sd)]; r.label=fmt(Math.abs(sd)); return r;
    }
    if(other.type==='line'){
      var lu=other.b.clone().sub(other.a).normalize(), la=Math.asin(Math.min(1,Math.abs(lu.dot(pf.n))));
      if(la<0.5*Math.PI/180){
        var lm=other.a.clone().add(other.b).multiplyScalar(0.5), ld=lm.clone().sub(pf.c).dot(pf.n);
        r.title='Edge parallel to face'; r.big=fmt(Math.abs(ld)); r.rows=[['Distance',fmt(Math.abs(ld))],['Angle','0.00°']]; r.dim=[lm,lm.clone().addScaledVector(pf.n,-ld)]; r.label=fmt(Math.abs(ld));
      }else{r.title='Edge and face'; r.big=fmtA(la); r.rows=[['Angle',fmtA(la)]]; r.label=fmtA(la); r.labelAt=other.a.clone().add(other.b).multiplyScalar(0.5);}
      return r;
    }
  }
  function samplePts(x){
    if(x.type!=='line')return x.pts;
    var out=[]; for(var i=0;i<=24;i++)out.push(x.a.clone().lerp(x.b,i/24)); return out;
  }
  var A=pa?[pa]:samplePts(a),B=pb?[pb]:samplePts(b),nn=nearestSets(A,B);
  r.title='Minimum distance'; r.big=fmt(nn.d); r.rows=[['Distance',fmt(nn.d)]]; r.dim=[nn.p,nn.q]; r.label=fmt(nn.d);
  if(fa||fb||a.type==='curve'||b.type==='curve')r.hint='Approximate: measured between points on the curved shapes.';
  return r;
}
function addEnt(e){
  if(state.ents.length>=2)clearMeasure();
  state.ents.push(e); redrawMeasure();
}
function redrawMeasure(){
  state.mObjs.forEach(function(o){scene.remove(o); o.geometry.dispose();}); state.mObjs=[];
  overlay.innerHTML=''; state.marks=[];
  state.ents.forEach(function(e){
    if(e.type==='point')mark(e.p,e.snapped?'dot snap':'dot');
    else if(e.type==='face')faceOverlay(e,faceSelMat,state.mObjs);
    else{fatLines(polySegs(e.pts,e.closed),fatSel); if(e.type==='arc')mark(e.c,'dot ctr');}
  });
  var r=state.ents.length?compute():null;
  state.dim=null;
  if(r&&r.dim){if(state.ents.length===2||state.ents[0].type!=='line')fatLines(r.dim,fatDim); state.dim=r.dim;}
  if(r&&r.label){var lb=document.createElement('div'); lb.className='dim'; lb.textContent=r.label; overlay.appendChild(lb); state.labelEl=lb; state.labelAt=r.labelAt||(r.dim?r.dim[0].clone().add(r.dim[1]).multiplyScalar(0.5):(state.ents[0].c||state.ents[0].pts[Math.floor(state.ents[0].pts.length/2)]));}
  else state.labelEl=null;
  updatePanel(r); needsRender=true;
}
function mark(p,cls){var d=document.createElement('div'); d.className=cls; overlay.appendChild(d); state.marks.push({p:p,el:d});}
function updatePanel(r){
  var mp=$('mpanel');
  if(!state.measuring){mp.classList.remove('on');return;}
  mp.classList.add('on');
  if(!state.ents.length){mp.innerHTML='<h2>Measure</h2><p class="hint">'+(state.is2d?'Move over the drawing and line ends, lines, arcs and circles light up.':'Move over the model and corners, edges and faces light up.')+' Click to pick one, or pick two to measure between them. Esc clears.</p>'; return;}
  r=r||compute();
  var html='<h2>'+r.title+'</h2>';
  if(r.big)html+='<div class="big">'+r.big+'</div>';
  if(r.rows.length)html+='<dl>'+r.rows.map(function(x){return '<dt>'+x[0]+'</dt><dd>'+x[1]+'</dd>';}).join('')+'</dl>';
  if(r.hint)html+='<p class="hint" style="margin-top:6px">'+r.hint+'</p>';
  html+='<div class="acts"><button class="btn" id="mClear">Clear</button></div>';
  mp.innerHTML=html; $('mClear').onclick=clearMeasure;
}
function updateOverlay(){
  var rect=rectOf();
  if(state.comAt){var cs=toScreen(state.comAt,rect); comEl.style.left=(cs.x-rect.left)+'px'; comEl.style.top=(cs.y-rect.top)+'px'; comEl.style.display=cs.z>1?'none':'';}
  if(state.pivotAt){var ps=toScreen(state.pivotAt,rect); pivotEl.style.left=(ps.x-rect.left)+'px'; pivotEl.style.top=(ps.y-rect.top)+'px';}
  if(hover&&hover.el&&hover.pt){var hs=toScreen(hover.pt,rect); hover.el.style.left=(hs.x-rect.left)+'px'; hover.el.style.top=(hs.y-rect.top)+'px';}
  if(!state.marks||!state.measuring)return;
  state.marks.forEach(function(m){var s=toScreen(m.p,rect); m.el.style.left=(s.x-rect.left)+'px'; m.el.style.top=(s.y-rect.top)+'px'; m.el.style.display=s.z>1?'none':'';});
  if(state.labelEl&&state.labelAt){var s=toScreen(state.labelAt,rect); state.labelEl.style.left=(s.x-rect.left)+'px'; state.labelEl.style.top=(s.y-rect.top-18)+'px'; state.labelEl.style.display=s.z>1?'none':'';}
}
$('selUnits').onchange=function(){state.units=this.value; if(state.ents.length)redrawMeasure(); else updatePanel(); updateMass();};

// ---------- clicks & keys ----------
var down=null, band=null, rot=null;
function endRotate(){if(!rot)return; try{renderer.domElement.releasePointerCapture(rot.id);}catch(err){} rot=null; state.pivotAt=null; pivotEl.style.display='none'; needsRender=true;}
renderer.domElement.addEventListener('mousedown',function(e){if(e.button===1)e.preventDefault();});
renderer.domElement.addEventListener('auxclick',function(e){e.preventDefault();});
renderer.domElement.addEventListener('pointerleave',function(){mouse.inside=false; if(hover.timer!==null){clearTimeout(hover.timer); hover.timer=null;} clearHover();});
function endBand(){if(band){band.remove(); band=null;}}
renderer.domElement.addEventListener('pointerdown',function(e){
  if(e.pointerType==='mouse'&&e.button===1&&state.meshes.length){   // double-click the wheel: zoom to fit
    var now=performance.now();
    if(lastMid&&now-lastMid.t<450&&Math.hypot(e.clientX-lastMid.x,e.clientY-lastMid.y)<8){lastMid=null; down=null; e.preventDefault(); if(state.is2d)d2Fit(); else fit(); return;}
    lastMid={t:now,x:e.clientX,y:e.clientY};
    if(state.is2d)return;
  }
  // Middle-drag (or Alt + left-drag) rotates about the point on the model under the pointer.
  if(!state.is2d&&e.pointerType==='mouse'&&state.meshes.length&&!e.ctrlKey&&!e.metaKey&&((e.button===1&&!e.shiftKey)||(e.button===0&&e.altKey))){
    var ph=rayHit(e.clientX,e.clientY);
    rot={id:e.pointerId,x:e.clientX,y:e.clientY,moved:0,pivot:ph?ph.point.clone():controls.target.clone()};
    state.pivotAt=ph?rot.pivot:null; pivotEl.style.display=ph?'':'none';
    try{renderer.domElement.setPointerCapture(e.pointerId);}catch(err){}
    clearHover(); down=null; e.preventDefault(); needsRender=true; return;
  }
  down={x:e.clientX,y:e.clientY,t:performance.now(),b:e.button,box:false,id:e.pointerId,
    canBox:e.button===0&&e.pointerType==='mouse'&&!e.altKey&&!e.ctrlKey&&!e.metaKey&&!state.measuring&&state.meshes.length>0};
  if(down.canBox){try{renderer.domElement.setPointerCapture(e.pointerId);}catch(err){}}
});
renderer.domElement.addEventListener('pointermove',function(e){
  mouse.x=e.clientX; mouse.y=e.clientY; mouse.inside=true;
  if(rot){rot.moved+=Math.abs(e.clientX-rot.x)+Math.abs(e.clientY-rot.y); if(rot.moved>6)lastMid=null; rotateAbout(rot.pivot,e.clientX-rot.x,e.clientY-rot.y); rot.x=e.clientX; rot.y=e.clientY; return;}
  if(state.measuring&&!down&&e.buttons===0&&e.pointerType==='mouse')queueHover(e.clientX,e.clientY);
  if(!down||!down.canBox)return;
  if(!down.box&&Math.hypot(e.clientX-down.x,e.clientY-down.y)>5){down.box=true; band=document.createElement('div'); band.className='band'; hud.appendChild(band);}
  if(down.box){
    var rect=rectOf(), x0=Math.min(down.x,e.clientX)-rect.left, y0=Math.min(down.y,e.clientY)-rect.top;
    band.style.left=x0+'px'; band.style.top=y0+'px';
    band.style.width=Math.abs(e.clientX-down.x)+'px'; band.style.height=Math.abs(e.clientY-down.y)+'px';
    band.classList.toggle('crossing',e.clientX<down.x);
  }
});
renderer.domElement.addEventListener('pointercancel',function(){down=null; endBand(); endRotate();});
renderer.domElement.addEventListener('pointerup',function(e){
  if(rot){endRotate(); return;}
  if(!down)return;
  var d=down; down=null;
  try{renderer.domElement.releasePointerCapture(d.id);}catch(err){}
  if(!state.meshes.length){endBand(); return;}
  if(d.box){
    endBand();
    if(state.is2d){var ids=d2BoxSelect(d.x,d.y,e.clientX,e.clientY,e.clientX<d.x); d2SetSel(e.shiftKey?Array.from(state.sel2d).concat(ids):ids); return;}
    var picked=boxSelect(d.x,d.y,e.clientX,e.clientY,e.clientX<d.x);
    setSelection(e.shiftKey?state.sel.concat(picked):picked,{noScroll:true});
    return;
  }
  var moved=Math.hypot(e.clientX-d.x,e.clientY-d.y),dt=performance.now()-d.t;
  if(moved>5||dt>600||d.b!==0)return;
  if(state.measuring){var m=state.is2d?measurePick2d(e.clientX,e.clientY):measurePick(e.clientX,e.clientY); if(m){if(m.type==='face')m=faceEntity(m.mesh,m.shell); clearHover(); addEnt(m);} return;}
  if(state.is2d){
    var pid=d2Pick(e.clientX,e.clientY,7,false), add2=e.shiftKey||e.ctrlKey||e.metaKey, cur=Array.from(state.sel2d);
    if(pid>=0)d2SetSel(add2?(state.sel2d.has(pid)?cur.filter(function(x){return x!==pid;}):cur.concat([pid])):[pid]);
    else if(!add2)d2SetSel([]);
    return;
  }
  var hit=rayHit(e.clientX,e.clientY), add=e.shiftKey||e.ctrlKey||e.metaKey;
  if(hit){var n=hit.object.userData.node; if(add)toggleSelect(n); else select(n);}
  else if(!add)select(null);
});
var viewKeys={'1':'front','2':'back','3':'left','4':'right','5':'top','6':'bottom','7':'iso'};
document.addEventListener('keydown',function(e){
  var t=e.target, typing=t&&(t.tagName==='INPUT'&&t.type!=='checkbox'||t.tagName==='TEXTAREA'||t.tagName==='SELECT');
  if(e.key==='Escape'){
    if(typing&&t.id==='search'){t.blur();}
    var had=state.ents.length||state.sel.length||state.sel2d.size;
    clearAll(); $('spanel').classList.remove('on');
    if(!had&&state.measuring)setMeasuring(false);
    if(!$('help').hidden){$('help').hidden=true; $('btnHelp').setAttribute('aria-expanded','false');}
    return;
  }
  if(typing||!state.meshes.length)return;
  if((e.ctrlKey||e.metaKey)&&viewKeys[e.key]){e.preventDefault(); if(!state.is2d)setView(viewKeys[e.key]); return;}
  if(e.ctrlKey||e.metaKey||e.altKey)return;
  if(e.key==='m'||e.key==='M'){e.preventDefault(); setMeasuring(!state.measuring);}
  else if(e.key==='f'||e.key==='F'){e.preventDefault(); normalTo();}
  else if((e.key==='h'||e.key==='H')&&(state.sel.length||state.sel2d.size)){e.preventDefault(); $('btnHideSel').click();}
});

// ---------- file input ----------
function chooseFile(){$('file').click();}
$('btnOpen').onclick=chooseFile; $('btnOpen2').onclick=chooseFile;
$('file').onchange=function(){openFile(this.files[0]); this.value='';};
view.addEventListener('dragover',function(e){e.preventDefault(); view.classList.add('dragover');});
view.addEventListener('dragleave',function(){view.classList.remove('dragover');});
view.addEventListener('drop',function(e){e.preventDefault(); view.classList.remove('dragover'); if(e.dataTransfer.files[0])openFile(e.dataTransfer.files[0]);});
if('launchQueue' in window){
  window.launchQueue.setConsumer(async function(params){if(params&&params.files&&params.files.length)openFile(await params.files[0].getFile());});
}
if('serviceWorker' in navigator){
  // When an updated viewer takes over, reload once so the new code is used straight away.
  var hadController=!!navigator.serviceWorker.controller, reloaded=false;
  navigator.serviceWorker.addEventListener('controllerchange',function(){if(hadController&&!reloaded&&!state.meshes.length){reloaded=true; location.reload();}});
}
if('serviceWorker' in navigator&&(location.protocol==='https:'||location.hostname==='localhost'||location.hostname==='127.0.0.1')){
  window.addEventListener('load',function(){navigator.serviceWorker.register('sw.js',{updateViaCache:'none'}).then(function(r){r.update();}).catch(function(e){console.warn('Offline support unavailable',e);});});
}
$('btnTree').onclick=function(){var a=$('aside'),o=!a.classList.contains('open'); a.classList.toggle('open',o); this.setAttribute('aria-expanded',o);};
window.__edv={d2World:d2World,d2Fit:d2Fit,d2:d2,measurePick2d:measurePick2d,d2Pick:d2Pick,d2SetSel:d2SetSel,d2BoxSelect:d2BoxSelect,applyModelTransform:applyModelTransform,normalTo:normalTo,setDisplay:setDisplay,faceEntity:faceEntity,hover:hover,rotateAbout:rotateAbout,boxSelect:boxSelect,setSelection:setSelection,updateMass:updateMass,state:state,get camera(){return camera;},controls:controls,measurePick:measurePick,toScreen:toScreen,rectOf:rectOf,zoomAt:zoomAt};
})();
