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
controls.mouseButtons={LEFT:THREE.MOUSE.ROTATE,MIDDLE:THREE.MOUSE.ROTATE,RIGHT:THREE.MOUSE.PAN};
// Middle-drag rotates, Ctrl+drag pans, Shift+drag zooms (left or middle button).
view.addEventListener('pointerdown',function(e){
  if(e.pointerType!=='mouse')return;
  var zoom=e.shiftKey&&!e.ctrlKey, pan=e.ctrlKey||e.metaKey;
  controls.mouseButtons.LEFT=zoom?THREE.MOUSE.DOLLY:THREE.MOUSE.ROTATE;
  controls.mouseButtons.MIDDLE=pan?THREE.MOUSE.PAN:(zoom?THREE.MOUSE.DOLLY:THREE.MOUSE.ROTATE);
},true);
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
function refreshThemeColors(){
  edgeMat.color.set(css('--edge')||'#27313A'); selMat.color.set(css('--accent')||'#2463D9');
  fatSel.color.set(css('--measure')||'#C8246F'); fatDim.color.set(css('--measure')||'#C8246F'); needsRender=true;
}
if(window.matchMedia){var mq=matchMedia('(prefers-color-scheme: dark)'); (mq.addEventListener?mq.addEventListener('change',refreshThemeColors):mq.addListener(refreshThemeColors));}

