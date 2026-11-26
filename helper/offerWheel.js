'use strict';
/**
 * offerWheel.js — the app's Welcome-screen cycle wheel, for the offer page.
 * Port of fit_her-main/lib/UI/auth_module/walt_through/animated_cycle_wheel.dart
 * (and the splash hand-off from splash.dart):
 *   - the ring in the four phase colours, blended at the edges
 *   - phase labels on the ring; the one the dot is in grows
 *   - a slow dot round the ring (50 s a turn) with a soft glow
 *   - the centre folds every 3.2 s: 28 Days → Movement → Nutrition → Hormones
 *     (tap the wheel to skip ahead)
 *   - intro: logo + 4 splash dots → dots fly to their phases and draw the
 *     ring → centre folds through the words → fades into the page.
 *     Skip button / tap anywhere; once per visit; off with reduced motion.
 *
 *   wheelCss          styles (intro overlay + wheel)
 *   introHtml(logo)   the opening overlay
 *   wheelScript       the code (no libraries)
 */

const wheelCss = `
html.intro-on{overflow:hidden}
html.intro-on .rise,html.intro-on .logo,html.intro-on .cycle i,html.intro-on .bub{animation-play-state:paused}
.intro{position:fixed;inset:0;z-index:100;background:#fff;display:grid;place-items:center;overflow:hidden;transition:opacity .3s ease}
.intro.out{opacity:0}
.intro{animation:introSafety .3s 4s forwards}
@keyframes introSafety{to{opacity:0;visibility:hidden}}
html.no-intro .intro{display:none}
.intro .ib{position:absolute;border-radius:50%;background:rgba(200,232,192,.6);animation:bubIn .6s cubic-bezier(.34,1.56,.64,1) both,float 2.2s .6s ease-in-out infinite alternate}
.intro .ib1{width:280px;height:280px;top:-100px;right:-80px}
.intro .ib2{width:190px;height:190px;bottom:-55px;left:-55px;background:rgba(200,232,192,.5)}
.intro .stage{position:relative;display:grid;justify-items:center;gap:18px}
.intro .ilogo{height:34px;width:auto;animation:logoIn .7s .1s both;transition:transform .55s cubic-bezier(.2,.7,.3,1)}
.intro .itag{font-size:14px;color:#5A7A56;opacity:0;transition:opacity .5s}
.intro .itag.on{opacity:1}
.intro .skip{position:absolute;right:16px;bottom:calc(16px + env(safe-area-inset-bottom));border:0;background:#E8F4E0;color:#163220;font:600 14px Poppins,system-ui,sans-serif;padding:10px 18px;border-radius:999px;cursor:pointer;min-height:44px}
.wheel{position:relative;margin:0 auto;touch-action:manipulation;cursor:pointer;-webkit-tap-highlight-color:transparent}
.wheel canvas{position:absolute;inset:0;width:100%;height:100%}
.wheel .disc{position:absolute;left:50%;top:50%;border-radius:50%;background:#F6FBF3;box-shadow:0 12px 24px rgba(22,50,32,.08);display:grid;place-items:center;overflow:hidden;transform:translate(-50%,-50%);perspective:600px}
.wheel .face{display:grid;justify-items:center;text-align:center;padding:0 10%;backface-visibility:hidden}
.wheel .em{line-height:1}
.wheel .big{font-family:Fraunces,Georgia,serif;font-weight:300;color:#163220;line-height:1}
.wheel .cap{font-weight:600;color:#2E4A33;line-height:1.35;margin-top:.5em}
.wheel .cap.num{font-weight:700;letter-spacing:.14em}
.wheel .tri{display:block;font-family:Fraunces,Georgia,serif;font-weight:300;color:#163220;line-height:1.18;opacity:0;transform:translateY(8px);transition:opacity .28s ease,transform .28s cubic-bezier(.2,.7,.3,1)}
.wheel .tri.on{opacity:1;transform:none}
.wheel .lab{position:absolute;left:50%;top:50%;background:#fff;border-radius:999px;font-weight:700;letter-spacing:.12em;box-shadow:0 4px 12px rgba(0,0,0,.06);white-space:nowrap;transition:transform .5s cubic-bezier(.34,1.56,.64,1),box-shadow .5s,opacity .3s}
.wheel .lab.on{box-shadow:0 4px 16px rgba(0,0,0,.12)}
`;

function introHtml(logoOnLight) {
  return `<div class="intro" id="intro" aria-hidden="true">
  <span class="ib ib1"></span><span class="ib ib2"></span>
  <div class="stage">
    <img class="ilogo" id="ilogo" src="${logoOnLight}" alt="" width="231" height="34">
    <div class="wheel" id="introWheel"></div>
    <p class="itag" id="itag">Built around every phase of you</p>
  </div>
  <button class="skip" id="skip" type="button">Skip</button>
</div>`;
}


