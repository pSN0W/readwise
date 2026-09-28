/* W6 */
function wCoverage(st){
  var html="";
  ["A","B","C","D"].forEach(function(s){
    var segs=[]; CARDS.forEach(function(c){ c.src.forEach(function(x){ if(x.s===s) segs.push({c:c,a:x.a,b:x.b}); }); });
    if(!segs.length) return;
    var lo=Math.min.apply(null,segs.map(function(z){return z.a;})), hi=Math.max.apply(null,segs.map(function(z){return z.b;}));
    if(SOURCES[s].kind==="video"){ lo=0; hi=VIDEO_LEN; }
    var span=hi-lo;
    var bar=segs.map(function(z){ return '<span class="seg2 '+z.c.state+'" data-id="'+z.c.id+'" title="'+esc(z.c.title+" · "+ref({s:s,a:z.a,b:z.b}))+'" style="left:'+(100*(z.a-lo)/span)+'%;width:'+Math.max(.6,100*(z.b-z.a)/span)+'%"></span>'; }).join("")+
      (GAPS[s]||[]).map(function(g){ return '<span class="gap2" title="'+(g[1]-g[0]+1)+' lines with no card" style="left:'+(100*(g[0]-lo)/span)+'%;width:'+Math.max(.6,100*(g[1]-g[0])/span)+'%"></span>'; }).join("");
    var fmt=SOURCES[s].kind==="video"?mmss:function(n){return "L"+n;};
    var read=readShare(segs.map(function(z){return z.c;}));
    html+='<div class="strip"><div style="display:flex;justify-content:space-between;gap:10px"><b>'+SOURCES[s].full+'</b><span class="small">'+segs.length+' cards · '+read+'% read</span></div><div class="bar2">'+bar+'</div><div class="axis"><span>'+fmt(lo)+'</span><span>'+fmt(Math.round(lo+span/2))+'</span><span>'+fmt(hi)+'</span></div></div>';
  });
  st.innerHTML='<div class="toolbar"><div class="key-row"><span><i style="background:color-mix(in srgb,var(--accent) 45%,var(--paper))"></i>new</span><span><i style="background:color-mix(in srgb,var(--accent) 22%,var(--paper))"></i>viewed</span><span><i style="background:color-mix(in srgb,var(--good) 55%,var(--paper))"></i>explored</span><span><i style="background:color-mix(in srgb,var(--muted) 30%,var(--paper))"></i>known</span><span><i style="background:repeating-linear-gradient(45deg,var(--rule-red) 0 2px,transparent 2px 5px)"></i>no card</span></div></div><div class="cols" style="grid-template-columns:1.5fr 1fr"><div class="col" style="gap:22px;padding:20px">'+html+'<p class="small">Book A: the hatch at L1561–1599 is 39 lines. That is above your limit of '+GAP_LIMIT+', so the ingest report flags it (see W12).</p></div><div class="col" id="w6d"><p class="small">Click a block to open its card.</p></div></div>';
  st.querySelectorAll(".seg2").forEach(function(el){ el.addEventListener("click",function(){ var c=byId(el.dataset.id); var d=st.querySelector("#w6d"); d.innerHTML=detailHTML(c); bindDetail(d,c); }); });
}

