/* ---------------- example data ---------------- */
var SOURCES = {
  A:{name:"Book A", full:"Book A · Interpretability Notes (example PDF)", kind:"pdf"},
  B:{name:"Blog B", full:"Blog B · A post about probes (example)", kind:"blog"},
  C:{name:"Video C", full:"Video C · Talk: looking inside LLMs (example, 48:10)", kind:"video"},
  D:{name:"Book D", full:"Book D · Focus and Habits (example PDF)", kind:"pdf"}
};
var CARDS = [
 {id:"c5",how:"Save the activations for many inputs. Fit logistic regression from activations to the label. Compare accuracy across layers.",title:"Linear probe",tag:"ML/Interpretability/Probing",bold:"Train a tiny linear model on hidden activations to test if some information is inside them.",why:"You cannot read activations by eye. You need a test that says 'yes, this layer knows the word is a verb'.",when:"When you ask what a layer knows.",extraLike:"Logistic regression, but the inputs are a network's hidden numbers.",src:[{s:"A",a:905,b:960},{s:"B",a:12,b:60}],state:"known",pt:[],note:"why not MLP probes?",ch:"3 · Probing"},
 {id:"c6",how:"Compare against a control task, or follow up with a causal test such as activation patching.",title:"Probe accuracy trap",tag:"ML/Interpretability/Probing",bold:"A probe that scores high does not prove the model uses that information.",why:"People claimed 'the model uses X' from probe scores alone. That was often wrong.",when:"Before you trust any probe result.",extraLike:"Correlation is not causation.",src:[{s:"A",a:961,b:1195}],state:"viewed",pt:[],note:"",ch:"3 · Probing"},
 {id:"c1",how:"Each feature is a direction. Sparse features rarely fire together, so their directions can overlap a little without much harm.",title:"Superposition",tag:"ML/Interpretability/Features",bold:"A network stores more ideas than it has neurons, by packing them at almost-right angles.",why:"Single neurons are confusing. One neuron fires for cats, cars and French text.",when:"Any time you look inside a model.",extraLike:"PCA, but with more directions than dimensions.",src:[{s:"A",a:1201,b:1219},{s:"C",a:750,b:910}],state:"new",pt:[],note:"",fig:true,ch:"4 · Features"},
 {id:"c2",how:"",extra:"Opposite: a monosemantic neuron, which means one thing.",title:"Polysemantic neuron",tag:"ML/Interpretability/Features",bold:"One neuron takes part in many unrelated ideas.",why:"It explains why 'what does neuron 42 do?' has no clean answer.",when:"When a neuron's top examples look random.",extraLike:"One word with many meanings, like 'bank'.",src:[{s:"A",a:1220,b:1238}],state:"new",pt:[],note:"",ch:"4 · Features"},
 {id:"c3",how:"Train a wide autoencoder on the activations with an L1 penalty, so only a few units fire for each input.",extra:"Also called dictionary learning. The autoencoder's units are often called 'features'.",title:"Sparse autoencoder",tag:"ML/Interpretability/Features",bold:"A small network that pulls the packed ideas apart, so each unit means one thing.",why:"Superposition hides features. We need a tool to un-mix them.",when:"When you want a list of the features a layer uses.",extraLike:"Un-mixing voices in a noisy room.",src:[{s:"A",a:1239,b:1342},{s:"B",a:88,b:131},{s:"C",a:1082,b:1480}],state:"viewed",updated:true,pt:["revisit"],note:"",ch:"4 · Features"},
 {id:"c4",how:"Count how often each unit fires during training. Re-start the units that never fire.",title:"Dead features",tag:"ML/Interpretability/Features",bold:"Some autoencoder units never turn on, so they waste space.",why:"They make the feature list look bigger than it is.",when:"When you train your own sparse autoencoder.",extraLike:"",src:[{s:"A",a:1343,b:1370}],state:"new",pt:[],note:"",ch:"4 · Features"},
 {id:"c14",how:"Trace which heads and neurons pass information to each other, then test the path by patching.",title:"Circuit",tag:"ML/Interpretability/Circuits",bold:"A small group of connected parts inside the model that does one job together.",why:"Features tell you what is stored. Circuits tell you how it is used.",when:"When you ask how the model computes an answer.",extraLike:"A sub-routine in a program.",src:[{s:"A",a:1381,b:1501}],state:"new",pt:[],note:"",ch:"5 · Circuits"},
 {id:"c7",how:"Head 1 marks each token with the token before it. Head 2 looks for a match and copies the next token.",title:"Induction head",tag:"ML/Interpretability/Circuits",bold:"Two attention heads that work together to copy what came after the last time a token appeared.",why:"It is the first circuit found that explains in-context learning.",when:"When a model repeats patterns from its prompt.",extraLike:"Your phone's autocomplete, remembering what you typed before.",src:[{s:"A",a:1502,b:1560},{s:"C",a:1864,b:2180}],state:"explored",pt:["important"],note:"Compare with copying heads in small models.",ch:"5 · Circuits"},
 {id:"c8",how:"Run a clean input and a broken input. Copy one activation from clean to broken. If the output recovers, that part matters.",title:"Activation patching",tag:"ML/Interpretability/Circuits",bold:"Swap one part of the network's activations and see what breaks.",why:"It tests cause, not just correlation. It fixes the probe trap.",when:"When you want proof that a part matters.",extraLike:"Pulling one wire to find which one powers the lamp.",src:[{s:"A",a:1600,b:1655}],state:"new",pt:[],note:"",ch:"5 · Circuits"},
 {id:"c9",how:"Query · keys → scores → softmax → weights → weighted sum of values.",title:"Attention as lookup",tag:"ML/Transformers/Attention",bold:"Attention is a soft dictionary lookup: a query finds matching keys and takes their values.",why:"It makes the formula easy to remember and reason about.",when:"Whenever you read transformer code.",extraLike:"A Python dict where every key matches a little.",src:[{s:"C",a:130,b:390}],state:"known",pt:[],note:""},
 {id:"c10",how:"Write down the cue and the reward. Keep them, and swap in a new routine.",title:"Habit loop",tag:"Mind/Habits/Routines",bold:"A habit is a cue, then a routine, then a reward. Change the routine, keep the cue.",why:"Willpower alone fails. Changing the loop works better.",when:"When you want to stop or start a habit.",extraLike:"",src:[{s:"D",a:220,b:260}],state:"new",pt:[],note:""},
 {id:"c11",how:"Block 90 minutes in the calendar. Turn off messages. Do one task only.",title:"Deep focus blocks",tag:"Mind/Focus/Deep work",bold:"Plan long blocks with no switching. Hard thinking needs 60–90 minutes to warm up.",why:"Short gaps between meetings are too short for hard work.",when:"When you plan a study or coding day.",extraLike:"",src:[{s:"D",a:410,b:470}],state:"new",pt:["important"],note:""},
 {id:"c12",how:"",title:"Attention residue",tag:"Mind/Focus/Deep work",bold:"After you switch tasks, part of your mind stays on the old task for a while.",why:"It explains why checking messages ruins focus even when it is quick.",when:"When you decide whether to check your phone.",extraLike:"Not the same as attention in transformers. The merge step kept them apart.",src:[{s:"D",a:471,b:500}],state:"viewed",pt:[],note:""}
];
var PTAGS = ["revisit","important","confusing","read later"];
var SUGGEST = [
 {id:"s1",path:"ML › Interpretability › Dictionary learning",cards:["c3","c4"],why:"Two cards are about learning a feature dictionary.",status:""},
 {id:"s2",path:"ML › Interp › Features",cards:["c1"],why:"Close to your tag 'ML › Interpretability › Features'.",status:""},
 {id:"s3",path:"ML › Interpretability › Causal methods",cards:["c8"],why:"Patching is a causal test.",status:""},
 {id:"s4",path:"Mind › Attention",cards:["c12"],why:"About human attention.",status:""}
];
var PROMPT = "You are my tutor. I know the card below at a basic level. Go deeper using the source text. Use simple words. End with one question to check I understood.";
var TEXT = {
 c5:["A probe is a small linear classifier trained on activations.","If it predicts the label well, the information is present.","We train one probe per layer and compare the scores."],
 c6:["High probe accuracy does not mean the model uses the feature.","The probe may learn the task by itself from rich activations.","We need a causal test as well."],
 c1:["A layer with n neurons can still hold more than n features,","if each feature is sparse. Each feature is a direction","in activation space, not a single neuron. (see Figure 3)"],
 c2:["Because directions overlap, one neuron takes part in many features.","Its top examples then look like a mix of unrelated things."],
 c3:["To pull the features apart, train a sparse autoencoder","on the activations. Its hidden layer is wider than the input","and an L1 penalty keeps most units off."],
 c4:["Some units in the autoencoder never activate.","We call them dead features and resample them during training."],
 c14:["A circuit is a subgraph of the model: a few heads and neurons","connected by weights, that together compute one behaviour."],
 c7:["An induction head looks back for the previous copy of the current token","and attends to the token after it, then copies it forward."],
 c8:["Run the model on a clean and a corrupted input.","Copy one activation from the clean run into the corrupted run.","If the output recovers, that activation matters."],
 c9:["Think of attention as a soft lookup table.","Each query compares itself with every key.","The output is a weighted mix of the values."],
 c10:["Every habit has three parts: a cue, a routine and a reward.","To change a habit, keep the cue and the reward, and swap the routine."],
 c11:["Hard work needs long, unbroken time.","Plan blocks of 90 minutes and protect them."],
 c12:["When you switch from task A to task B, some attention stays on A.","This residue lowers your performance on B."]
};
var GAPS = {A:[[1196,1200],[1371,1380],[1561,1599]]};
var GAP_LIMIT = 20;
var SLIDES = [{t:130,l:"QKV"},{t:750,l:"features"},{t:1082,l:"SAE"},{t:1480,l:"results"},{t:1864,l:"induction"},{t:2400,l:"Q&A"}];
var VIDEO_LEN = 2890;
var TRANSCRIPT = [[130,"So, attention. Think of it as a lookup table."],[390,"Now let's move to what is inside the layers."],[750,"Here is the big idea: more features than neurons."],[910,"This is called superposition."],[1082,"How do we get them out? Sparse autoencoders."],[1480,"And the results look very clean."],[1864,"Now circuits. The famous one is the induction head."],[2180,"It explains a lot of in-context learning."],[2400,"Let's take questions."]];

