(function(){
'use strict';
if(typeof THREE==='undefined'||typeof fflate==='undefined'){
  var w=document.getElementById('warn'); w.textContent='The viewer’s 3D engine didn’t load. Reload the page; if this keeps happening, reinstall the app.'; w.classList.add('on'); return;
}
var $=function(id){return document.getElementById(id);};
var view=$('view'), overlay=$('overlay');
var renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:false});
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
renderer.setClearColor(0x000000,0);
view.insertBefore(renderer.domElement,view.firstChild);
var scene=new THREE.Scene();
var camera=new THREE.PerspectiveCamera(35,1,0.001,1000);
scene.add(camera);
scene.add(new THREE.AmbientLight(0xffffff,0.42));
scene.add(new THREE.HemisphereLight(0xffffff,0x8a939a,0.25));
var key=new THREE.DirectionalLight(0xffffff,0.62); key.position.set(-0.6,1,0.8); camera.add(key);
var controls=new THREE.OrbitControls(camera,renderer.domElement);
controls.enableDamping=true; controls.dampingFactor=0.12; controls.screenSpacePanning=true;
var modelRoot=new THREE.Group(); scene.add(modelRoot);
var css=function(n){return getComputedStyle(document.documentElement).getPropertyValue(n).trim();};
var edgeMat=new THREE.LineBasicMaterial({color:new THREE.Color(css('--edge')||'#27313A'),transparent:true,opacity:0.55});
var measureMat=new THREE.LineBasicMaterial({color:new THREE.Color(css('--measure')||'#C8246F'),depthTest:false,transparent:true});
var selMat=new THREE.MeshPhongMaterial({color:new THREE.Color(css('--accent')||'#2463D9'),side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1,shininess:40});
function refreshThemeColors(){
  edgeMat.color.set(css('--edge')||'#27313A'); measureMat.color.set(css('--measure')||'#C8246F'); selMat.color.set(css('--accent')||'#2463D9');
}
if(window.matchMedia){var mq=matchMedia('(prefers-color-scheme: dark)'); (mq.addEventListener?mq.addEventListener('change',refreshThemeColors):mq.addListener(refreshThemeColors));}

var needsRender=true;
var state={model:null,root:null,meshes:[],nodes:[],edgesOn:true,measuring:false,pts:[],line:null,selected:null,radius:1,units:'mm'};
var matCache=new Map();
function matFor(rgb){
  var k=rgb.join(',');
  var m=matCache.get(k);
  if(!m){m=new THREE.MeshPhongMaterial({color:new THREE.Color(rgb[0]/255,rgb[1]/255,rgb[2]/255),side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1,shininess:28,specular:0x222222});matCache.set(k,m);}
  return m;
}

function resize(){
  var w=view.clientWidth,h=view.clientHeight; if(!w||!h)return;
  renderer.setSize(w,h,false); camera.aspect=w/h; camera.updateProjectionMatrix(); needsRender=true;
}
window.addEventListener('resize',resize);
if(window.ResizeObserver) new ResizeObserver(resize).observe(view);
resize();

controls.addEventListener('change',function(){needsRender=true;});
function loop(){
  requestAnimationFrame(loop);
  controls.update();
  if(needsRender){renderer.render(scene,camera); needsRender=false; updateOverlay();}
}
loop();

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
  showWarn('');
  busy(true,'Reading '+file.name+'…',0.02);
  $('preview').style.display='none';
  await tick();
  try{
    var buf=new Uint8Array(await file.arrayBuffer());
    busy(true,'Unpacking…',0.08); await tick();
    var u=EASM.unpack(buf);
    if(u.preview){var bin=''; for(var k=0;k<u.preview.length;k+=8192)bin+=String.fromCharCode.apply(null,u.preview.subarray(k,k+8192)); var img=$('preview'); img.src='data:image/jpeg;base64,'+btoa(bin); img.style.display='block';}
    busy(true,'Decompressing model data…',0.15); await tick();
    var raw=EASM.inflateModel(u.eModel);
    busy(true,'Reading assembly structure…',0.35); await tick();
    var model=EASM.parse(raw);
    if(!model.shellCount) throw new Error('No 3D surfaces were found in this file.');
    await build(model,file.name);
    if(model.warnings.length) showWarn(model.warnings[0]+' Some geometry may be missing.');
  }catch(e){
    console.error(e);
    showWarn((e&&e.message)?e.message:'This file couldn’t be read.');
  }finally{busy(false);}
}