/* W7 */
var w7hl="c1";
function wVideo(st){
  var cs=CARDS.filter(function(c){return c.src.some(function(x){return x.s==="C";});});
  var spans=cs.map(function(c,i){ var x=c.src.filter(function(z){return z.s==="C";})[0]; return '<span class="span '+(w7hl===c.id?"hl":"")+'" data-id="'+c.id+'" style="left:'+(100*x.a/VIDEO_LEN)+'%;width:'+(100*(x.b-x.a)/VIDEO_LEN)+'%;top:'+(10+(i%3)*32)+'px">'+c.title+'</span>'; }).join("");
  var thumbs=SLIDES.map(function(s){ return '<span class="thumb" style="left:'+(100*s.t/VIDEO_LEN)+'%">'+mmss(s.t)+'<br>'+s.l+'</span>'; }).join("");
  var c=byId(w7hl), x=c.src.filter(function(z){return z.s==="C";})[0];
  var tr=TRANSCRIPT.map(function(t){ var on=t[0]>=x.a&&t[0]<=x.b; return '<div class="tr '+(on?"hl":"")+'"><span class="ts">'+mmss(t[0])+'</span><span>'+esc(t[1])+'</span></div>'; }).join("");
  st.innerHTML='<div class="toolbar"><b>Video C</b><span class="small">48:10 · 6 slide images · '+cs.length+' cards</span></div><div class="col" style="flex:none;padding:14px 20px 4px"><h5>Slides</h5><div class="thumbs">'+thumbs+'</div><h5>Cards</h5><div class="tl">'+spans+'</div><div class="axis"><span>0:00</span><span>12:00</span><span>24:00</span><span>36:00</span><span>48:10</span></div></div><div class="cols" style="grid-template-columns:1fr 1fr"><div class="col"><h5>Transcript</h5>'+tr+'</div><div class="col" id="w7d">'+detailHTML(c)+'</div></div>';
  st.querySelectorAll(".span").forEach(function(el){ el.addEventListener("click",function(){ w7hl=el.dataset.id; wVideo(st); }); });
  bindDetail(st.querySelector("#w7d"),c);
}

/* W10 */
function wBoard(st){
  var cols=["(no tag)"].concat(PTAGS);
  st.innerHTML='<div class="toolbar"><span class="small">Drag cards between columns. A card can also have several tags; this board shows its first one.</span></div><div class="kan">'+cols.map(function(t){
    var cs=CARDS.filter(function(c){ return t==="(no tag)"?!c.pt.length:c.pt[0]===t; });
    return '<div class="kcol" data-col="'+esc(t)+'"><h5><span>'+(t==="(no tag)"?t:"#"+esc(t))+'</span><span>'+cs.length+'</span></h5>'+cs.map(function(c){return '<div class="wcard" draggable="true" data-id="'+c.id+'" style="margin:0"><b class="t" style="font-size:.9rem">'+c.title+'</b><span class="m">'+c.bold+'</span></div>';}).join("")+'</div>';
  }).join("")+'</div>';
  st.querySelectorAll("[draggable]").forEach(function(el){ el.addEventListener("dragstart",function(e){ e.dataTransfer.setData("text/plain",el.dataset.id); }); });
  st.querySelectorAll(".kcol").forEach(function(col){
    col.addEventListener("dragover",function(e){ e.preventDefault(); col.classList.add("over"); });
    col.addEventListener("dragleave",function(){ col.classList.remove("over"); });
    col.addEventListener("drop",function(e){ e.preventDefault(); var c=byId(e.dataTransfer.getData("text/plain")); if(!c) return; var t=col.dataset.col; if(c.pt.length) c.pt.shift(); if(t!=="(no tag)" && c.pt.indexOf(t)<0) c.pt.unshift(t); refresh(); });
  });
}

