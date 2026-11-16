// Pack cards without shrinking their text. Oversized details remain accessible inside a card.
export function packScreens(cards,columns,rows){
  const capacity=columns*rows,pages=[];let page=[],used=0;
  for(const card of cards){
    const span=Math.max(1,Math.min(columns,Math.ceil((card.width||4)*columns/12)));
    const remaining=columns-used%columns;
    const gap=span>remaining?remaining:0;
    if(page.length&&used+gap+span>capacity){pages.push(page);page=[];used=0;}
    else used+=gap;
    page.push({id:card.id,span});used+=span;
  }
  if(page.length)pages.push(page);return pages;
}
export function mountScreenFit(){
  const app=document.querySelector('#app'),grid=app.querySelector(':scope > .grid');
  if(!grid)return ()=>{};
  let mode=true;try{mode=localStorage.getItem('orbit-view-mode')!=='expanded';}catch{}
  let active=true,frame,index=0,pages=[],start=null;
  const header=document.querySelector('.header-right'),toggle=document.createElement('button');
  toggle.className='small-button view-mode';toggle.type='button';header.prepend(toggle);
  const fullscreen=document.createElement('button');fullscreen.type='button';fullscreen.className='small-button fullscreen-toggle';fullscreen.textContent='Full screen';fullscreen.setAttribute('aria-label','Enter fullscreen dashboard');header.prepend(fullscreen);
  fullscreen.disabled=!document.fullscreenEnabled;
  if(fullscreen.disabled)fullscreen.title='Fullscreen is not supported in this browser. Use browser fullscreen or Add to Home Screen.';
  const fullscreenChange=()=>{fullscreen.textContent=document.fullscreenElement?'Exit fullscreen':'Full screen';fullscreen.setAttribute('aria-label',document.fullscreenElement?'Exit fullscreen dashboard':'Enter fullscreen dashboard');schedule();};
  fullscreen.onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else{mode=true;setMode();await document.documentElement.requestFullscreen();}schedule();}catch{fullscreen.title='Fullscreen was blocked by your browser. Try its fullscreen command.';fullscreen.textContent='Fullscreen blocked';}};
  document.addEventListener('fullscreenchange',fullscreenChange);
  const pager=document.createElement('div');pager.className='screen-pager';pager.setAttribute('aria-label','Widget screens');grid.after(pager);
  const original=[...grid.children];
  const listPagers=new Map(),listIndexes=new Map();
  const setMode=()=>{document.body.classList.toggle('screen-fit',mode);toggle.textContent=mode?'Expand view':'Fit screen';toggle.setAttribute('aria-pressed',String(mode));};
  const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(update);};
  function paginateLists(){
    for(const list of grid.querySelectorAll('#service-list,#movies,#audit,#stripe-events')){
      const children=[...list.children].filter(el=>el.matches('.resource,.audit-row'));
      if(!children.length){const controls=listPagers.get(list.id);if(controls&&!controls.hidden)controls.hidden=true;continue;}
      const measured=children.find(el=>!el.classList.contains('screen-item-hidden'))||children[0];
      const height=measured.getBoundingClientRect().height||240;
      const room=Math.max(100,list.closest('.card').getBoundingClientRect().bottom-list.getBoundingClientRect().top-58);
      const count=Math.max(1,Math.floor(room/(height+12))),total=Math.ceil(children.length/count);
      let current=Math.min(listIndexes.get(list.id)||0,total-1);listIndexes.set(list.id,current);
      children.forEach((el,i)=>el.classList.toggle('screen-item-hidden',mode&&(i<current*count||i>=(current+1)*count)));
      let controls=listPagers.get(list.id);
      if(!controls){controls=document.createElement('div');controls.className='list-pager';list.after(controls);listPagers.set(list.id,controls);controls.onclick=e=>{const button=e.target.closest('button');if(!button)return;listIndexes.set(list.id,Math.max(0,current+Number(button.dataset.step)));schedule();};}
      // Keep the handler in sync as resource counts and page capacities change.
      controls.onclick=e=>{const button=e.target.closest('button');if(!button)return;listIndexes.set(list.id,Math.max(0,(listIndexes.get(list.id)||0)+Number(button.dataset.step)));schedule();};
      const hide=!mode||total<=1;if(controls.hidden!==hide)controls.hidden=hide;
      const key=`${current}/${total}`;
      if(controls.dataset.state!==key){controls.dataset.state=key;controls.innerHTML=`<button type="button" class="small-button" data-step="-1" ${current===0?'disabled':''}>Previous</button><span class="subtle">${current+1} / ${total}</span><button type="button" class="small-button" data-step="1" ${current===total-1?'disabled':''}>Next</button>`;}
    }
  }
  function update(){
    if(!active)return;
    setMode();
    if(!mode){for(const card of grid.children)card.classList.remove('screen-card-hidden');for(const el of grid.querySelectorAll('.screen-item-hidden'))el.classList.remove('screen-item-hidden');pager.hidden=true;for(const controls of listPagers.values())if(!controls.hidden)controls.hidden=true;grid.style.removeProperty('--screen-columns');grid.style.removeProperty('--screen-rows');return;}
    const width=grid.getBoundingClientRect().width,viewport=window.visualViewport?.height||window.innerHeight;
    const bottom=document.querySelector('#nav').getBoundingClientRect().top;
    const available=Math.max(110,Math.min(viewport,bottom)-grid.getBoundingClientRect().top-54);
    const columns=width<640?1:width<1100?2:3,rows=available>=460?2:1;
    grid.style.setProperty('--screen-columns',String(columns));grid.style.setProperty('--screen-rows',String(rows));grid.style.setProperty('--screen-height',`${available}px`);
    const cards=[...grid.children].filter(el=>!el.hidden);
    pages=packScreens(cards.map((el,id)=>({id,width:Number([...el.classList].find(c=>/^span\d+$/.test(c))?.slice(4))||4})),columns,rows);
    index=Math.max(0,Math.min(index,pages.length-1));
    const visible=new Set((pages[index]||[]).map(item=>item.id));
    cards.forEach((el,id)=>el.classList.toggle('screen-card-hidden',!visible.has(id)));
    for(const item of pages[index]||[])cards[item.id].style.setProperty('--screen-span',String(item.span));
    pager.hidden=pages.length<=1;
    const key=`${index}/${pages.length}`;
    if(pager.dataset.state!==key){pager.dataset.state=key;pager.innerHTML=`<button type="button" class="small-button" data-step="-1" aria-label="Previous widget screen" ${index===0?'disabled':''}>Previous</button><span class="screen-position" role="status">Screen ${pages.length?index+1:0} of ${pages.length}</span><button type="button" class="small-button" data-step="1" aria-label="Next widget screen" ${index>=pages.length-1?'disabled':''}>Next</button>`;}
    paginateLists();
  }
  const move=step=>{if(!mode||index+step<0||index+step>=pages.length)return false;index+=step;update();return true;};
  pager.onclick=e=>{const button=e.target.closest('button');if(button)move(Number(button.dataset.step));};
  toggle.onclick=()=>{mode=!mode;try{localStorage.setItem('orbit-view-mode',mode?'fit':'expanded');}catch{}schedule();};
  const key=e=>{if(document.querySelector('#modal').open||e.target.closest('input,textarea,select,button,a')||!['ArrowLeft','ArrowRight'].includes(e.key))return;if(move(e.key==='ArrowRight'?1:-1)){e.preventDefault();e.stopImmediatePropagation();}};
  const touchStart=e=>{start=e.target.closest('input,textarea,select,button,a,dialog')?null:{x:e.changedTouches[0].screenX,y:e.changedTouches[0].screenY};};
  const touchEnd=e=>{if(!start)return;const dx=e.changedTouches[0].screenX-start.x,dy=e.changedTouches[0].screenY-start.y;start=null;if(Math.abs(dx)>70&&Math.abs(dx)>Math.abs(dy)*1.8&&move(dx<0?1:-1))e.stopImmediatePropagation();};
  window.addEventListener('keydown',key,true);app.addEventListener('touchstart',touchStart,{capture:true,passive:true});app.addEventListener('touchend',touchEnd,{capture:true,passive:true});
  const observer=new MutationObserver(schedule);observer.observe(grid,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});
  const resize=new ResizeObserver(schedule);resize.observe(app);window.addEventListener('resize',schedule);window.visualViewport?.addEventListener('resize',schedule);
  update();
  fullscreenChange();
  return ()=>{active=false;cancelAnimationFrame(frame);observer.disconnect();resize.disconnect();window.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('resize',schedule);document.removeEventListener('fullscreenchange',fullscreenChange);window.removeEventListener('keydown',key,true);app.removeEventListener('touchstart',touchStart,true);app.removeEventListener('touchend',touchEnd,true);fullscreen.remove();toggle.remove();pager.remove();document.body.classList.remove('screen-fit');for(const card of original)card.classList.remove('screen-card-hidden');for(const el of grid.querySelectorAll('.screen-item-hidden'))el.classList.remove('screen-item-hidden');for(const controls of listPagers.values())controls.remove();};
}