var needsRender=true;
var state={model:null,root:null,meshes:[],edgesOn:true,measuring:false,ents:[],selected:null,radius:1,units:'mm',mObjs:[]};
var matCache=new Map();
function matFor(rgb){
  var k=rgb.join(','), m=matCache.get(k);
  if(!m){m=new THREE.MeshPhongMaterial({color:new THREE.Color(rgb[0]/255,rgb[1]/255,rgb[2]/255),side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1,shininess:28,specular:0x222222});matCache.set(k,m);}
  return m;
}
function resize(){
  var w=view.clientWidth,h=view.clientHeight; if(!w||!h)return;
  renderer.setSize(w,h,false); persp.aspect=w/h; persp.updateProjectionMatrix(); setOrthoFrustum();
  fatSel.resolution.set(w,h); fatDim.resolution.set(w,h); needsRender=true;
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
function showWarn(msg){var w=$('warn'); w.textContent=msg||''; w.classList.toggle('on',!!msg);}
async function openFile(file){
  if(!file)return;
  showWarn(''); $('preview').style.display='none';
  busy(true,'Reading '+file.name+'…',0.02); await tick();
  try{
    var buf=new Uint8Array(await file.arrayBuffer());
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
  }catch(e){console.error(e); showWarn((e&&e.message)?e.message:'This file couldn’t be read.');}
  finally{busy(false);}
}
var geomCache=new Map();
function clearModel(){
  clearAll(); setMeasuring(false);
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
  var idx=new IA(idxCount), edges=[], eshell=[], vo=0, io=0;
  for(i=0;i<parts.length;i++){
    var r2=parts[i], n=r2.pos.length/3;
    pos.set(r2.pos,vo*3);
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
  var g={geo:geo,edges:eg,tris:idxCount/3,edgeIdx:edgeIdx,edgeShell:new Int32Array(eshell),topo:null};
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
  // A part file with several bodies: list them so each can be hidden.
  if(!rootNode.children.length&&rootNode.meshes.length>1){
    rootNode.meshes.forEach(function(m,k){rootNode.children.push({name:'Body '+(k+1),children:[],meshes:[m],visible:true,parent:rootNode,depth:1}); m.userData.node=rootNode.children[k];});
    rootNode.meshes=[];
  }
  modelRoot.updateMatrixWorld(true);
  renderTree(rootNode); applyVisibility();
  ['btnFit','selView','selProj','btnEdges','btnMeasure','search','btnShowAll'].forEach(function(id){$(id).disabled=false;});
  $('empty').style.display='none';
  $('stats').innerHTML=state.meshes.length.toLocaleString()+' bodies, '+(tris/1e6).toFixed(tris<1e5?2:1)+'M triangles<br>Model units: metres, viewer version 5';
  state.radius=1; setView('iso');
}

// ---------- visibility & tree ----------
function applyVisibility(){
  (function rec(n,on){
    var v=on&&n.visible;
    for(var i=0;i<n.meshes.length;i++){var m=n.meshes[i]; m.visible=v; if(m.userData.edges)m.userData.edges.visible=v&&state.edgesOn;}
    if(n.row)n.row.classList.toggle('off',!v);
    if(n.cb)n.cb.checked=n.visible;
    for(i=0;i<n.children.length;i++)rec(n.children[i],v);
  })(state.root,true);
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
    nm.onclick=function(){select(n); focusInfo(n);};
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
$('btnShowAll').onclick=function(){forEachNode(state.root,function(n){n.visible=true;}); applyVisibility();};
$('btnHideSel').onclick=function(){if(state.selected){state.selected.visible=false; applyVisibility(); select(null);}};
$('btnIsolate').onclick=function(){
  var s=state.selected; if(!s)return;
  forEachNode(state.root,function(n){n.visible=false;});
  var p=s; while(p){p.visible=true; p=p.parent;}
  forEachNode(s,function(n){n.visible=true;});
  applyVisibility(); fit(meshesUnder(s));
};

// ---------- part selection ----------
function select(n){
  if(state.selected){meshesUnder(state.selected).forEach(function(m){m.material=m.userData.base;}); if(state.selected.row)state.selected.row.classList.remove('sel');}
  state.selected=n;
  $('btnHideSel').disabled=!n; $('btnIsolate').disabled=!n;
  if(n){meshesUnder(n).forEach(function(m){m.material=selMat;}); if(n.row){n.row.classList.add('sel'); expandTo(n); n.row.scrollIntoView({block:'nearest'});}}
  else $('spanel').classList.remove('on');
  needsRender=true;
}
function pathOf(n){var a=[],p=n; while(p&&p.parent){a.unshift(p.name); p=p.parent;} return a;}
function focusInfo(n){
  var sp=$('spanel'); if(state.measuring||!n){sp.classList.remove('on');return;}
  var path=pathOf(n); sp.innerHTML='';
  var h=document.createElement('h2'); h.textContent=n.name; sp.appendChild(h);
  if(path.length>1){var pp=document.createElement('p'); pp.className='hint'; pp.textContent=path.slice(0,-1).join(' › '); sp.appendChild(pp);}
  var acts=document.createElement('div'); acts.className='acts';
  [['Hide',function(){$('btnHideSel').click();}],['Isolate',function(){$('btnIsolate').click();}],['Zoom to',function(){fit(meshesUnder(n));}]].forEach(function(a){
    var b=document.createElement('button'); b.className='btn'; b.textContent=a[0]; b.onclick=a[1]; acts.appendChild(b);});
  sp.appendChild(acts); sp.classList.add('on');
}

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
$('btnFit').onclick=function(){fit();};
function setProjection(mode){
  var next=mode==='ortho'?ortho:persp;
  $('selProj').value=mode; try{localStorage.setItem('edv.proj',mode);}catch(e){}
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
$('btnEdges').onclick=function(){state.edgesOn=!state.edgesOn; this.setAttribute('aria-pressed',state.edgesOn); applyVisibility();};
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
// Measure pick: corner (snap) > edge > point on a face.
function measurePick(cx,cy){
  var rect=rectOf(), hit=null;
  var offs=[[0,0],[7,0],[-7,0],[0,7],[0,-7],[5,5],[-5,-5],[5,-5],[-5,5]];
  for(var i=0;i<offs.length&&!hit;i++)hit=rayHit(cx+offs[i][0],cy+offs[i][1]);
  if(!hit)return null;
  var mesh=hit.object,g=mesh.userData.g,M=mesh.matrixWorld,T=topo(g);
  var vdir=camera.getWorldDirection(new THREE.Vector3()), camPos=camera.position.clone();
  var hitDepth=hit.point.clone().sub(camPos).dot(vdir);
  var wpp=camera.isOrthographicCamera?(camera.top-camera.bottom)/camera.zoom/rect.height:2*hitDepth*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))/rect.height;
  var depthTol=wpp*30;
  function visible(p){return p.clone().sub(camPos).dot(vdir)<=hitDepth+depthTol;}
  // corners
  var best=11,bestP=null;
  for(var c=0;c<T.corner.length;c++){
    if(!T.corner[c])continue;
    var p=cpos(T,c,M),s=toScreen(p,rect),d=Math.hypot(s.x-cx,s.y-cy);
    if(d<best&&visible(p)){best=d;bestP=p;}
  }
  if(bestP)return {type:'point',p:bestP,snapped:true,mesh:mesh};
  // edges
  var bestE=-1; best=9;
  var E=g.edgeIdx,pa=new THREE.Vector3(),pb=new THREE.Vector3(),pos=g.geo.getAttribute('position');
  for(var k=0;k<E.length/2;k++){
    pa.fromBufferAttribute(pos,E[2*k]).applyMatrix4(M); pb.fromBufferAttribute(pos,E[2*k+1]).applyMatrix4(M);
    var sa=toScreen(pa,rect),sb=toScreen(pb,rect);
    if(sa.z>1||sb.z>1)continue;
    var vx=sb.x-sa.x,vy=sb.y-sa.y,l2=vx*vx+vy*vy,t=l2?Math.max(0,Math.min(1,((cx-sa.x)*vx+(cy-sa.y)*vy)/l2)):0;
    var dd=Math.hypot(sa.x+vx*t-cx,sa.y+vy*t-cy);
    if(dd<best){var pw=pa.clone().lerp(pb,t); if(visible(pw)){best=dd;bestE=k;}}
  }
  if(bestE>=0){var e=classify(chainFrom(g,bestE,M)); e.mesh=mesh; return e;}
  var h0=rayHit(cx,cy);
  return h0?{type:'point',p:h0.point.clone(),snapped:false,mesh:h0.object}:null;
}

// ---------- measuring ----------
var UNITS={mm:[1000,2],cm:[100,3],m:[1,4],in:[39.37007874,3]};
function fmt(v){var u=UNITS[state.units]; return (v*u[0]).toFixed(u[1])+' '+state.units;}
function fmtA(rad){return (rad*180/Math.PI).toFixed(2)+'°';}
function setMeasuring(on){
  state.measuring=on; $('btnMeasure').setAttribute('aria-pressed',on);
  view.classList.toggle('measuring',on);
  if(on){$('spanel').classList.remove('on'); select(null);} else clearMeasure();
  updatePanel();
}
$('btnMeasure').onclick=function(){setMeasuring(!state.measuring);};
function clearMeasure(){
  state.ents=[]; state.mObjs.forEach(function(o){scene.remove(o); o.geometry.dispose();}); state.mObjs=[]; state.dim=null;
  overlay.innerHTML=''; updatePanel(); needsRender=true;
}
function clearAll(){clearMeasure(); select(null);}
function fatLines(points,mat){
  var arr=[]; for(var i=0;i<points.length;i+=2)arr.push(points[i].x,points[i].y,points[i].z,points[i+1].x,points[i+1].y,points[i+1].z);
  var g=new THREE.LineSegmentsGeometry(); g.setPositions(arr);
  var l=new THREE.LineSegments2(g,mat); l.renderOrder=999; l.computeLineDistances&&l.computeLineDistances();
  scene.add(l); state.mObjs.push(l); return l;
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
    if(e.type==='point'){r.title=e.snapped?'Corner':'Point on face'; r.big=''; r.rows=[['X',fmt(e.p.x)],['Y',fmt(e.p.y)],['Z',fmt(e.p.z)]]; r.hint='Pick a second item to measure between them.';}
    else if(e.type==='line'){r.title='Edge (straight)'; r.big=fmt(e.length); r.rows=[['Length',fmt(e.length)]]; r.dim=[e.a,e.b]; r.label=fmt(e.length);}
    else if(e.type==='arc'){r.title=e.closed?'Edge (circle)':'Edge (arc)'; r.big='Ø '+fmt(2*e.r); r.rows=[['Diameter',fmt(2*e.r)],['Radius',fmt(e.r)],[e.closed?'Circumference':'Arc length',fmt(e.length)]]; r.label='Ø '+fmt(2*e.r);}
    else {r.title='Edge (curve)'; r.big=fmt(e.length); r.rows=[['Length',fmt(e.length)]]; r.label=fmt(e.length);}
    return r;
  }
  var a=E[0],b=E[1],pa=anchor(a),pb=anchor(b);
  if(pa&&pb){
    var d=pb.clone().sub(pa);
    r.title=(a.type==='arc'&&b.type==='arc')?'Centre distance':(a.type==='arc'||b.type==='arc')?'Distance to centre':'Distance';
    r.big=fmt(d.length()); r.rows=[['ΔX',fmt(Math.abs(d.x))],['ΔY',fmt(Math.abs(d.y))],['ΔZ',fmt(Math.abs(d.z))]];
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
  var A=pa?[pa]:a.pts,B=pb?[pb]:b.pts,nn=nearestSets(A,B);
  r.title='Minimum distance'; r.big=fmt(nn.d); r.rows=[['Distance',fmt(nn.d)]]; r.dim=[nn.p,nn.q]; r.label=fmt(nn.d);
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
    else{fatLines(polySegs(e.pts,e.closed),fatSel); if(e.type==='arc')mark(e.c,'dot ctr');}
  });
  var r=state.ents.length?compute():null;
  state.dim=null;
  if(r&&r.dim){if(state.ents.length===2||state.ents[0].type!=='line')fatLines(r.dim,fatDim); state.dim=r.dim;}
  if(r&&r.label){var lb=document.createElement('div'); lb.className='dim'; lb.textContent=r.label; overlay.appendChild(lb); state.labelEl=lb; state.labelAt=r.dim?r.dim[0].clone().add(r.dim[1]).multiplyScalar(0.5):(state.ents[0].c||state.ents[0].pts[Math.floor(state.ents[0].pts.length/2)]);}
  else state.labelEl=null;
  updatePanel(r); needsRender=true;
}
function mark(p,cls){var d=document.createElement('div'); d.className=cls; overlay.appendChild(d); state.marks.push({p:p,el:d});}
function updatePanel(r){
  var mp=$('mpanel');
  if(!state.measuring){mp.classList.remove('on');return;}
  mp.classList.add('on');
  if(!state.ents.length){mp.innerHTML='<h2>Measure</h2><p class="hint">Click a corner, an edge or a face. Pick two items to measure between them. Esc clears.</p>'; return;}
  r=r||compute();
  var html='<h2>'+r.title+'</h2>';
  if(r.big)html+='<div class="big">'+r.big+'</div>';
  if(r.rows.length)html+='<dl>'+r.rows.map(function(x){return '<dt>'+x[0]+'</dt><dd>'+x[1]+'</dd>';}).join('')+'</dl>';
  if(r.hint)html+='<p class="hint" style="margin-top:6px">'+r.hint+'</p>';
  html+='<div class="acts"><button class="btn" id="mClear">Clear</button></div>';
  mp.innerHTML=html; $('mClear').onclick=clearMeasure;
}
function updateOverlay(){
  if(!state.marks||!state.measuring)return;
  var rect=rectOf();
  state.marks.forEach(function(m){var s=toScreen(m.p,rect); m.el.style.left=(s.x-rect.left)+'px'; m.el.style.top=(s.y-rect.top)+'px'; m.el.style.display=s.z>1?'none':'';});
  if(state.labelEl&&state.labelAt){var s=toScreen(state.labelAt,rect); state.labelEl.style.left=(s.x-rect.left)+'px'; state.labelEl.style.top=(s.y-rect.top-18)+'px'; state.labelEl.style.display=s.z>1?'none':'';}
}
$('selUnits').onchange=function(){state.units=this.value; if(state.ents.length)redrawMeasure(); else updatePanel();};

