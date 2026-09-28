function readShare(cards){ if(!cards.length) return 0; var r=cards.filter(function(c){return c.state!=="new";}).length; return Math.round(100*r/cards.length); }
/* ---------------- v2: extra data ---------------- */
var SECT = {
  B:{c5:"1 · What a probe is",c3:"2 · From probes to autoencoders"},
  C:{c9:"Chapter 1 · Attention",c1:"Chapter 2 · Features",c3:"Chapter 2 · Features",c7:"Chapter 3 · Circuits"},
  D:{c10:"Part 1 · Habits",c11:"Part 2 · Focus",c12:"Part 2 · Focus"}
};
function sectionOf(c,s){ return s==="A" ? c.ch : ((SECT[s]||{})[c.id]||"Main"); }
function srcRange(c,s){ for(var i=0;i<c.src.length;i++) if(c.src[i].s===s) return c.src[i]; return null; }
function cardsOf(s){ return CARDS.filter(function(c){return !!srcRange(c,s);}).sort(function(a,b){return srcRange(a,s).a-srcRange(b,s).a;}); }
function snippetHTML(c){
  return c.src.map(function(x){ return '<div class="snip"><b>'+SOURCES[x.s].name+' · '+ref(x)+'</b>'+(TEXT[c.id]||[]).map(function(l,i){ return '<div><span>'+(SOURCES[x.s].kind==="video"?mmss(x.a+i*20):x.a+i)+'</span>'+esc(l)+'</div>'; }).join("")+'</div>'; }).join("");
}
function flagHTML(c){
  if(c.src.length<2) return "";
  return '<button type="button" class="flagbtn '+(c.flag?"on":"")+'" data-flag="'+c.id+'">'+(c.flag?"⚑ Marked as wrong merge · split on next ingest":"⚑ Mark: these are different ideas")+'</button>';
}
function tagDD(c){
  return '<div class="tagrow">'+c.pt.map(function(t){return '<span class="ptag">#'+esc(t)+'</span>';}).join("")+
   '<details class="tagdd"><summary>＋ tag ▾</summary><div class="ddpanel">'+PTAGS.map(function(t){ return '<label><input type="checkbox" data-pt="'+esc(t)+'" data-cid="'+c.id+'" '+(c.pt.indexOf(t)>-1?"checked":"")+'> #'+esc(t)+'</label>'; }).join("")+
   '<div class="row"><input class="inp" type="text" placeholder="new tag" aria-label="New tag" data-newfor="'+c.id+'"><button type="button" class="btn" data-addfor="'+c.id+'">Add</button></div><span class="small">Stays on this device.</span></div></details></div>';
}
/* one handler for tag dropdowns, flags and card actions anywhere on the page */
document.addEventListener("change",function(e){
  var t=e.target; if(!t.matches || !t.matches("input[data-pt]")) return;
  var c=byId(t.dataset.cid), tag=t.dataset.pt, i=c.pt.indexOf(tag);
  if(t.checked && i<0) c.pt.push(tag); if(!t.checked && i>-1) c.pt.splice(i,1);
  var row=t.closest(".tagrow"); row.querySelectorAll(".ptag").forEach(function(n){n.remove();});
  var sum=row.querySelector("details");
  c.pt.forEach(function(x){ var s=document.createElement("span"); s.className="ptag"; s.textContent="#"+x; row.insertBefore(s,sum); });
  refresh(row);
});
document.addEventListener("click",function(e){
  var b=e.target.closest && e.target.closest("button"); if(!b) return;
  if(b.dataset.addfor){ var c=byId(b.dataset.addfor), inp=b.parentElement.querySelector("input"), v=inp.value.trim().toLowerCase().replace(/^#/,"");
    if(!v) return; if(PTAGS.indexOf(v)<0) PTAGS.push(v); if(c.pt.indexOf(v)<0) c.pt.push(v); toast("Created #"+v); refresh(); return; }
  if(b.dataset.flag){ var f=byId(b.dataset.flag); f.flag=!f.flag; toast(f.flag?"Marked. The GPU machine splits it on the next ingest run.":"Mark removed"); refresh(); return; }
  if(b.dataset.act && b.dataset.cid){ var cc=byId(b.dataset.cid), a=b.dataset.act;
    if(a==="copy") copyCard(cc); if(a==="note") noteSheet(stage,cc); if(a==="known"){ cc.state=cc.state==="known"?"viewed":"known"; refresh(); } }
});
document.addEventListener("keydown",function(e){ if(e.key==="Enter" && e.target.dataset && e.target.dataset.newfor){ e.preventDefault(); var b=e.target.parentElement.querySelector("button"); b.click(); } });
/* close open dropdowns when clicking elsewhere */
document.addEventListener("click",function(e){ document.querySelectorAll("details.tagdd[open]").forEach(function(d){ if(!d.contains(e.target)) d.open=false; }); });

/* ---------------- sheets ---------------- */
function openSheet(screen, html, onMount){
  closeSheet(screen);
  var scrim=document.createElement("div"); scrim.className="scrim";
  var sh=document.createElement("div"); sh.className="sheet"; sh.innerHTML=html;
  scrim.addEventListener("click",function(){ closeSheet(screen); refresh(); });
  screen.appendChild(scrim); screen.appendChild(sh);
  if(onMount) onMount(sh);
}
function closeSheet(screen){ screen.querySelectorAll(".sheet,.scrim").forEach(function(n){n.remove();}); }
function noteSheet(screen,c){
  openSheet(screen,'<h4>Note · '+esc(c.title)+'</h4><textarea aria-label="Note">'+esc(c.note)+'</textarea><span class="small">Saved to <span class="mono">'+c.id+'.notes.md</span> (Markdown)</span><div class="row"><button type="button" class="btn primary" data-save>Save</button><button type="button" class="btn" data-close>Cancel</button></div>',function(sh){
    var ta=sh.querySelector("textarea"); setTimeout(function(){ta.focus();},30);
    sh.addEventListener("click",function(e){ var b=e.target.closest("button"); if(!b) return;
      if(b.hasAttribute("data-save")){ c.note=ta.value.trim(); closeSheet(screen); toast("Note saved"); refresh(); }
      if(b.hasAttribute("data-close")){ closeSheet(screen); refresh(); } });
  });
}
function tagSheet(screen,c){
  openSheet(screen,'<h4>My tags · '+esc(c.title)+'</h4>'+tagDD(c).replace('<details class="tagdd">','<details class="tagdd" open>')+'<button type="button" class="btn" data-close>Done</button>',function(sh){
    sh.addEventListener("click",function(e){ var b=e.target.closest("button"); if(b && b.hasAttribute("data-close")){ closeSheet(screen); refresh(); } });
  });
}

/* ---------------- swipe (horizontal) + tap ---------------- */
function attachSwipe(el, under, onRight, onLeft, onTap){
  var x0=0,y0=0,dx=0,mode=null,id=null;
  el.addEventListener("pointerdown",function(e){ if(e.target.closest("button,textarea,input,summary,label,details,select")) { mode=null; return; } x0=e.clientX; y0=e.clientY; dx=0; mode="?"; id=e.pointerId; });
  el.addEventListener("pointermove",function(e){
    if(mode===null||e.pointerId!==id) return;
    var mx=e.clientX-x0, my=e.clientY-y0;
    if(mode==="?"){ if(Math.abs(mx)>10 && Math.abs(mx)>Math.abs(my)){ mode="h"; try{el.setPointerCapture(id);}catch(_){} } else if(Math.abs(my)>10){ mode="v"; return; } else return; }
    if(mode!=="h") return;
    dx=mx; el.style.transform="translateX("+dx+"px) rotate("+(dx/45)+"deg)";
    if(under){ under.querySelector(".u-next").style.opacity=Math.max(0,Math.min(1,dx/90)); under.querySelector(".u-copy2").style.opacity=Math.max(0,Math.min(1,-dx/90)); }
  });
  el.addEventListener("pointerup",function(){
    if(mode==="h"){
      if(under) under.querySelectorAll("span").forEach(function(s){s.style.opacity=0;});
      if(dx>90){ el.style.transition="transform .18s"; el.style.transform="translateX(130%) rotate(8deg)"; setTimeout(onRight,180); }
      else { el.style.transition="transform .2s"; el.style.transform=""; setTimeout(function(){el.style.transition="";},220); if(dx<-90) onLeft(); }
    } else if(mode==="?" && onTap) onTap();
    mode=null;
  });
  el.addEventListener("pointercancel",function(){ el.style.transform=""; mode=null; });
}

/* ---------------- phones ---------------- */
var PHONES = [
 {id:"P1",name:"Feed",desc:"Drag → for the next card. Drag ← to copy for deep dive. Scroll inside the card to read deeper: why, how, when, additional info, then sources. Tap the card to write a note. Tags: the dropdown at the top.",hint:"‹ goes back. The menu at the top picks what to read: everything, one source, or one topic.",build:buildFeed},
 {id:"P2",name:"Books",desc:"All your sources in one list. Open one and switch between Book (the text as one long scroll, with images in place) and Cards (its cards in book order).",hint:"In Book, tap ● to jump to that card. In Cards, tap a card to open it in the Feed.",build:buildBooks},
 {id:"P3",name:"Tree",desc:"One tree, two ways: by topic (ML › Interpretability › Features) or by book (Book A › chapter 4). Each level shows how much you have read.",hint:"Green bar = viewed or explored.",build:buildTree},
 {id:"P7",name:"My shelf",desc:"Your own tags as shelves (#revisit, #important…), all your notes, and the copy prompt editor.",hint:"Nothing here is sent to the model.",build:buildShelf},
 {id:"P8",name:"Book outline",desc:"A book's table of contents where each line is a concept. Known ones are faded. Gaps show lines with no card.",hint:"'What is in this book?' in 10 seconds.",build:buildOutline}
];
var phonesEl=document.getElementById("phones");
phonesEl.innerHTML=PHONES.map(function(p){ return '<div class="pwrap" data-pick="'+p.id+'"><div class="phone"><div class="screen" id="scr-'+p.id+'"></div></div><b><span class="optid">'+p.id+'</span>'+p.name+'</b><div class="gesture">'+p.desc+'<span>'+p.hint+'</span></div></div>'; }).join("");
function status(right){ return '<div class="status"><span>9:41</span><span>'+(right||"")+'</span></div>'; }
function tabs(on){ return '<div class="tabs">'+["Feed","Books","Tree","Shelf"].map(function(t){return '<span class="'+(t===on?"on":"")+'">'+t+'</span>';}).join("")+'</div>'; }
function scopeOptions(cur){
  var o=[["all","Everything"]];
  Object.keys(SOURCES).forEach(function(s){ o.push(["src:"+s,SOURCES[s].name]); });
  leafTags().forEach(function(t){ o.push(["tag:"+t,"Topic: "+t]); });
  return o.map(function(x){return '<option value="'+esc(x[0])+'" '+(x[0]===cur?"selected":"")+'>'+esc(x[1])+'</option>';}).join("");
}
function scopedCards(scope){
  if(scope==="all"){ var r={new:0,viewed:1,explored:1,known:2}; return CARDS.slice().sort(function(a,b){return r[a.state]-r[b.state];}); }
  if(scope.indexOf("src:")===0) return cardsOf(scope.slice(4));
  var t=scope.slice(4); return CARDS.filter(function(c){return c.tag.split("/").pop()===t;});
}
function leafTags(){ var s={}; CARDS.forEach(function(c){ s[c.tag.split("/").pop()]=1; }); return Object.keys(s); }

/* P1 feed */
var p1scope="all", p1list=null, p1i=0, p1timer=null;
function buildFeed(scr){
  if(!p1list) p1list=scopedCards(p1scope).map(function(c){return c.id;});
  if(p1i>=p1list.length) p1i=0;
  var c=byId(p1list[p1i]);
  var body = c.state==="known"
    ? '<span class="small">Marked Known. Only the bold line is shown.</span>'
    : fieldsHTML(c,"sec")+(c.fig?figSVG():'')+
      (c.note?'<div class="notebtn has">✎ '+esc(c.note)+'</div>':'<div class="notebtn">✎ Tap the card to add a note</div>')+
      '<div class="scrollhint">↓ keep scrolling for the sources</div><div class="divider"></div><div class="sec"><span class="k">Sources</span></div>'+snippetHTML(c)+flagHTML(c);
  scr.innerHTML=status((p1i+1)+" / "+p1list.length)+
   '<div class="topbar"><button type="button" class="navbtn" id="p1back" aria-label="Previous card">‹</button><select id="p1scope" aria-label="What to read">'+scopeOptions(p1scope)+'</select><button type="button" class="navbtn" id="p1known">'+(c.state==="known"?"unknow":"known")+'</button></div>'+
   '<div class="hwrap"><div class="under"><span class="u-next">NEXT →</span><span class="u-copy2">← COPY</span></div><div class="fc" id="p1card">'+
   '<div class="fc-top"><span class="path">'+pathOf(c,1)+'</span>'+stateChips(c)+'</div>'+tagDD(c)+'<h3>'+c.title+'</h3><p class="boldline">'+c.bold+'</p>'+body+'</div></div>'+tabs("Feed");
  var card=scr.querySelector("#p1card");
  attachSwipe(card, scr.querySelector(".under"),
    function(){ p1i=(p1i+1)%p1list.length; buildFeed(scr); },
    function(){ copyCard(c); },
    function(){ noteSheet(scr,c); });
  scr.querySelector("#p1back").addEventListener("click",function(){ p1i=(p1i-1+p1list.length)%p1list.length; buildFeed(scr); });
  scr.querySelector("#p1known").addEventListener("click",function(){ c.state=c.state==="known"?"viewed":"known"; refresh(); });
  scr.querySelector("#p1scope").addEventListener("change",function(e){ p1scope=e.target.value; p1list=null; p1i=0; buildFeed(scr); });
  clearTimeout(p1timer);
  if(c.state==="new") p1timer=setTimeout(function(){ if(p1list[p1i]===c.id && c.state==="new"){ c.state="viewed"; toast("“"+c.title+"” is now Viewed (2 s on screen)"); refresh(); } },2000);
}
function openInFeed(scope,id){ p1scope=scope; p1list=scopedCards(scope).map(function(c){return c.id;}); p1i=Math.max(0,p1list.indexOf(id)); buildFeed(document.getElementById("scr-P1")); toast("Opened in the Feed (P1)"); }

/* P2 books */
var p2src=null, p2mode="book", p2hl=null;
function bookFeedHTML(s,withIds){
  var last="", out=[];
  cardsOf(s).forEach(function(c){
    var sec=sectionOf(c,s), r=srcRange(c,s);
    if(sec!==last){ out.push('<div class="h2">'+esc(sec)+'</div>'); last=sec; }
    if(SOURCES[s].kind==="video") SLIDES.forEach(function(sl){ if(sl.t>=r.a && sl.t<=r.b) out.push('<div class="inlinefig"><div class="slideimg">slide at '+mmss(sl.t)+' · '+sl.l+'</div></div>'); });
    var lead=SOURCES[s].kind==="video"?'<span class="ts">'+mmss(r.a)+'</span>':'';
    out.push('<p '+(withIds?'data-id="'+c.id+'"':'')+'>'+lead+(TEXT[c.id]||[]).join(" ")+' <button type="button" class="mk" data-mk="'+c.id+'">● '+c.title+'</button></p>');
    if(c.fig && s==="A") out.push('<div class="inlinefig">'+figSVG()+'</div>');
  });
  return out.join("");
}
function buildBooks(scr){
  if(!p2src){
    scr.innerHTML=status()+'<div class="topbar"><b>Books</b><span class="small">'+Object.keys(SOURCES).length+' sources</span></div><div class="plist">'+
     Object.keys(SOURCES).map(function(s){ var cs=cardsOf(s), rs=readShare(cs); return '<button type="button" class="row-i" data-s="'+s+'"><b>'+SOURCES[s].name+'</b><span class="m">'+SOURCES[s].full.split(" · ")[1]+'</span><span class="m">'+SOURCES[s].kind+' · '+cs.length+' cards · '+rs+'% read</span><div class="meter"><i style="width:'+rs+'%"></i></div></button>'; }).join("")+
     '<span class="small">New sources appear here after the GPU machine ingests them.</span></div>'+tabs("Books");
    scr.querySelectorAll("[data-s]").forEach(function(b){ b.addEventListener("click",function(){ p2src=b.dataset.s; p2mode="book"; buildBooks(scr); }); });
    return;
  }
  var s=p2src, inner;
  if(p2mode==="book") inner='<div class="bookfeed">'+bookFeedHTML(s,true)+'</div>';
  else inner='<div class="plist">'+cardsOf(s).map(function(c){ return c.state==="known" ? '<button type="button" class="row-i faded" data-open="'+c.id+'"><span class="m">Known · '+c.title+'</span></button>'
     : '<button type="button" class="row-i '+(p2hl===c.id?"hl":"")+'" data-open="'+c.id+'"><b>'+c.title+'</b><span>'+c.bold+'</span><span class="m">'+ref(srcRange(c,s))+(c.src.length>1?' · also in '+c.src.filter(function(x){return x.s!==s;}).map(function(x){return SOURCES[x.s].name;}).join(", "):'')+'</span>'+(c.state!=="new"?'<span class="m">'+(c.state==="explored"?"Deeply explored":"Read before")+'</span>':'')+'</button>'; }).join("")+'</div>';
  scr.innerHTML=status(SOURCES[s].name)+'<div class="topbar"><button type="button" class="navbtn" id="p2back">‹ Books</button><div class="seg" role="group" aria-label="Book or cards"><button type="button" data-m="book" aria-pressed="'+(p2mode==="book")+'">Book</button><button type="button" data-m="cards" aria-pressed="'+(p2mode==="cards")+'">Cards</button></div></div>'+inner+tabs("Books");
  scr.querySelector("#p2back").addEventListener("click",function(){ p2src=null; buildBooks(scr); });
  scr.querySelectorAll("[data-m]").forEach(function(b){ b.addEventListener("click",function(){ p2mode=b.dataset.m; buildBooks(scr); }); });
  scr.querySelectorAll("[data-mk]").forEach(function(b){ b.addEventListener("click",function(){ p2hl=b.dataset.mk; p2mode="cards"; buildBooks(scr); var t=scr.querySelector('[data-open="'+p2hl+'"]'); if(t) t.scrollIntoView({block:"center"}); }); });
  scr.querySelectorAll("[data-open]").forEach(function(b){ b.addEventListener("click",function(){ openInFeed("src:"+s,b.dataset.open); }); });
}

/* P3 tree: topics or books */
var p3kind="topics", p3path=[];
function topicTree(){ var root={kids:{},cards:[]}; CARDS.forEach(function(c){ var n=root; n.cards.push(c); c.tag.split("/").forEach(function(p){ n.kids[p]=n.kids[p]||{kids:{},cards:[]}; n=n.kids[p]; n.cards.push(c); }); }); return root; }
function bookTree(){ var root={kids:{},cards:[]}; Object.keys(SOURCES).forEach(function(s){ var bn={kids:{},cards:[]}; root.kids[SOURCES[s].name]=bn; cardsOf(s).forEach(function(c){ var sec=sectionOf(c,s); bn.kids[sec]=bn.kids[sec]||{kids:{},cards:[]}; bn.kids[sec].cards.push(c); bn.cards.push(c); root.cards.push(c); }); }); return root; }
function buildTree(scr){
  var root=p3kind==="topics"?topicTree():bookTree(), node=root;
  p3path.forEach(function(p){ node=node.kids[p]; });
  var kids=Object.keys(node.kids);
  var list = kids.length ? kids.map(function(k){ var n=node.kids[k], rs=readShare(n.cards); return '<button type="button" class="row-i" data-k="'+esc(k)+'"><b>'+esc(k)+' ›</b><span class="m">'+n.cards.length+' cards · '+rs+'% read</span><div class="meter"><i style="width:'+rs+'%"></i></div></button>'; }).join("")
     : node.cards.map(function(c){ return '<button type="button" class="row-i '+(c.state==="known"?"faded":"")+'" data-open="'+c.id+'"><b>'+c.title+'</b><span>'+c.bold+'</span>'+stateChips(c)+'</button>'; }).join("");
  scr.innerHTML=status()+'<div class="topbar"><b>Tree</b><div class="seg" role="group" aria-label="Tree kind"><button type="button" data-kind="topics" aria-pressed="'+(p3kind==="topics")+'">Topics</button><button type="button" data-kind="books" aria-pressed="'+(p3kind==="books")+'">Books</button></div></div><div class="crumbs"><button type="button" data-lvl="0">All</button>'+p3path.map(function(p,i){return ' › <button type="button" data-lvl="'+(i+1)+'">'+esc(p)+'</button>';}).join("")+'</div><div class="plist">'+list+'</div>'+tabs("Tree");
  scr.querySelectorAll("[data-kind]").forEach(function(b){ b.addEventListener("click",function(){ p3kind=b.dataset.kind; p3path=[]; buildTree(scr); }); });
  scr.querySelectorAll("[data-k]").forEach(function(b){ b.addEventListener("click",function(){ p3path.push(b.dataset.k); buildTree(scr); }); });
  scr.querySelectorAll("[data-lvl]").forEach(function(b){ b.addEventListener("click",function(){ p3path=p3path.slice(0,+b.dataset.lvl); buildTree(scr); }); });
  scr.querySelectorAll("[data-open]").forEach(function(b){ b.addEventListener("click",function(){ openInFeed("all",b.dataset.open); }); });
}

/* P7 shelf */
var p7open=null;
function buildShelf(scr){
  var inner;
  if(p7open){
    var cs=p7open==="__notes"?CARDS.filter(function(c){return c.note;}):CARDS.filter(function(c){return c.pt.indexOf(p7open)>-1;});
    inner='<div class="crumbs"><button type="button" data-back>Shelf</button> › '+(p7open==="__notes"?"My notes":"#"+esc(p7open))+'</div><div class="plist">'+(cs.length?cs.map(function(c){return '<button type="button" class="row-i" data-open="'+c.id+'"><b>'+c.title+'</b><span>'+c.bold+'</span>'+(c.note?'<span class="m">✎ '+esc(c.note)+'</span>':'')+'</button>';}).join(""):'<p class="small">Empty. Use the tag dropdown on a card in P1.</p>')+'</div>';
  } else {
    inner='<div class="plist">'+PTAGS.map(function(t){ var n=CARDS.filter(function(c){return c.pt.indexOf(t)>-1;}).length; return '<button type="button" class="row-i" data-t="'+esc(t)+'"><b>#'+esc(t)+'</b><span class="m">'+n+' card'+(n===1?"":"s")+'</span></button>'; }).join("")+
      '<button type="button" class="row-i" data-t="__notes"><b>✎ My notes</b><span class="m">'+CARDS.filter(function(c){return c.note;}).length+' notes</span></button>'+
      '<div class="row-i" style="cursor:default"><b>Copy prompt</b><span class="m">Used by swipe ←. Edit it here.</span><textarea class="inp" id="promptEdit" rows="4" aria-label="Copy prompt">'+esc(PROMPT)+'</textarea></div></div>';
  }
  scr.innerHTML=status()+'<div class="topbar"><b>My shelf</b><span class="small">device only</span></div>'+inner+tabs("Shelf");
  scr.querySelectorAll("[data-t]").forEach(function(b){ b.addEventListener("click",function(){ p7open=b.dataset.t; buildShelf(scr); }); });
  var back=scr.querySelector("[data-back]"); if(back) back.addEventListener("click",function(){ p7open=null; buildShelf(scr); });
  scr.querySelectorAll("[data-open]").forEach(function(b){ b.addEventListener("click",function(){ openInFeed("all",b.dataset.open); }); });
  var pe=scr.querySelector("#promptEdit"); if(pe) pe.addEventListener("change",function(){ PROMPT=pe.value; toast("Copy prompt saved"); });
}

/* P8 outline */
var p8src="A";
function buildOutline(scr){
  var cs=cardsOf(p8src), last="", html="";
  cs.forEach(function(c){
    var sec=sectionOf(c,p8src); if(sec!==last){ html+='<div class="gran t" style="margin-top:6px">'+esc(sec)+'</div>'; last=sec; }
    html+='<button type="button" class="row-i '+(c.state==="known"?"faded":"")+'" data-open="'+c.id+'" style="flex-direction:row;justify-content:space-between"><span>'+c.title+'</span>'+stateChips(c)+'</button>';
    var r=srcRange(c,p8src);
    (GAPS[p8src]||[]).forEach(function(g){ if(g[0]===r.b+1){ var n=g[1]-g[0]+1; html+='<div class="small" style="color:'+(n>GAP_LIMIT?"var(--rule-red)":"var(--muted)")+'">'+(n>GAP_LIMIT?"⚠ ":"")+n+' lines with no card (L'+g[0]+'–'+g[1]+')</div>'; } });
  });
  scr.innerHTML=status()+'<div class="topbar"><select id="p8src" aria-label="Source">'+Object.keys(SOURCES).map(function(s){return '<option value="'+s+'" '+(s===p8src?"selected":"")+'>'+SOURCES[s].name+'</option>';}).join("")+'</select><span class="small">'+cs.length+' concepts</span></div><div class="plist" style="gap:4px">'+html+'</div>'+tabs("Books");
  scr.querySelector("#p8src").addEventListener("change",function(e){ p8src=e.target.value; buildOutline(scr); });
  scr.querySelectorAll("[data-open]").forEach(function(b){ b.addEventListener("click",function(){ openInFeed("src:"+p8src,b.dataset.open); }); });
}

/* ---------------- web ---------------- */
var W = [
 {id:"W2",name:"Reader",url:"read/book-a",desc:"Contents | book | cards. The three panes scroll together: scroll any one and the others follow. Turn each pane on or off. Images sit where they are in the book. Pick a book, blog or video at the top.",build:wReader},
 {id:"W6",name:"Coverage strips",url:"coverage",desc:"Each source as a strip of lines. Blocks are cards, coloured by read-state. Red hatching = lines with no card (from the completeness check). Click a block to open its card.",build:wCoverage},
 {id:"W7",name:"Video timeline",url:"video/video-c",desc:"Slide images on a time axis, cards as spans, transcript below. Click a span to jump in the transcript.",build:wVideo},
 {id:"W9",name:"Focus mode",url:"focus",desc:"One big card with everything on it. Pick all, one source or one topic. ← previous, → next (buttons or arrow keys). C copy, T tags, N note.",build:wFocus},
 {id:"W10",name:"Tag board",url:"board",desc:"Your own tags as columns. Drag a card to another column to change its tag.",build:wBoard},
 {id:"W11",name:"Tag inbox",url:"tags/suggested",desc:"Topic tags the model suggested. Accept, rename, or tick several and combine them. Only then are they added to cards.",build:wInbox},
 {id:"W12",name:"Ingest report",url:"ingest",desc:"The checks from each ingest run: valid JSON, line coverage, ranges inside the chunk, no overlaps, merges and marked splits.",build:wHealth},
 {id:"W14",name:"Command palette",url:"search",desc:"Press Ctrl+K anywhere (or click the bar) to jump to any card, topic, book or #tag by typing.",build:wPalette}
];
var wCur="W2";
var tabsEl=document.getElementById("wtabs"), stage=document.getElementById("stage");
stage.style.position="relative";
tabsEl.innerHTML=W.map(function(v){return '<button type="button" role="tab" aria-selected="'+(v.id===wCur)+'" data-w="'+v.id+'"><span class="optid">'+v.id+'</span>'+v.name+'</button>';}).join("");
tabsEl.addEventListener("click",function(e){ var b=e.target.closest("[data-w]"); if(!b) return; wCur=b.dataset.w; tabsEl.querySelectorAll("[data-w]").forEach(function(x){x.setAttribute("aria-selected",String(x===b));}); stage.onkeydown=null; renderWeb(); });
function renderWeb(){ var v=W.filter(function(x){return x.id===wCur;})[0]; document.getElementById("wtitle").innerHTML='<span class="optid">'+v.id+'</span>'+v.name; document.getElementById("wdesc").textContent=v.desc; document.getElementById("wurl").textContent="localhost:5173 / "+v.url; v.build(stage); }
function canFocus(st){ var a=document.activeElement; return !a || a===document.body || st.contains(a); }
function wcardHTML(c,extra){
  return '<button type="button" class="wcard '+(extra||"")+' '+(c.state==="known"?"faded":"")+'" data-id="'+c.id+'"><span class="fc-top"><span class="path">'+pathOf(c,1)+'</span>'+stateChips(c)+'</span><b class="t">'+c.title+'</b><span class="bl">'+c.bold+'</span>'+srcChips(c)+ptagChips(c)+(c.note?'<span class="m">✎ '+esc(c.note)+'</span>':'')+'</button>';
}
function actsHTML(c){ return '<div class="acts"><button type="button" data-act="copy" data-cid="'+c.id+'">Copy for deep dive</button><button type="button" data-act="note" data-cid="'+c.id+'">'+(c.note?"Edit note":"Note")+'</button><button type="button" data-act="known" data-cid="'+c.id+'">'+(c.state==="known"?"Unmark Known":"I know this")+'</button></div>'; }
function detailHTML(c){
  return '<div class="fc-top"><span class="path">'+pathOf(c)+'</span>'+stateChips(c)+'</div>'+tagDD(c)+'<h3 style="font-family:var(--serif)">'+c.title+'</h3><p class="boldline">'+c.bold+'</p><div class="more">'+fieldsHTML(c,"")+'</div>'+(c.fig?figSVG():'')+snippetHTML(c)+(c.note?'<div class="mynote">✎ '+esc(c.note)+'</div>':'')+actsHTML(c)+flagHTML(c);
}
function bindDetail(){ /* actions use the page-wide handlers */ }

/* W2 reader */
var w2src="A", w2panes={toc:true,book:true,cards:true};
function wReader(st){
  var s=w2src, cs=cardsOf(s), video=SOURCES[s].kind==="video";
  var secs=[]; cs.forEach(function(c){ var sec=sectionOf(c,s); if(secs.indexOf(sec)<0) secs.push(sec); });
  var toc='<div class="toc2">'+secs.map(function(sec){ var first=cs.filter(function(c){return sectionOf(c,s)===sec;}); return '<button type="button" data-sec="'+esc(sec)+'" data-go="'+first[0].id+'">'+esc(sec)+'</button>'+first.map(function(c){return '<button type="button" class="sub" data-go="'+c.id+'" data-tocid="'+c.id+'">'+c.title+'</button>';}).join(""); }).join("")+'</div>';
  var last="", book=[];
  cs.forEach(function(c){ var sec=sectionOf(c,s), r=srcRange(c,s);
    if(sec!==last){ book.push('<div class="rh">'+esc(sec)+'</div>'); last=sec; }
    if(video) SLIDES.forEach(function(sl){ if(sl.t>=r.a && sl.t<=r.b) book.push('<div class="rfig"><div class="slideimg" style="height:120px">slide image at '+mmss(sl.t)+' · '+sl.l+'</div><span class="small">Frame taken from the video at '+mmss(sl.t)+'</span></div>'); });
    book.push('<div class="rpara" data-id="'+c.id+'"><span class="ln">'+ref(r)+' · '+c.title+'</span>'+(TEXT[c.id]||[]).join(" ")+'</div>');
    if(c.fig && s==="A") book.push('<div class="rfig">'+figSVG()+'</div>');
    (GAPS[s]||[]).forEach(function(g){ if(g[0]===r.b+1) book.push('<div class="rpara" style="color:var(--muted);font-style:italic;font-size:.85rem"><span class="ln">L'+g[0]+'–'+g[1]+'</span>'+(g[1]-g[0]+1)+' lines with no card</div>'); });
  });
  var cards=cs.map(function(c){ return '<div class="rcard '+(c.state==="known"?"faded":"")+'" data-id="'+c.id+'"><span class="fc-top"><span class="path">'+pathOf(c,1)+'</span>'+stateChips(c)+'</span>'+tagDD(c)+'<b class="t">'+c.title+'</b><span class="bl">'+c.bold+'</span>'+(c.state==="known"?'':fieldsHTML(c,"","span"))+(c.src.length>1?'<span class="small">also in '+c.src.filter(function(x){return x.s!==s;}).map(function(x){return SOURCES[x.s].name+' '+ref(x);}).join(", ")+'</span>':'')+(c.note?'<div class="mynote">✎ '+esc(c.note)+'</div>':'')+actsHTML(c)+flagHTML(c)+'</div>'; }).join("");
  var cols=[]; if(w2panes.toc) cols.push("210px"); if(w2panes.book) cols.push("1.35fr"); if(w2panes.cards) cols.push("1fr");
  st.innerHTML='<div class="toolbar">'+Object.keys(SOURCES).map(function(k){return '<button type="button" class="fchip" data-src="'+k+'" aria-pressed="'+(k===s)+'">'+SOURCES[k].name+' <span class="small">'+SOURCES[k].kind+'</span></button>';}).join("")+
   '<span class="toggles">'+[["toc","Contents"],["book",video?"Transcript":"Book"],["cards","Cards"]].map(function(p){return '<label><input type="checkbox" data-pane="'+p[0]+'" '+(w2panes[p[0]]?"checked":"")+'> '+p[1]+'</label>';}).join("")+'</span><span class="sync">⇅ panes scroll together</span></div>'+
   '<div class="cols" style="grid-template-columns:'+(cols.join(" ")||"1fr")+'">'+
   (w2panes.toc?'<div class="col" data-pane-el="toc"><h5>Contents · '+SOURCES[s].name+'</h5>'+toc+'</div>':'')+
   (w2panes.book?'<div class="col" data-pane-el="book"><h5>'+SOURCES[s].full+'</h5>'+book.join("")+'<div style="height:340px"></div></div>':'')+
   (w2panes.cards?'<div class="col" data-pane-el="cards" style="background:var(--ground)"><h5>Cards in '+(video?"video":"book")+' order</h5>'+cards+'<div style="height:340px"></div></div>':'')+
   (!cols.length?'<div class="col"><p class="small">Turn on at least one pane.</p></div>':'')+'</div>';
  st.querySelectorAll("[data-src]").forEach(function(b){ b.addEventListener("click",function(){ w2src=b.dataset.src; wReader(st); }); });
  st.querySelectorAll("[data-pane]").forEach(function(i){ i.addEventListener("change",function(){ w2panes[i.dataset.pane]=i.checked; wReader(st); }); });
  var panes={book:st.querySelector('[data-pane-el="book"]'),cards:st.querySelector('[data-pane-el="cards"]'),toc:st.querySelector('[data-pane-el="toc"]')};
  function topId(p){ var els=p.querySelectorAll("[data-id]"); for(var i=0;i<els.length;i++){ if(els[i].offsetTop+els[i].offsetHeight>p.scrollTop+30) return els[i].dataset.id; } return els.length?els[els.length-1].dataset.id:null; }
  function mark(id){
    st.querySelectorAll(".rpara.cur,.rcard.cur,.toc2 .cur").forEach(function(n){n.classList.remove("cur");});
    st.querySelectorAll('.rpara[data-id="'+id+'"],.rcard[data-id="'+id+'"],[data-tocid="'+id+'"]').forEach(function(n){n.classList.add("cur");});
    var c=byId(id); if(c && panes.toc){ var sb=panes.toc.querySelector('[data-sec="'+CSS.escape(sectionOf(c,s))+'"]'); if(sb) sb.classList.add("cur"); }
  }
  function goTo(id,except){
    ["book","cards","toc"].forEach(function(k){ var p=panes[k]; if(!p || p===except) return;
      var t=k==="toc"?p.querySelector('[data-tocid="'+id+'"]'):p.querySelector('[data-id="'+id+'"]'); if(!t) return;
      p._lock=Date.now(); p.scrollTop=Math.max(0,t.offsetTop-(k==="toc"?80:30)); });
    mark(id);
  }
  ["book","cards"].forEach(function(k){ var p=panes[k]; if(!p) return;
    p.addEventListener("scroll",function(){ if(Date.now()-(p._lock||0)<150) return; var id=topId(p); if(id) goTo(id,p); }); });
  st.querySelectorAll("[data-go]").forEach(function(b){ b.addEventListener("click",function(){ goTo(b.dataset.go,null); }); });
  st.querySelectorAll(".rpara[data-id]").forEach(function(el){ el.addEventListener("click",function(){ goTo(el.dataset.id,null); }); });
  if(cs.length) mark(cs[0].id);
}

/* W9 focus */
var w9scope="all", w9i=0;
function wFocus(st){
  var cs=scopedCards(w9scope); if(w9i>=cs.length) w9i=0; var c=cs[w9i];
  st.innerHTML='<div class="toolbar"><label class="small" for="w9scope">Read</label><select id="w9scope">'+scopeOptions(w9scope)+'</select><span class="small">'+(w9i+1)+' / '+cs.length+'</span></div>'+
   '<div class="col" style="background:var(--ground);gap:14px;padding:20px"><div class="focusnav"><button type="button" id="w9prev" aria-label="Previous card">←</button><span class="small">← previous · next →</span><button type="button" id="w9next" aria-label="Next card">→</button></div>'+
   '<div class="bigcard"><div class="fc-top"><span class="path">'+pathOf(c)+'</span>'+stateChips(c)+'</div>'+tagDD(c)+'<h3>'+c.title+'</h3><p class="boldline">'+c.bold+'</p>'+
   fieldsHTML(c,"sec")+(c.fig?figSVG():'')+
   (c.note?'<div class="mynote">✎ '+esc(c.note)+'</div>':'')+'<div class="sec"><span class="k">Sources</span></div>'+snippetHTML(c)+actsHTML(c)+flagHTML(c)+'</div>'+
   '<div class="keys"><span><kbd>←</kbd>/<kbd>→</kbd> previous / next</span><span><kbd>C</kbd> copy</span><span><kbd>T</kbd> my tags</span><span><kbd>N</kbd> note</span></div></div>';
  function go(d){ if(d>0 && c.state==="new") c.state="viewed"; w9i=(w9i+d+cs.length)%cs.length; refresh(); }
  st.querySelector("#w9prev").addEventListener("click",function(){ go(-1); });
  st.querySelector("#w9next").addEventListener("click",function(){ go(1); });
  st.querySelector("#w9scope").addEventListener("change",function(e){ w9scope=e.target.value; w9i=0; wFocus(st); });
  st.onkeydown=function(e){ if(wCur!=="W9"||e.target.closest("input,textarea,select")) return; var k=e.key;
    if(k==="ArrowRight") go(1); else if(k==="ArrowLeft") go(-1);
    else if(k.toLowerCase()==="c") copyCard(c); else if(k.toLowerCase()==="t") tagSheet(stage,c); else if(k.toLowerCase()==="n") noteSheet(stage,c); else return;
    e.preventDefault(); };
  if(canFocus(st)) st.focus({preventScroll:true});
}

/* W14 palette */
var w14open=true, w14q="", w14i=0;
function wPalette(st){
  var items=CARDS.map(function(c){return {k:"card",l:c.title,s:pathOf(c,1)};}).concat(leafTags().map(function(t){return {k:"topic",l:t,s:"topic"};})).concat(Object.keys(SOURCES).map(function(s){return {k:"book",l:SOURCES[s].full,s:SOURCES[s].kind};})).concat(PTAGS.map(function(t){return {k:"my tag",l:"#"+t,s:"my tag"};}));
  var f=items.filter(function(it){ return !w14q || (it.l+" "+it.s).toLowerCase().indexOf(w14q.toLowerCase())>-1; }).slice(0,9);
  if(w14i>=f.length) w14i=0;
  st.innerHTML='<div class="toolbar"><button type="button" class="btn" id="w14btn">Search… <kbd>Ctrl</kbd>+<kbd>K</kbd></button><span class="small">The palette opens on top of any view.</span></div><div class="masonry" style="opacity:.3;pointer-events:none">'+CARDS.slice(0,8).map(function(c){return wcardHTML(c);}).join("")+'</div>'+
   (w14open?'<div class="pal"><div class="pal-box"><input id="w14q" placeholder="Type a card, topic, book or #tag…" aria-label="Search everything" value="'+esc(w14q)+'"><div class="pal-list">'+f.map(function(it,i){return '<div class="pal-item '+(i===w14i?"on":"")+'" data-i="'+i+'"><span>'+esc(it.l)+'</span><span class="small">'+it.k+' · '+esc(it.s)+'</span></div>';}).join("")+'</div></div></div>':'');
  st.querySelector("#w14btn").addEventListener("click",function(){ w14open=true; wPalette(st); });
  var q=st.querySelector("#w14q");
  if(q){ if(canFocus(st)){ q.focus({preventScroll:true}); q.setSelectionRange(q.value.length,q.value.length); }
    q.addEventListener("input",function(){ w14q=q.value; w14i=0; wPalette(st); });
    q.addEventListener("keydown",function(e){ if(e.key==="ArrowDown"){ w14i=Math.min(f.length-1,w14i+1); wPalette(st); e.preventDefault(); } if(e.key==="ArrowUp"){ w14i=Math.max(0,w14i-1); wPalette(st); e.preventDefault(); } if(e.key==="Escape"){ w14open=false; wPalette(st); } if(e.key==="Enter"&&f[w14i]){ toast("Open "+f[w14i].k+": "+f[w14i].l); w14open=false; wPalette(st); } });
    st.querySelector(".pal").addEventListener("click",function(e){ if(e.target.classList.contains("pal")){ w14open=false; wPalette(st); return; } var it=e.target.closest(".pal-item"); if(it){ toast("Open "+f[+it.dataset.i].k+": "+f[+it.dataset.i].l); w14open=false; wPalette(st); } }); }
  st.onkeydown=function(e){ if(wCur==="W14" && (e.ctrlKey||e.metaKey) && e.key.toLowerCase()==="k"){ e.preventDefault(); w14open=true; wPalette(st); } };
}