function clearModel(){
  clearMeasure(); select(null);
  while(modelRoot.children.length){var c=modelRoot.children.pop(); if(c.geometry&&!c.userData.shared)c.geometry.dispose();}
  state.meshes=[]; state.nodes=[]; $('tree').innerHTML='';
  geomCache.forEach(function(g){if(g){g.geo.dispose(); if(g.edges)g.edges.dispose();}});
  geomCache.clear();
}

var geomCache=new Map();
function buildGeometry(model,seg){
  var g=geomCache.get(seg.path); if(g)return g;
  var total=0,parts=[];
  for(var i=0;i<seg.shells.length;i++){var r=EASM.decodeShell(model,seg.shells[i]); if(r.idx.length){parts.push(r); total+=seg.shells[i].n;}}
  if(!parts.length){geomCache.set(seg.path,null);return null;}
  var pos=new Float32Array(total*3), idxCount=0;
  for(i=0;i<parts.length;i++)idxCount+=parts[i].idx.length;
  var IA=total>65535?Uint32Array:Uint16Array;
  var idx=new IA(idxCount), edges=[], vo=0, io=0;
  for(i=0;i<parts.length;i++){
    var r2=parts[i], n=r2.pos.length/3;
    pos.set(r2.pos,vo*3);
    for(var j=0;j<r2.idx.length;j++)idx[io++]=r2.idx[j]+vo;
    var be=EASM.boundaryEdges(r2.idx,n);
    for(j=0;j<be.length;j++)edges.push(be[j]+vo);
    vo+=n;
  }
  var geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
  geo.setIndex(new THREE.BufferAttribute(idx,1));
  geo.computeVertexNormals(); geo.computeBoundingBox(); geo.computeBoundingSphere();
  var eg=null;
  if(edges.length){eg=new THREE.BufferGeometry(); eg.setAttribute('position',geo.getAttribute('position')); eg.setIndex(new THREE.BufferAttribute(new IA(edges),1)); eg.boundingSphere=geo.boundingSphere; eg.boundingBox=geo.boundingBox;}
  g={geo:geo,edges:eg,tris:idxCount/3};
  geomCache.set(seg.path,g);
  return g;
}

function localMatrix(m){
  var M=new THREE.Matrix4();
  if(!m)return M;
  M.set(m[0],m[3],m[6],m[9], m[1],m[4],m[7],m[10], m[2],m[5],m[8],m[11], 0,0,0,1);
  return M;
}
function faceVis(s){return (s.vis&&(s.vis[0]&1))?!!(s.vis[1]&1):null;}

async function build(model,fileName){
  clearModel();
  state.model=model;
  var title=(model.title||fileName).replace(/\.sldasm$|\.sldprt$/i,'');
  $('title').textContent=title;
  var rootNode={name:title,children:[],meshes:[],visible:true,parent:null,depth:0};
  state.root=rootNode;
  // collect instances
  var jobs=[];
  function visit(path,M,color,node,chain){
    var s=model.segs.get(path); if(!s||chain.indexOf(path)>=0)return;
    chain=chain.concat(path);
    var W=M.clone().multiply(localMatrix(s.matrix));
    color=s.color||color;
    var nm=EASM.nameOf(s.opts), fv=faceVis(s);
    if(nm){
      var child={name:nm,children:[],meshes:[],visible:!(/defaultvisibility=off/.test(s.opts)||fv===false),parent:node,depth:node.depth+1,seg:path};
      node.children.push(child); node=child;
    }else if(fv===false)return;
    if(s.shells.length)jobs.push({seg:s,M:W,color:color,node:node});
    for(var i=0;i<s.kids.length;i++)visit(s.kids[i],W,color,node,chain);
    for(i=0;i<s.includes.length;i++)visit(s.includes[i],W,color,node,chain);
  }
  visit(model.root,new THREE.Matrix4(),[190,196,202],rootNode,[]);
  var tris=0;
  for(var i=0;i<jobs.length;i++){
    var jb=jobs[i];
    if(i%40===0){busy(true,'Building 3D view… '+i+' of '+jobs.length+' bodies',0.4+0.55*i/jobs.length); await tick();}
    var g=buildGeometry(model,jb.seg); if(!g)continue;
    var mesh=new THREE.Mesh(g.geo,matFor(jb.color));
    mesh.userData.shared=true; mesh.userData.node=jb.node; mesh.userData.base=mesh.material;
    mesh.matrixAutoUpdate=false; mesh.matrix.copy(jb.M); mesh.matrixWorldNeedsUpdate=true;
    modelRoot.add(mesh);
    if(g.edges){var ln=new THREE.LineSegments(g.edges,edgeMat); ln.userData.shared=true; ln.matrixAutoUpdate=false; ln.matrix.copy(jb.M); ln.raycast=function(){}; modelRoot.add(ln); mesh.userData.edges=ln;}
    jb.node.meshes.push(mesh); state.meshes.push(mesh); tris+=g.tris;
  }
  modelRoot.updateMatrixWorld(true);
  renderTree(rootNode);
  applyVisibility();
  ['btnFit','selView','btnEdges','btnMeasure','search','btnShowAll'].forEach(function(id){$(id).disabled=false;});
  $('empty').style.display='none';
  $('stats').innerHTML=state.meshes.length.toLocaleString()+' bodies, '+(tris/1e6).toFixed(1)+'M triangles<br>Model units: metres';
  setView('iso');
}