/* ---------------- helpers ---------------- */
function byId(id){ for (var i=0;i<CARDS.length;i++) if (CARDS[i].id===id) return CARDS[i]; return null; }
function esc(s){ return String(s).replace(/[&<>"']/g,function(ch){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch];}); }
function mmss(t){ var m=Math.floor(t/60), s=t%60; return m+":"+(s<10?"0":"")+s; }
function ref(x){ return SOURCES[x.s].kind==="video" ? mmss(x.a)+"–"+mmss(x.b) : "L"+x.a+"–"+x.b; }
function srcChips(c){ return '<div class="srcs">'+c.src.map(function(x){return '<span class="src">'+SOURCES[x.s].name+' · '+ref(x)+'</span>';}).join("")+'</div>'; }
function stateChips(c){
  var lbl={new:"New",viewed:"Viewed",explored:"Explored",known:"Known"}[c.state];
  return '<span class="chips">'+(c.updated?'<span class="st updated">Updated</span>':'')+'<span class="st '+c.state+'">'+lbl+'</span></span>';
}
function ptagChips(c){ return c.pt.length ? '<div class="ptags">'+c.pt.map(function(t){return '<span class="ptag">#'+esc(t)+'</span>';}).join("")+'</div>' : ''; }
function pathOf(c,from){ return c.tag.split("/").slice(from||0).join(" › "); }
var toastEl=document.getElementById("toast"), toastT;
function toast(msg){ toastEl.textContent=msg; toastEl.hidden=false; clearTimeout(toastT); toastT=setTimeout(function(){toastEl.hidden=true;},2200); }
function promptText(c){
  var out=[PROMPT,"","## Card: "+c.title,"What: "+c.bold];
  [["Why","why"],["How","how"],["When","when"],["Additional info","extra"]].forEach(function(f){ if(c[f[1]]) out.push(f[0]+": "+c[f[1]]); });
  out.push("","## Sources");
  c.src.forEach(function(x){ out.push("["+SOURCES[x.s].full+", "+ref(x)+"]"); (TEXT[c.id]||[]).forEach(function(l){out.push(l);}); out.push(""); });
  return out.join("\n");
}
function copyCard(c){
  var t=promptText(c);
  if(c.state!=="known") c.state="explored";
  c.updated=false;
  function done(ok){ toast(ok?"Copied: prompt + card + "+c.src.length+" source(s). Paste it into your chat.":"Copy is blocked here. The app would copy the prompt, the card and the source lines."); refresh(); }
  try{ navigator.clipboard.writeText(t).then(function(){done(true);},function(){done(false);}); }catch(e){ done(false); }
}
function figSVG(){ return '<div class="fig2"><svg viewBox="0 0 100 60" aria-hidden="true"><line x1="50" y1="55" x2="50" y2="8" stroke="currentColor"/><line x1="50" y1="55" x2="92" y2="30" stroke="currentColor"/><line x1="50" y1="55" x2="10" y2="28" stroke="currentColor"/><line x1="50" y1="55" x2="80" y2="10" stroke="currentColor" stroke-dasharray="3 2"/><line x1="50" y1="55" x2="20" y2="10" stroke="currentColor" stroke-dasharray="3 2"/></svg></div><span class="small">Figure 3 · Book A (5 features in 2 dimensions)</span>'; }


/* merge the old "Like" text into Additional info */
CARDS.forEach(function(c){ if(c.extraLike){ c.extra = c.extra ? c.extra+" "+c.extraLike : c.extraLike; } delete c.extraLike; });
function fieldsHTML(c,cls,tag){
  tag=tag||"div";
  return [["Why","why"],["How","how"],["When","when"],["Additional info","extra"]].filter(function(f){return c[f[1]];}).map(function(f){ return '<'+tag+(cls?' class="'+cls+'"':'')+'><span class="k">'+f[0]+'</span>'+c[f[1]]+'</'+tag+'>'; }).join("");
}
