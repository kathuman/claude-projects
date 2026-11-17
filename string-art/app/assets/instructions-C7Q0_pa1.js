import{T as n,i as u,f,L as v,l as $}from"./version-BNERoiKh.js";const w=1024,y=t=>Math.round(t*w)/w;function M(t,e){return-Math.PI/2+2*Math.PI*t/e}function I(t,e,a=2){if(!Number.isInteger(t)||t<3)throw new RangeError("nails must be an integer ≥ 3");if(!Number.isInteger(e)||e<16)throw new RangeError("res must be an integer ≥ 16");const r=e/2,s=e/2,p=e/2-a,l=new Float64Array(t),i=new Float64Array(t);for(let c=0;c<t;c++){const d=M(c,t);l[c]=y(r+p*Math.cos(d)),i[c]=y(s+p*Math.sin(d))}return{nails:t,res:e,radius:p,cx:r,cy:s,xs:l,ys:i}}function S(t,e,a){const r=Math.abs(t-e)%a;return Math.min(r,a-r)}function E(t,e,a,r){return r*Math.sin(Math.PI*S(t,e,a)/a)}function P(t){const{res:e,cx:a,cy:r,radius:s}=t,p=new Uint8Array(e*e),l=(s+.5)*(s+.5);for(let i=0;i<e;i++){const c=i+.5-r;for(let d=0;d<e;d++){const h=d+.5-a;h*h+c*c<=l&&(p[i*e+d]=1)}}return p}const b={params:"sa-params-v1",last:"sa-last-v1",thread:"sa-thread-v1-"};function k(){try{return typeof localStorage<"u"?localStorage:null}catch{return null}}function g(t,e=k()){try{const a=e?.getItem(t);return a?JSON.parse(a):null}catch{return null}}function x(t,e,a=k()){try{return a?.setItem(t,JSON.stringify(e)),!!a}catch{return!1}}const q=(t,e)=>x(b.params,t,e);function L(t,e){const a=g(b.params,e);if(!a||typeof a!="object")return{...t};const r={...t};for(const s of Object.keys(t))typeof a[s]=="number"&&Number.isFinite(a[s])&&(r[s]=a[s]);return r}const O=(t,e)=>x(b.last,t,e);function T(t){const e=g(b.last,t);return!e||!Array.isArray(e.sequence)||!e.params||!e.metrics||e.sequence.some(a=>!Number.isInteger(a)||a<0||a>=e.params.nails)?null:e}const K=(t,e,a)=>x(b.thread+t,e,a);function z(t,e){const a=g(b.thread+t,e);return typeof a=="number"&&Number.isFinite(a)?a:0}const m=10,o=t=>t.replace(/[&<>"]/g,e=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[e]);function N(t){let e=2166136261;for(let a=0;a<t.length;a++)e^=t[a]&255,e=Math.imul(e,16777619),e^=t[a]>>8,e=Math.imul(e,16777619);return(e>>>0).toString(16).padStart(8,"0")}function B(t){const e=t.sequence.length-1,a=Math.ceil(e/m),r=N(t.sequence),s=[[n("Nails"),n("{n}, numbered 0 to {m} clockwise; nail 0 at the top",{n:u(t.nails),m:u(t.nails-1)})],[n("Board diameter"),n("{d} mm (the circle the nails stand on)",{d:f(t.boardMm,0)})],[n("Thread"),n("{t} mm black; you need {m} m, plus {s} m for wrapping and slack",{t:f(t.threadMm,2),m:f(t.threadM,0),s:f(t.slackM,0)})],[n("Lines"),u(e)],[n("Start"),n("tie the thread to nail {n}",{n:t.sequence[0]})]];let p="";for(let l=0;l<a;l++){const i=l*m+1,c=Math.min(e,i+m-1),d=[];for(let h=i;h<=c;h++)d.push(`<span>${t.sequence[h]}</span>`);p+=`<li class="blk"><label><input type="checkbox" data-b="${l}"><span class="bn">${u(i)}–${u(c)}</span></label><div class="nails">${d.join("")}</div></li>
`}return`<!doctype html>
<html lang="${v[$].html}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${o(n("String Art — winding instructions"))}</title>
<style>
  body{font-family:Barlow,"Helvetica Neue",Arial,sans-serif; color:#111; margin:24px auto; max-width:900px; padding:0 16px; line-height:1.45;}
  h1{font-size:26px; margin:0 0 4px;} .sub{color:#555; margin:0 0 16px;}
  .top{display:grid; grid-template-columns:1fr 220px; gap:20px; align-items:start;}
  .top img{width:220px; height:220px; border-radius:50%; border:1px solid #bbb; background:#fff;}
  table.facts{border-collapse:collapse; width:100%; font-size:15px;}
  table.facts th{text-align:left; font-weight:600; padding:4px 10px 4px 0; vertical-align:top; white-space:nowrap;}
  table.facts td{padding:4px 0;}
  .how{background:#f3f5f7; border-left:4px solid #3a7bd5; padding:10px 14px; margin:18px 0; font-size:15px;}
  .how ol{margin:6px 0 0; padding-left:20px;}
  .bar{display:flex; gap:10px; align-items:center; margin:12px 0;} .bar button{font:inherit; font-weight:600; padding:8px 14px; border:1px solid #3a7bd5; background:#3a7bd5; color:#fff; border-radius:6px; cursor:pointer;}
  .bar .done{color:#555;}
  ol.blocks{list-style:none; padding:0; margin:0;}
  .blk{display:flex; align-items:center; gap:14px; padding:7px 4px; border-bottom:1px solid #ddd; break-inside:avoid;}
  .blk label{display:flex; align-items:center; gap:8px; min-width:120px; font-size:14px; color:#444; cursor:pointer;}
  .blk input{width:22px; height:22px;}
  .nails{display:grid; grid-template-columns:repeat(10, 1fr); gap:4px; flex:1;}
  .nails span{font:700 22px/1.2 "IBM Plex Mono",ui-monospace,Menlo,monospace; text-align:center; padding:2px 0; border-radius:4px; background:#f6f6f6;}
  .blk.ticked .nails span{color:#999; background:#fff; text-decoration:line-through;}
  @media (max-width:640px){ .top{grid-template-columns:1fr;} .nails{grid-template-columns:repeat(5, 1fr);} .blk{flex-wrap:wrap;} }
  @media print{ .bar{display:none;} body{margin:0; max-width:none;} .nails span{background:#fff; border:1px solid #ccc;} .how{break-inside:avoid;} }
</style>
</head>
<body>
<h1>${o(n("String Art — winding instructions"))}</h1>
<p class="sub">${o(n("Made with String Art version {v} on {d}.",{v:t.version,d:t.date}))}</p>
<div class="top">
  <table class="facts">${s.map(([l,i])=>`<tr><th>${o(l)}</th><td>${o(i)}</td></tr>`).join("")}</table>
  ${t.preview?`<img src="${t.preview}" alt="${o(n("The finished piece, as simulated"))}">`:""}
</div>
<div class="how"><b>${o(n("How to wind"))}</b><ol>
  <li>${o(n("Number the nails 0 to {m} clockwise, starting with nail 0 at the top (12 o'clock).",{m:u(t.nails-1)}))}</li>
  <li>${o(n("Tie the thread to nail {n}.",{n:t.sequence[0]}))}</li>
  <li>${o(n("Read each block left to right: take the thread straight across the board to the next nail, once around it, and on to the next. Keep the thread taut."))}</li>
  <li>${o(n("Tick a block when it is done. The ticks are remembered in this browser, so you can stop and carry on later."))}</li>
  <li>${o(n("After the last nail, tie the thread off."))}</li>
</ol></div>
<div class="bar"><button onclick="window.print()">${o(n("Print or save as PDF"))}</button><span class="done" id="done"></span></div>
<ol class="blocks">
${p}</ol>
<script>
(function(){
  var KEY = "string-art-ticks-${r}", boxes = document.querySelectorAll(".blk input"), done = document.getElementById("done");
  var saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { saved = {}; }
  function show(){ var n = 0; boxes.forEach(function(b){ b.closest(".blk").classList.toggle("ticked", b.checked); if (b.checked) n++; });
    done.textContent = ${JSON.stringify(n("{n} of {t} blocks done"))}.replace("{n}", n).replace("{t}", boxes.length); }
  boxes.forEach(function(b){ b.checked = !!saved[b.dataset.b]; b.addEventListener("change", function(){ saved[b.dataset.b] = b.checked; try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) {} show(); }); });
  show();
})();
<\/script>
</body>
</html>
`}export{K as a,L as b,E as c,P as d,T as e,q as f,O as g,B as i,z as l,I as m,N as s};
