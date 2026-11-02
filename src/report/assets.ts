// The report page's CSS and JS, inline in `index.html` so the folder is one page plus its images.
// Visual language: docs/plan/docs/live/overlay-ux.md §7 (paper and ink, zero radius, red has one job:
// a closer photo is needed). Light theme only; nothing is fetched from the network.

export const CSS = `
:root{--paper:#f2efe7;--card:#fcfbf6;--ink:#17140f;--ink-2:#574f44;--ink-3:#7d7466;--rule:rgba(23,20,15,.16);
--decision:#e2231a;--decision-ink:#b81a12;--live:#2f7d5b;--warn:#a8730f;--paused:#2f6b86;
--ev-derived:#2f6b86;--ev-asserted:#8a5a0b;--ev-synth:#6b5a8e;
--mono:ui-monospace,"JetBrains Mono",Menlo,monospace;--sans:"Helvetica Neue",Helvetica,Arial,sans-serif;color-scheme:light}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.45 var(--sans)}
a{color:inherit}
h1,h2,h3,h4{margin:0;font-weight:800;letter-spacing:-.01em}
h2{font-size:18px;border-top:3px solid var(--ink);padding-top:8px;margin:0 0 10px}
h3{font-size:17px}
h4{font:700 11px var(--mono);text-transform:uppercase;letter-spacing:.06em;color:var(--ink-2);margin:16px 0 6px}
.mono,.meta{font:12px var(--mono);color:var(--ink-2)}
.top{display:flex;flex-wrap:wrap;gap:8px 24px;align-items:baseline;justify-content:space-between;padding:14px 20px;border-bottom:3px solid var(--ink)}
.top h1{font-size:22px}
.counts{display:flex;gap:16px;flex-wrap:wrap;font:12px var(--mono);color:var(--ink-2)}
.counts b{color:var(--ink)}
.grid{display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:20px;padding:16px 20px;align-items:start}
@media(max-width:1000px){.grid{grid-template-columns:minmax(0,1fr)}}
.controls{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;margin-bottom:10px}
.chips{display:flex;flex-wrap:wrap;gap:0;border:1px solid var(--ink)}
.chip{font:12px var(--mono);background:var(--card);color:var(--ink);border:0;border-right:1px solid var(--ink);padding:5px 9px;cursor:pointer;display:inline-flex;gap:6px;align-items:center}
.chip:last-child{border-right:0}
.chip[aria-pressed=true]{background:var(--ink);color:var(--card)}
.chip svg{width:16px;height:12px;border:1px solid currentColor;background:var(--card);flex:none}
.key{display:flex;gap:12px;flex-wrap:wrap;font:11px var(--mono);color:var(--ink-2);align-items:center}
.key svg{width:34px;height:10px;vertical-align:middle;margin-right:4px}
.tabs{display:flex;gap:0;margin-bottom:8px}
.tab{font:12px var(--mono);border:1px solid var(--ink);background:var(--card);padding:4px 10px;margin-right:-1px;cursor:pointer}
.tab[aria-selected=true]{background:var(--ink);color:var(--card)}
html:not(.js) .tabs{display:none}
html.js .shot{display:none}
html.js .shot.on{display:block}
.shot{margin:0 0 16px}
.shot figcaption{font:11px var(--mono);color:var(--ink-2);margin-top:4px}
.frame{position:relative;border:1px solid var(--ink);background:#d9d4c7;line-height:0}
.frame img,.frame svg{display:block;width:100%;height:auto}
.frame svg.over{position:absolute;inset:0;height:100%}
.noimg{display:block;width:100%;background:repeating-linear-gradient(45deg,#d9d4c7,#d9d4c7 12px,#cfc9ba 12px,#cfc9ba 24px)}
.spine{cursor:pointer;outline:none}
.spine .edge{fill:none;stroke:var(--ink-3);vector-effect:non-scaling-stroke;stroke-linejoin:miter}
.spine .fill{stroke:none}
.spine .ring{display:none;fill:none;stroke:var(--ink);stroke-width:5px;vector-effect:non-scaling-stroke}
.spine.sel .ring{display:block}
.spine:focus-visible .ring{display:block;stroke-dasharray:none}
.spine .lbl{display:none;font:700 var(--lbl,24px) var(--mono);fill:var(--ink);paint-order:stroke;stroke:var(--card);stroke-width:var(--lblr,6px);text-anchor:middle}
.labels .spine .lbl,.spine.sel .lbl{display:block}
.st-resolved .edge{stroke:var(--live)}.st-unresolved .edge{stroke:var(--warn)}
.st-needs-pixels .edge{stroke:var(--decision);stroke-width:3.5px}.st-paused .edge{stroke:var(--paused)}
.st-none .edge{stroke:var(--ink-3)}
.bd-verified .edge{stroke-width:2.5px}
.bd-probable .edge{stroke-width:2px;stroke-dasharray:9 4}
.bd-candidate .edge{stroke-width:2px;stroke-dasharray:2 3}
.bd-unknown .edge{stroke-width:1.5px;stroke-dasharray:12 3 2 3}
.bd-none .edge{stroke-width:1px}
.st-needs-pixels.bd-unknown .edge,.st-needs-pixels.bd-none .edge{stroke-width:3.5px}
#stage .spine{transition:opacity .12s}
#stage[data-lens=resolved] .spine:not(.st-resolved),
#stage[data-lens=unresolved] .spine:not(.st-unresolved),
#stage[data-lens=needs-pixels] .spine:not(.st-needs-pixels),
#stage[data-lens=paused] .spine:not(.st-paused){opacity:.14}
#panels{position:sticky;top:12px;max-height:calc(100vh - 24px);overflow:auto;background:var(--card);border:1px solid var(--ink);padding:14px 16px}
@media(max-width:1000px){#panels{position:static;max-height:none}}
.panel{display:none}
html:not(.js) .panel:target,html.js .panel.open{display:block}
html.js #panels.has-open .hint{display:none}
html:not(.js) #panels:has(.panel:target) .hint{display:none}
.hint{color:var(--ink-2)}
.badges{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0}
.badge{font:11px var(--mono);border:1px solid currentColor;padding:1px 6px;white-space:nowrap}
.b-resolved{color:var(--live)}.b-unresolved{color:var(--warn)}.b-paused{color:var(--paused)}
.b-needs-pixels{background:var(--decision-ink);color:#fff;border-color:var(--decision-ink)}
.b-none{color:var(--ink-3)}
.ev-derived{color:var(--ev-derived)}.ev-asserted{color:var(--ev-asserted)}.ev-synth{color:var(--ev-synth)}
.panel p{margin:8px 0 0}
table{border-collapse:collapse;width:100%;font-size:12px}
th{font:700 10px var(--mono);text-transform:uppercase;letter-spacing:.05em;color:var(--ink-2);text-align:left;border-bottom:1px solid var(--ink);padding:3px 6px 3px 0}
td{border-bottom:1px solid var(--rule);padding:4px 6px 4px 0;vertical-align:top}
td.num,th.num{text-align:right;font-family:var(--mono)}
td.txt{font-family:var(--mono);word-break:break-word}
ul.ev{margin:0;padding:0;list-style:none;font:11px var(--mono);color:var(--ink-2)}
dl{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;margin:0;font-size:12px}
dt{font:11px var(--mono);color:var(--ink-2)}dd{margin:0;font-family:var(--mono);word-break:break-all}
ol.hist{margin:0;padding:0;list-style:none;font:12px var(--mono)}
ol.hist li{padding:3px 0;border-bottom:1px solid var(--rule)}
ol.hist .ts{color:var(--ink-3)}
.lists{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:24px;padding:8px 20px 28px}
.lists section{background:var(--card);border:1px solid var(--rule);padding:14px 16px}
tr.sel td{background:rgba(23,20,15,.07)}
.placeholder{color:var(--ink-2);border:1px dashed var(--ink-3);padding:12px}
.foot{padding:10px 20px 24px;font:11px var(--mono);color:var(--ink-3)}
.sr{position:absolute;left:-9999px}
`;