// ---------- visibility & tree ----------
function applyVisibility(){
  (function rec(n,on){
    var v=on&&n.visible;
    for(var i=0;i<n.meshes.length;i++){var m=n.meshes[i]; m.visible=v; if(m.userData.edges)m.userData.edges.visible=v&&state.edgesOn;}
    if(n.row)n.row.classList.toggle('off',!v);
    if(n.cb){n.cb.checked=n.visible;}
    for(i=0;i<n.children.length;i++)rec(n.children[i],v);
  })(state.root,true);
  needsRender=true;
}
var caretSvg='<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1.5 7 5 3 8.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function renderTree(root){
  var tree=$('tree'); tree.innerHTML='';
  function make(n,parentEl){
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
    nm.onclick=function(){select(n); if(!state.measuring)focusInfo(n);};
    for(var i=0;i<n.children.length;i++)make(n.children[i],kids);
    parentEl.appendChild(wrap);
  }
  make(root,tree);
}
function expandTo(n){var p=n.parent; while(p){if(p.kidsEl){p.kidsEl.classList.add('open'); p.caret.setAttribute('aria-expanded','true');} p=p.parent;}}
function forEachNode(n,f){f(n); for(var i=0;i<n.children.length;i++)forEachNode(n.children[i],f);}
function meshesUnder(n){var out=[]; forEachNode(n,function(x){out.push.apply(out,x.meshes);}); return out;}