// ---------- clicks & keys ----------
var down=null;
renderer.domElement.addEventListener('pointerdown',function(e){down={x:e.clientX,y:e.clientY,t:performance.now(),b:e.button};});
renderer.domElement.addEventListener('pointerup',function(e){
  if(!down||!state.meshes.length)return;
  var moved=Math.hypot(e.clientX-down.x,e.clientY-down.y),dt=performance.now()-down.t,b=down.b; down=null;
  if(moved>5||dt>600||b!==0)return;
  if(state.measuring){var m=measurePick(e.clientX,e.clientY); if(m)addEnt(m); return;}
  var hit=rayHit(e.clientX,e.clientY);
  if(hit){var n=hit.object.userData.node; select(n); focusInfo(n);} else select(null);
});
var viewKeys={'1':'front','2':'back','3':'left','4':'right','5':'top','6':'bottom','7':'iso'};
document.addEventListener('keydown',function(e){
  var t=e.target, typing=t&&(t.tagName==='INPUT'&&t.type!=='checkbox'||t.tagName==='TEXTAREA'||t.tagName==='SELECT');
  if(e.key==='Escape'){
    if(typing&&t.id==='search'){t.blur();}
    var had=state.ents.length||state.selected;
    clearAll(); $('spanel').classList.remove('on');
    if(!had&&state.measuring)setMeasuring(false);
    if(!$('help').hidden){$('help').hidden=true; $('btnHelp').setAttribute('aria-expanded','false');}
    return;
  }
  if(typing||!state.meshes.length)return;
  if((e.ctrlKey||e.metaKey)&&viewKeys[e.key]){e.preventDefault(); setView(viewKeys[e.key]); return;}
  if(e.ctrlKey||e.metaKey||e.altKey)return;
  if(e.key==='m'||e.key==='M'){e.preventDefault(); setMeasuring(!state.measuring);}
  else if(e.key==='f'||e.key==='F'){e.preventDefault(); fit();}
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
window.__edv={state:state,get camera(){return camera;},controls:controls,measurePick:measurePick,toScreen:toScreen,rectOf:rectOf,zoomAt:zoomAt};
})();