/** Selection, image tabs, the status lens and the label toggle. The page reads without it: panels open by `:target`. */
export const JS = `
(function(){
  var d=document,$=function(s,r){return(r||d).querySelector(s)},$$=function(s,r){return Array.prototype.slice.call((r||d).querySelectorAll(s))};
  var stage=$('#stage'),panels=$('#panels'),cur=null;
  function showImage(i){
    $$('.shot').forEach(function(f){f.classList.toggle('on',f.dataset.image===i)});
    $$('.tab').forEach(function(t){t.setAttribute('aria-selected',String(t.dataset.image===i))});
  }
  function select(id,fromUser){
    var panel=id&&d.getElementById('p-'+id);
    $$('.spine.sel,tr.sel').forEach(function(n){n.classList.remove('sel')});
    $$('.panel.open').forEach(function(n){n.classList.remove('open')});
    cur=panel?id:null;
    panels.classList.toggle('has-open',!!panel);
    if(!panel){history.replaceState(null,'',location.pathname);return}
    panel.classList.add('open');
    showImage(panel.dataset.image);
    $$('[data-obs="'+id+'"]').forEach(function(n){n.classList.add('sel')});
    history.replaceState(null,'','#p-'+id);
    if(fromUser==='list'){var s=d.getElementById('s-'+id);if(s&&s.scrollIntoView)s.scrollIntoView({block:'center',behavior:'smooth'})}
  }
  d.addEventListener('click',function(e){
    var a=e.target.closest&&e.target.closest('a[href^="#p-"]');
    if(a){e.preventDefault();select(a.getAttribute('href').slice(3),a.closest('svg')?'map':'list');return}
    var t=e.target.closest&&e.target.closest('.tab');if(t){showImage(t.dataset.image);return}
    var c=e.target.closest&&e.target.closest('.chip');
    if(c){$$('.chip').forEach(function(x){x.setAttribute('aria-pressed',String(x===c))});stage.dataset.lens=c.dataset.lens;return}
    if(e.target.closest&&e.target.closest('svg.over')&&!e.target.closest('.spine'))select(null);
  });
  var lb=$('#labels');if(lb)lb.addEventListener('change',function(){stage.classList.toggle('labels',lb.checked)});
  d.addEventListener('keydown',function(e){
    if(e.key==='Escape')return select(null);
    if(e.key!=='ArrowRight'&&e.key!=='ArrowLeft')return;
    var ids=$$('.spine').map(function(n){return n.dataset.obs});if(!ids.length)return;
    var i=cur?ids.indexOf(cur):-1;i=e.key==='ArrowRight'?Math.min(ids.length-1,i+1):Math.max(0,i-1);
    e.preventDefault();select(ids[i],'list');
  });
  var h=location.hash.match(/^#p-(.+)$/);
  if(h&&d.getElementById('p-'+h[1]))select(h[1],'list');else showImage(($('.tab')||{dataset:{}}).dataset.image);
})();
`;