$('search').addEventListener('input',function(){
  var q=this.value.trim().toLowerCase(); if(!state.root)return;
  (function rec(n){
    var hit=!q||n.name.toLowerCase().indexOf(q)>=0, anyKid=false;
    for(var i=0;i<n.children.length;i++) if(rec(n.children[i])) anyKid=true;
    var show=hit||anyKid;
    n.wrap.style.display=show?'':'none';
    if(q&&anyKid){n.kidsEl.classList.add('open'); n.caret.setAttribute('aria-expanded','true');}
    return show;
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

// ---------- selection ----------
function select(n){
  if(state.selected){meshesUnder(state.selected).forEach(function(m){m.material=m.userData.base;}); if(state.selected.row)state.selected.row.classList.remove('sel');}
  state.selected=n;
  $('btnHideSel').disabled=!n; $('btnIsolate').disabled=!n;
  if(n){
    meshesUnder(n).forEach(function(m){m.material=selMat;});
    if(n.row){n.row.classList.add('sel'); expandTo(n); n.row.scrollIntoView({block:'nearest'});}
  }else{$('spanel').classList.remove('on');}
  needsRender=true;
}
function pathOf(n){var a=[]; var p=n; while(p&&p.parent){a.unshift(p.name); p=p.parent;} return a;}
function focusInfo(n){
  var sp=$('spanel'); if(state.measuring){sp.classList.remove('on');return;}
  var path=pathOf(n);
  sp.innerHTML='';
  var h=document.createElement('h2'); h.textContent=n.name; sp.appendChild(h);
  if(path.length>1){var pp=document.createElement('p'); pp.className='hint'; pp.textContent=path.slice(0,-1).join(' › '); sp.appendChild(pp);}
  var acts=document.createElement('div'); acts.className='acts';
  var b1=document.createElement('button'); b1.className='btn'; b1.textContent='Hide'; b1.onclick=function(){$('btnHideSel').click();};
  var b2=document.createElement('button'); b2.className='btn'; b2.textContent='Isolate'; b2.onclick=function(){$('btnIsolate').click();};
  var b3=document.createElement('button'); b3.className='btn'; b3.textContent='Zoom to'; b3.onclick=function(){fit(meshesUnder(n));};
  acts.appendChild(b1); acts.appendChild(b2); acts.appendChild(b3); sp.appendChild(acts);
  sp.classList.add('on');
}

// ---------- camera ----------
function boxOf(list){
  var box=new THREE.Box3();
  for(var i=0;i<list.length;i++){var m=list[i]; if(m.visible)box.expandByObject(m);}
  if(box.isEmpty())for(i=0;i<list.length;i++)box.expandByObject(list[i]);
  return box;
}
function fit(list,dir){
  list=list||state.meshes; if(!list.length)return;
  var box=boxOf(list), c=box.getCenter(new THREE.Vector3()), r=box.getSize(new THREE.Vector3()).length()/2||1;
  state.radius=Math.max(state.radius,r);
  dir=dir||camera.position.clone().sub(controls.target).normalize();
  if(!isFinite(dir.x)||dir.lengthSq()<1e-9)dir=new THREE.Vector3(1,0.8,1.2).normalize();
  var vf=THREE.MathUtils.degToRad(camera.fov), hf=2*Math.atan(Math.tan(vf/2)*camera.aspect);
  var dist=r/Math.sin(Math.min(vf,hf)/2)*0.82;
  controls.target.copy(c); camera.position.copy(c).addScaledVector(dir,dist);
  camera.near=Math.max(dist/2000,r/5000); camera.far=dist+r*40; camera.updateProjectionMatrix();
  controls.update(); needsRender=true;
}
var dirs={iso:[1,0.75,1.15],front:[0,0,1],back:[0,0,-1],top:[0,1,0.0001],right:[1,0,0],left:[-1,0,0]};
function setView(v){var d=dirs[v]||dirs.iso; camera.up.set(0,1,0); fit(null,new THREE.Vector3(d[0],d[1],d[2]).normalize()); $('selView').value=v;}
$('btnFit').onclick=function(){fit();};
$('selView').onchange=function(){setView(this.value);};
$('btnEdges').onclick=function(){state.edgesOn=!state.edgesOn; this.setAttribute('aria-pressed',state.edgesOn); applyVisibility();};

// ---------- picking & measuring ----------
var ray=new THREE.Raycaster();
function pick(cx,cy,snap){
  var rect=renderer.domElement.getBoundingClientRect();
  var ndc=new THREE.Vector2((cx-rect.left)/rect.width*2-1,-((cy-rect.top)/rect.height)*2+1);
  ray.setFromCamera(ndc,camera);
  var vis=state.meshes.filter(function(m){return m.visible;});
  var hits=ray.intersectObjects(vis,false);
  if(!hits.length)return null;
  var h=hits[0], p=h.point.clone(), snapped=false;
  if(snap&&h.face){
    var pa=h.object.geometry.getAttribute('position'), best=14, v=new THREE.Vector3();
    [h.face.a,h.face.b,h.face.c].forEach(function(ix){
      v.fromBufferAttribute(pa,ix).applyMatrix4(h.object.matrixWorld);
      var s=v.clone().project(camera);
      var sx=(s.x+1)/2*rect.width+rect.left, sy=(1-s.y)/2*rect.height+rect.top;
      var dd=Math.hypot(sx-cx,sy-cy);
      if(dd<best){best=dd; p.copy(v); snapped=true;}
    });
  }
  return {point:p,mesh:h.object,snapped:snapped};
}
var UNITS={mm:[1000,2],cm:[100,3],m:[1,4],in:[39.37007874,3]};
function fmt(v){var u=UNITS[state.units]; return (v*u[0]).toFixed(u[1])+' '+state.units;}
function clearMeasure(){
  state.pts=[]; if(state.line){scene.remove(state.line); state.line.geometry.dispose(); state.line=null;}
  overlay.innerHTML=''; updatePanel(); needsRender=true;
}
function addPoint(hit){
  if(state.pts.length>=2)clearMeasure();
  state.pts.push(hit);
  if(state.pts.length===2){
    var g=new THREE.BufferGeometry().setFromPoints([state.pts[0].point,state.pts[1].point]);
    state.line=new THREE.Line(g,measureMat); state.line.renderOrder=999; scene.add(state.line);
  }
  overlay.innerHTML='';
  state.pts.forEach(function(pt){var d=document.createElement('div'); d.className='dot'+(pt.snapped?' snap':''); overlay.appendChild(d); pt.el=d;});
  if(state.pts.length===2){var lb=document.createElement('div'); lb.className='dim'; overlay.appendChild(lb); state.label=lb;}
  updatePanel(); needsRender=true;
}
function updatePanel(){
  var mp=$('mpanel');
  if(!state.measuring){mp.classList.remove('on');return;}
  mp.classList.add('on');
  var p=state.pts;
  if(p.length<2){
    mp.innerHTML='<h2>Measure</h2><p class="hint">'+(p.length?'Now click the second point.':'Click a point on the model. Points snap to nearby corners.')+'</p>';
    if(p.length){var acts='<div class="acts"><button class="btn" id="mClear">Clear</button></div>'; mp.insertAdjacentHTML('beforeend',acts); $('mClear').onclick=clearMeasure;}
    return;
  }
  var a=p[0].point,b=p[1].point,d=b.clone().sub(a);
  if(state.label)state.label.textContent=fmt(d.length());
  mp.innerHTML='<h2>Distance</h2><div class="big">'+fmt(d.length())+'</div><dl>'+
    '<dt>ΔX</dt><dd>'+fmt(Math.abs(d.x))+'</dd><dt>ΔY</dt><dd>'+fmt(Math.abs(d.y))+'</dd><dt>ΔZ</dt><dd>'+fmt(Math.abs(d.z))+'</dd></dl>'+
    '<div class="acts"><button class="btn" id="mClear">Clear</button></div>';
  $('mClear').onclick=clearMeasure;
}
function updateOverlay(){
  if(!state.pts.length)return;
  var rect=renderer.domElement.getBoundingClientRect();
  var toScreen=function(v){var s=v.clone().project(camera); return [(s.x+1)/2*rect.width,(1-s.y)/2*rect.height,s.z];};
  state.pts.forEach(function(pt){var s=toScreen(pt.point); pt.el.style.left=s[0]+'px'; pt.el.style.top=s[1]+'px'; pt.el.style.display=s[2]>1?'none':'';});
  if(state.pts.length===2&&state.label){var m=state.pts[0].point.clone().add(state.pts[1].point).multiplyScalar(0.5); var s=toScreen(m); state.label.style.left=s[0]+'px'; state.label.style.top=(s[1]-18)+'px';}
}
$('btnMeasure').onclick=function(){
  state.measuring=!state.measuring; this.setAttribute('aria-pressed',state.measuring);
  view.classList.toggle('measuring',state.measuring);
  if(!state.measuring)clearMeasure(); else $('spanel').classList.remove('on');
  updatePanel();
};
$('selUnits').onchange=function(){state.units=this.value; updatePanel();};
document.addEventListener('keydown',function(e){if(e.key==='Escape'){if(state.measuring&&state.pts.length)clearMeasure(); else if(state.selected)select(null);}});

var down=null;
renderer.domElement.addEventListener('pointerdown',function(e){down={x:e.clientX,y:e.clientY,t:performance.now()};});
renderer.domElement.addEventListener('pointerup',function(e){
  if(!down||!state.meshes.length)return;
  var moved=Math.hypot(e.clientX-down.x,e.clientY-down.y), dt=performance.now()-down.t; down=null;
  if(moved>5||dt>600)return;
  var hit=pick(e.clientX,e.clientY,state.measuring);
  if(state.measuring){if(hit)addPoint(hit); return;}
  if(hit){var n=hit.mesh.userData.node; select(n); focusInfo(n);} else select(null);
});

// ---------- file input ----------
function chooseFile(){$('file').click();}
$('btnOpen').onclick=chooseFile; $('btnOpen2').onclick=chooseFile;
$('file').onchange=function(){openFile(this.files[0]); this.value='';};
view.addEventListener('dragover',function(e){e.preventDefault(); view.classList.add('dragover');});
view.addEventListener('dragleave',function(){view.classList.remove('dragover');});
view.addEventListener('drop',function(e){e.preventDefault(); view.classList.remove('dragover'); if(e.dataTransfer.files[0])openFile(e.dataTransfer.files[0]);});
// Opened from the Files app ("Open with") when installed
if('launchQueue' in window){
  window.launchQueue.setConsumer(async function(params){
    if(params&&params.files&&params.files.length){var fh=params.files[0]; openFile(await fh.getFile());}
  });
}
if('serviceWorker' in navigator&&(location.protocol==='https:'||location.hostname==='localhost'||location.hostname==='127.0.0.1')){
  window.addEventListener('load',function(){navigator.serviceWorker.register('sw.js').catch(function(e){console.warn('Offline support unavailable',e);});});
}
$('btnTree').onclick=function(){var a=$('aside'); var o=!a.classList.contains('open'); a.classList.toggle('open',o); this.setAttribute('aria-expanded',o);};
})();