// Runs in the browser. Kept as a string; no data from the request goes in it.
const wheelScript = `
(function(){
  var PH=[{l:'MENSTRUAL',s:0,e:5,c:'#FF8A8A',t:'#A93F3A'},{l:'FOLLICULAR',s:5,e:13,c:'#6DC55A',t:'#2F7A24'},{l:'OVULATION',s:13,e:14,c:'#5ECFB0',t:'#1F7564'},{l:'LUTEAL',s:14,e:28,c:'#FAC775',t:'#8F5F0E'}];
  var LAB=[[32,.47],[116,.47],[174,.54],[270,.46]];
  var SL=[{b:'28',c:'DAYS \\u00B7 YOUR CYCLE',n:1},{e:'\\uD83C\\uDFC3\\u200D\\u2640\\uFE0F',b:'Movement',c:'Workouts that match your energy'},{e:'\\uD83E\\uDD57',b:'Nutrition',c:'Meals that match your phase'},{e:'\\uD83C\\uDF38',b:'Hormones',c:'One plan that follows your body'}];
  var SPLASH=['#FF8A8A','#6DC55A','#A8F0C0','#FAC775'];
  var reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  var epoch=Date.now();
  function hex(h){h=h.replace('#','');return [parseInt(h.substr(0,2),16),parseInt(h.substr(2,2),16),parseInt(h.substr(4,2),16)];}
  function mix(a,b,t){a=hex(a);b=hex(b);return 'rgb('+Math.round(a[0]+(b[0]-a[0])*t)+','+Math.round(a[1]+(b[1]-a[1])*t)+','+Math.round(a[2]+(b[2]-a[2])*t)+')';}
  function idxAt(d){for(var i=0;i<PH.length;i++){if(d<PH[i].e)return i;}return PH.length-1;}
  // Phase colour at day d, blended over ~1.5 days at each edge (as in the app).
  function colorAt(d){var B=1.5,i=idxAt(d),p=PH[i],nx=PH[(i+1)%4],pv=PH[(i+3)%4];
    if(p.e-d<B)return mix(p.c,nx.c,(1-(p.e-d)/B)/2);
    if(d-p.s<B)return mix(p.c,pv.c,(1-(d-p.s)/B)/2);
    return mix(p.c,p.c,0);}
  function ease(t){return t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;}
  function easeOut(t){return 1-Math.pow(1-t,3);}
  function back(t){var c1=1.70158,c3=c1+1;return 1+c3*Math.pow(t-1,3)+c1*Math.pow(t-1,2);}
  function clamp(x){return x<0?0:x>1?1:x;}

  function Wheel(el,size,opts){
    opts=opts||{};
    var s=size,pad=s*.08,box=s+pad*2,stroke=s*.066,R=(s-stroke)/2,dia=s-stroke*2-s*.035;
    el.style.width=box+'px';el.style.height=box+'px';
    var cv=document.createElement('canvas'),dpr=Math.min(window.devicePixelRatio||1,3);
    cv.width=box*dpr;cv.height=box*dpr;el.appendChild(cv);
    var g=cv.getContext('2d');g.scale(dpr,dpr);
    var disc=document.createElement('div');disc.className='disc';disc.style.width=dia+'px';disc.style.height=dia+'px';el.appendChild(disc);
    var face=document.createElement('div');face.className='face';disc.appendChild(face);
    var fs=Math.max(8.5,Math.min(11,s*.038)),labs=PH.map(function(p,i){
      var d=document.createElement('span');d.className='lab';d.textContent=p.l;
      d.style.color=p.t;d.style.fontSize=fs+'px';d.style.padding=(s*.017)+'px '+(s*.034)+'px';
      var a=LAB[i][0]*Math.PI/180,r=LAB[i][1]*s;d._x=r*Math.sin(a);d._y=-r*Math.cos(a);el.appendChild(d);return d;});
    function place(d,sc,op){d.style.transform='translate(calc(-50% + '+d._x+'px),calc(-50% + '+d._y+'px)) scale('+sc+')';d.style.opacity=op;}
    var cv2=document.createElement('canvas');cv2.width=box*dpr;cv2.height=box*dpr;cv2.style.pointerEvents='none';el.appendChild(cv2);
    var g2=cv2.getContext('2d');g2.scale(dpr,dpr);
    // Intro: nothing but the splash dots until the ring draws.
    if(opts.intro){disc.style.opacity=0;labs.forEach(function(d){place(d,.6,0);});}else labs.forEach(function(d){place(d,1,1);});
    var slide=0;
    function paint(i){var sl=SL[i];face.innerHTML=(sl.e?'<span class="em" style="font-size:'+(s*.09)+'px;margin-bottom:'+(s*.02)+'px">'+sl.e+'</span>':'')+
      '<span class="big" style="font-size:'+(sl.n?s*.207:s*.131)+'px;letter-spacing:'+(sl.n?-s*.008:-s*.0026)+'px">'+sl.b+'</span>'+
      '<span class="cap'+(sl.n?' num':'')+'" style="font-size:'+(sl.n?Math.max(9,Math.min(11,s*.038)):Math.max(10.5,Math.min(12.5,s*.043)))+'px;max-width:'+(dia*.68)+'px">'+sl.c+'</span>';}
    // Intro: the three words pop in one after another while the ring draws.
    if(opts.intro){face.innerHTML=['Movement','Nutrition','Hormones'].map(function(w){return '<span class="tri" style="font-size:'+(s*.105)+'px">'+w+'</span>';}).join('');}
    else paint(0);
    // Fold: old turns away (0 → 90deg), new turns in (-90deg → 0).
    function next(){slide=(slide+1)%SL.length;var to=slide;
      if(reduce||!face.animate){paint(to);return;}
      face.animate([{transform:'rotateY(0)',opacity:1},{transform:'rotateY(90deg)',opacity:0}],{duration:430,easing:'ease-in',fill:'forwards'}).onfinish=function(){
        paint(to);face.animate([{transform:'rotateY(-90deg)',opacity:0},{transform:'rotateY(0)',opacity:1}],{duration:520,easing:'ease-out',fill:'forwards'});};}
    var loop=null;function startLoop(){clearInterval(loop);loop=setInterval(next,opts.every||3200);}
    el.addEventListener('click',function(){next();startLoop();});

    var drawn=opts.intro?0:1,grow=null,flyU=null,from=null,shown=!opts.intro;
    function seg(d0,d1){var a0=-Math.PI/2+d0/28*2*Math.PI,a1=-Math.PI/2+d1/28*2*Math.PI+.004;
      g.beginPath();g.strokeStyle=colorAt((d0+d1)/2);g.arc(box/2,box/2,R,a0,a1);g.stroke();}
    function frame(){
      g.clearRect(0,0,box,box);g2.clearRect(0,0,box,box);g.lineWidth=stroke;g.lineCap='butt';
      var N=168,step=28/N,k,d0;
      if(grow!==null){ if(grow>0) PH.forEach(function(p){var end=p.s+(p.e-p.s)*grow;for(d0=p.s;d0<end-1e-6;d0+=step)seg(d0,Math.min(d0+step,end));});}
      else { var lim=28*ease(drawn);for(k=0;k<N;k++){d0=k*step;if(d0>=lim)break;seg(d0,Math.min(d0+step,lim));} }
      // Splash dots flying to the start of their phase.
      if(flyU!==null&&from){for(var i=0;i<4;i++){var a=-Math.PI/2+PH[i].s/28*2*Math.PI,tx=box/2+R*Math.cos(a),ty=box/2+R*Math.sin(a),
        t=easeOut(clamp(flyU/.55)),cx=(from[i][0]+tx)/2+(ty-from[i][1])*.25,cy=(from[i][1]+ty)/2-(tx-from[i][0])*.25,
        x=(1-t)*(1-t)*from[i][0]+2*(1-t)*t*cx+t*t*tx,y=(1-t)*(1-t)*from[i][1]+2*(1-t)*t*cy+t*t*ty,rad=3.5+(stroke/2-3.5)*t,
        op=1-clamp((flyU-.62)/.3);if(op<=0)continue;g2.globalAlpha=op;g2.fillStyle=SPLASH[i];g2.beginPath();g2.arc(x,y,rad,0,Math.PI*2);g2.fill();g2.globalAlpha=1;}}
      // The travelling dot, on top (50 s a turn).
      if(shown&&drawn>=1&&grow===null){var orbit=((Date.now()-epoch)/50000+(opts.offset||0))%1,an=orbit*2*Math.PI,day=orbit*28,
        px=box/2+R*Math.sin(an),py=box/2-R*Math.cos(an),dr=s*.034,pulse=.5+.5*Math.sin(orbit*2*Math.PI*18),col=colorAt(day),cur=idxAt(day);
        g2.fillStyle=col;g2.globalAlpha=.25;g2.beginPath();g2.arc(px,py,dr*(1.45+.25*pulse),0,Math.PI*2);g2.fill();g2.globalAlpha=1;
        g2.shadowColor='rgba(22,50,32,.25)';g2.shadowBlur=4;g2.shadowOffsetY=1;g2.fillStyle='#fff';g2.beginPath();g2.arc(px,py,dr*1.36,0,Math.PI*2);g2.fill();
        g2.shadowColor='transparent';g2.shadowBlur=0;g2.shadowOffsetY=0;g2.fillStyle=col;g2.beginPath();g2.arc(px,py,dr,0,Math.PI*2);g2.fill();
        labs.forEach(function(d,i){var on=i===cur;if(d._on!==on){d._on=on;d.classList.toggle('on',on);place(d,on?1.22:1,1);}});}
    }
    var raf=null,visible=true;
    function tick(){frame();raf=requestAnimationFrame(tick);}
    if('IntersectionObserver' in window&&!opts.intro){new IntersectionObserver(function(es){visible=es[0].isIntersecting;
      if(visible&&!raf)tick();if(!visible&&raf){cancelAnimationFrame(raf);raf=null;}}).observe(el);}
    else tick();

    return {
      el:el,box:box,
      // Draw in clockwise from 12 o'clock (pages that skip the intro).
      drawIn:function(ms){var t0=performance.now();(function st(){drawn=clamp((performance.now()-t0)/ms);if(drawn<1)requestAnimationFrame(st);})();},
      // Splash hand-off: dots from points (wheel coordinates) → arcs grow from each phase.
      handOff:function(pts,ms,done){from=pts;grow=0;drawn=1;shown=false;disc.style.opacity=0;labs.forEach(function(d){place(d,.6,0);});
        var t0=performance.now();(function st(){var u=clamp((performance.now()-t0)/ms);flyU=u;
          grow=easeOut(clamp((u-.38)/.42));var ci=back(clamp((u-.62)/.3));disc.style.opacity=clamp(ci);disc.style.transform='translate(-50%,-50%) scale('+(.85+.15*ci)+')';
          labs.forEach(function(d,i){var li=back(clamp((u-.72-i*.04)/.24));place(d,.6+.4*li,clamp(li));});
          if(u<1)requestAnimationFrame(st);else{grow=null;flyU=null;from=null;shown=true;disc.style.transform='translate(-50%,-50%)';if(done)done();}})();},
      // Splash dots sitting still (before they fly).
      showDots:function(pts){from=pts;flyU=0;grow=0;drawn=1;shown=false;disc.style.opacity=0;labs.forEach(function(d){place(d,.6,0);});},
      words:function(gap){[].forEach.call(face.querySelectorAll('.tri'),function(t,i){setTimeout(function(){t.classList.add('on');},i*gap);});},
      next:next,startLoop:startLoop,
      stop:function(){clearInterval(loop);if(raf)cancelAnimationFrame(raf);raf=null;}
    };
  }


  // Opening intro: once per visit, never with reduced motion.
  var intro=document.getElementById('intro'),root=document.documentElement;
  var seen=false;try{seen=sessionStorage.getItem('fh_offer_intro')==='1';}catch(e){}
  function finish(){if(!intro)return;var el=intro;intro=null;root.classList.remove('intro-on');el.classList.add('out');
    try{sessionStorage.setItem('fh_offer_intro','1');}catch(e){}
    setTimeout(function(){if(el.parentNode)el.parentNode.removeChild(el);if(iw)iw.stop();},320);}
  var iw=null;
  if(!intro) return;
  if(reduce||seen){intro.parentNode.removeChild(intro);intro=null;root.classList.remove('intro-on');return;}
  var size=Math.min(window.innerWidth*.74,window.innerHeight*.42,320);
  iw=Wheel(document.getElementById('introWheel'),size,{intro:true,every:650});
  var b=iw.box,logo=document.getElementById('ilogo');
  document.getElementById('skip').addEventListener('click',function(e){e.stopPropagation();finish();});
  intro.addEventListener('click',finish);
  // Splash dots in a row at the wheel's centre, then they fly to the ring.
  var gap=15,pts=[0,1,2,3].map(function(i){return [b/2+(i-1.5)*gap,b/2];});
  // About 1.8 s in all: dots fly and draw the ring (0.1-1.0 s), Movement,
  // Nutrition, Hormones pop in (0.7-1.0 s), then into the page (1.5 s + fade).
  iw.showDots(pts);
  setTimeout(function(){if(intro)iw.handOff(pts,900);},100);
  setTimeout(function(){if(intro){iw.words(130);document.getElementById('itag').classList.add('on');}},700);
  setTimeout(finish,1500);
})();
`;

module.exports = { wheelCss, introHtml, wheelScript };