/* W11 */
function wInbox(st){
  st.innerHTML='<div class="toolbar"><span class="small">'+SUGGEST.filter(function(s){return !s.status;}).length+' waiting · The model picked these while writing cards. Nothing changes until you decide.</span></div><div class="col" style="padding:18px;gap:10px">'+
   SUGGEST.map(function(s){ return '<div class="sugg '+(s.status?"done":"")+'"><input type="checkbox" data-s="'+s.id+'" aria-label="Select '+esc(s.path)+'" '+(s.status?"disabled":"")+'><div><div class="p">'+esc(s.path)+'</div><div class="small">'+esc(s.why)+' · for: '+s.cards.map(function(id){return byId(id).title;}).join(", ")+(s.status?' · <b>'+esc(s.status)+'</b>':'')+'</div></div><div class="btnrow">'+(s.status?'':'<button type="button" class="btn" data-acc="'+s.id+'">Accept</button><button type="button" class="btn" data-ren="'+s.id+'">Rename</button><button type="button" class="btn" data-rej="'+s.id+'">Reject</button>')+'</div></div>'; }).join("")+
   '<div class="sendbar"><span class="small">Combine the ticked tags into:</span><input class="inp" id="w11into" style="max-width:320px" value="ML › Interpretability › Features" aria-label="Combine into"><button type="button" class="btn primary" id="w11comb">Combine</button></div></div>';
  function set(id,v){ SUGGEST.forEach(function(s){ if(s.id===id) s.status=v; }); wInbox(st); }
  st.querySelectorAll("[data-acc]").forEach(function(b){ b.addEventListener("click",function(){ set(b.dataset.acc,"accepted"); toast("Tag added to your YAML and to its cards"); }); });
  st.querySelectorAll("[data-rej]").forEach(function(b){ b.addEventListener("click",function(){ set(b.dataset.rej,"rejected"); }); });
  st.querySelectorAll("[data-ren]").forEach(function(b){ b.addEventListener("click",function(){ var row=b.closest(".sugg"); var p=row.querySelector(".p"); var s=SUGGEST.filter(function(x){return x.id===b.dataset.ren;})[0];
    p.innerHTML='<input class="inp" value="'+esc(s.path)+'" aria-label="New name"> <button type="button" class="btn primary">Save</button>';
    p.querySelector("button").addEventListener("click",function(){ s.path=p.querySelector("input").value; set(s.id,"renamed + accepted"); }); }); });
  st.querySelector("#w11comb").addEventListener("click",function(){ var ids=[].map.call(st.querySelectorAll("[data-s]:checked"),function(i){return i.dataset.s;}); if(!ids.length){ toast("Tick at least one tag first"); return; } var into=st.querySelector("#w11into").value; ids.forEach(function(id){ SUGGEST.forEach(function(s){ if(s.id===id) s.status="combined into "+into; }); }); wInbox(st); });
}

/* W12 */
function wHealth(st){
  var rows=[
   ["Book A","pdf · 1,655 lines","312 / 312","ok","99.7% · 54 lines missing, in 3 gaps","warn","1 gap is 39 lines (L1561–1599), limit "+GAP_LIMIT,"ok","ok","3 merged · 1 split pending"],
   ["Blog B","blog · 140 lines","4 / 4","ok","98.6% · 2 lines missing","ok","","ok","ok","2 merged into Book A cards"],
   ["Video C","video · 48:10","11 / 11","ok","97.9% · 1 min missing","ok","","ok","ok","3 merged"],
   ["Book D","pdf · 520 lines","6 / 6 (1 retry)","ok","100%","ok","","ok","ok","'Attention residue' kept apart from 'Attention as lookup'"]
  ];
  function cls(v){ return v==="ok"?"ok":v==="warn"?"wn":"bad"; }
  st.innerHTML='<div class="toolbar"><b>Last ingest run</b><span class="small">GPU machine · 27 Sep 2026 03:10 · these checks run after every model call</span></div><div class="col" style="padding:18px;gap:14px"><div style="overflow-x:auto"><table class="chk"><thead><tr><th>Source</th><th>Size</th><th>JSON valid</th><th>Line coverage</th><th>Ranges in chunk</th><th>No overlaps</th><th>Merges</th></tr></thead><tbody>'+
   rows.map(function(r){ return '<tr><td><b>'+r[0]+'</b></td><td class="small">'+r[1]+'</td><td><span class="'+cls(r[3])+'">✓ '+r[2]+'</span></td><td><span class="'+cls(r[5])+'">'+(r[5]==="ok"?"✓ ":"⚠ ")+r[4]+'</span>'+(r[6]?'<div class="small">'+r[6]+'</div>':'')+'</td><td><span class="ok">✓</span></td><td><span class="'+(r[8]==="ok"?"ok":"wn")+'">'+(r[8]==="ok"?"✓":"✓ "+r[8])+'</span></td><td class="small">'+r[9]+'</td></tr>'; }).join("")+
   '</tbody></table></div><div class="excerpt"><b>What each check means</b><div class="small">JSON valid: the model answer matches the card schema. Line coverage: the cards together cover the chunk; at most '+GAP_LIMIT+' lines in a row may be missing. Ranges in chunk: every card\'s lines exist in the chunk it came from. No overlaps: two cards from one chunk do not share lines (the 20% chunk overlap is allowed). Failed chunks are retried, then listed here.</div></div><div class="btnrow"><button type="button" class="btn">Re-run chunk 9 of Book A</button><span class="small">(button shown for the flagged gap; runs on the GPU machine)</span></div></div>';
}
