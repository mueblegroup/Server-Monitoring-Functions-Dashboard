// Screen geometry reserves room for controls rather than allowing nested scrolling.
export function screenGeometry(width,height,overview=false,landscape=false){
  const columns=width<620?1:width<1050?2:3;
  return {columns,rows:Math.max(1,Math.min(3,Math.floor((height+10)/290))),cockpit:overview&&landscape&&width>=960&&height>=470};
}
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
  let mode=true;try{mode=localStorage.getItem('orbit-view-mode-v2')!=='expanded';}catch{}
  let active=true,frame,index=0,pages=[],start=null,expanded=null,singleRow=false,geometryKey='';
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
  const dialog=document.querySelector('#modal'),modalContent=document.querySelector('#modal-content');
  function restoreDetails(){
    if(!expanded)return;
    const {card,placeholder}=expanded;expanded=null;
    card.classList.remove('detail-card');placeholder.replaceWith(card);schedule();
  }
  const closeDetails=()=>restoreDetails();dialog.addEventListener('close',closeDetails);
  function details(card){
    if(dialog.open)return;
    const placeholder=document.createElement('section');placeholder.className=card.className;placeholder.dataset.widget=card.dataset.widget||'';placeholder.style.cssText=card.style.cssText;
    card.replaceWith(placeholder);expanded={card,placeholder};card.classList.add('detail-card');
    for(const frame of card.querySelectorAll('iframe[data-deferred-src]')){frame.src=frame.dataset.deferredSrc;delete frame.dataset.deferredSrc;}
    modalContent.replaceChildren(card);dialog.showModal();
  }
  // Return delegated service buttons to the application before they open another dialog.
  const detailClick=event=>{
    if(!expanded||!event.target.closest('button'))return;
    const card=expanded.card;restoreDetails();dialog.close();
    if(event.target.closest('[data-action],[data-resource],[data-user]'))app.onclick?.(event);
  };
  modalContent.addEventListener('click',detailClick,true);
  const listPagers=new Map(),listIndexes=new Map();
  const setMode=()=>{document.body.classList.toggle('screen-fit',mode);toggle.textContent=mode?'Expand view':'Fit screen';toggle.setAttribute('aria-pressed',String(mode));};
  const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(update);};
  function paginateLists(){
    for(const list of grid.querySelectorAll('#service-list,#movies,#audit,#stripe-events,[data-widget="storage"] .host-metric')){
      const listKey=list.id||'storage-pools';
      const children=[...list.children].filter(el=>el.matches('.resource,.audit-row,.storage-pool'));
      if(!children.length){const controls=listPagers.get(listKey);if(controls&&!controls.hidden)controls.hidden=true;continue;}
      const measured=children.find(el=>!el.classList.contains('screen-item-hidden'))||children[0];
      const height=measured.getBoundingClientRect().height||240;
      const room=Math.max(100,list.closest('.card').getBoundingClientRect().bottom-list.getBoundingClientRect().top-58);
      const count=Math.max(1,Math.floor(room/(height+12))),total=Math.ceil(children.length/count);
      let current=Math.min(listIndexes.get(listKey)||0,total-1);listIndexes.set(listKey,current);
      children.forEach((el,i)=>el.classList.toggle('screen-item-hidden',mode&&(i<current*count||i>=(current+1)*count)));
      let controls=listPagers.get(listKey);
      if(!controls){controls=document.createElement('div');controls.className='list-pager';list.after(controls);listPagers.set(listKey,controls);}
      // Keep the handler in sync as resource counts and page capacities change.
      controls.onclick=e=>{const button=e.target.closest('button');if(!button)return;listIndexes.set(listKey,Math.max(0,(listIndexes.get(listKey)||0)+Number(button.dataset.step)));schedule();};
      const hide=!mode||total<=1;if(controls.hidden!==hide)controls.hidden=hide;
      const key=`${current}/${total}`;
      if(controls.dataset.state!==key){controls.dataset.state=key;controls.innerHTML=`<button type="button" class="small-button" data-step="-1" ${current===0?'disabled':''}>Previous</button><span class="subtle">${current+1} / ${total}</span><button type="button" class="small-button" data-step="1" ${current===total-1?'disabled':''}>Next</button>`;}
    }
  }
  function update(){
    if(!active)return;
    setMode();
    if(expanded)return;
    if(!mode){document.body.classList.remove('cockpit-layout','cockpit-front');for(const card of grid.children)card.classList.remove('screen-card-hidden','fit-summary','fit-tight','fit-micro');for(const el of grid.querySelectorAll('.screen-item-hidden'))el.classList.remove('screen-item-hidden');pager.hidden=true;for(const controls of listPagers.values())if(!controls.hidden)controls.hidden=true;grid.style.removeProperty('--screen-columns');grid.style.removeProperty('--screen-rows');return;}
    const width=grid.getBoundingClientRect().width,viewport=window.visualViewport?.height||window.innerHeight;
    document.documentElement.style.setProperty('--viewport-height',`${viewport}px`);
    const overview=!grid.dataset.customPage&&Boolean(grid.querySelector('[data-widget="clock"]'));
    const cockpit=overview&&window.innerWidth>viewport;
    document.body.classList.toggle('cockpit-layout',cockpit);
    const bottom=document.querySelector('#nav').getBoundingClientRect().top;
    const available=Math.max(70,Math.min(viewport,bottom-6,app.getBoundingClientRect().bottom)-grid.getBoundingClientRect().top-38);
    const currentGeometry=`${Math.round(width)}/${Math.round(available)}`;
    if(currentGeometry!==geometryKey){geometryKey=currentGeometry;singleRow=false;}
    const explicit=grid._orbitPlan;
    const geometry=screenGeometry(width,available,overview,window.innerWidth>viewport);
    if(singleRow){geometry.rows=1;geometry.cockpit=false;}
    if(explicit)geometry.cockpit=false;
    const {columns,rows}=geometry;
    grid.style.setProperty('--screen-columns',String(columns));grid.style.setProperty('--screen-rows',String(rows));grid.style.setProperty('--screen-height',`${available}px`);
    const cards=[...grid.children].filter(el=>!el.hidden);
    const frontIds=['clock','music','movies','cpu','memory','health','network'];
    const frontCards=geometry.cockpit?cards.map((el,id)=>({el,id})).filter(({el})=>frontIds.includes(el.dataset.widget)):[];
    const frontIndexes=new Set(frontCards.map(c=>c.id));
    const rest=cards.map((el,id)=>({id,width:Number([...el.classList].find(c=>/^span\d+$/.test(c))?.slice(4))||4})).filter(c=>!frontIndexes.has(c.id));
    pages=[...(frontCards.length?[frontCards.map(({el,id})=>({id,span:el.dataset.widget==='clock'?4:2}))]:[]),...packScreens(rest,columns,rows)];
    if(explicit){pages=[explicit.map(p=>({id:cards.findIndex(c=>c.dataset.widget===p.id),span:p.w,placement:p})).filter(p=>p.id>=0)];grid.style.setProperty('--screen-columns','12');grid.style.setProperty('--screen-rows','6');}
    index=Math.max(0,Math.min(index,pages.length-1));
    const cockpitFront=Boolean(frontCards.length)&&index===0;
    document.body.classList.toggle('cockpit-front',cockpitFront);
    if(cockpitFront){grid.style.setProperty('--screen-columns','8');grid.style.setProperty('--screen-rows','2');}
    const visible=new Set((pages[index]||[]).map(item=>item.id));
    cards.forEach((el,id)=>el.classList.toggle('screen-card-hidden',!visible.has(id)));
    for(const card of cards){card.style.removeProperty('--layout-column');card.style.removeProperty('--layout-row');}
    for(const item of pages[index]||[]){const card=cards[item.id];card.style.setProperty('--screen-span',String(item.span));if(item.placement){const p=item.placement;card.style.setProperty('--layout-column',`${p.x+1} / span ${p.w}`);card.style.setProperty('--layout-row',`${p.y+1} / span ${p.h}`);}}
    pager.hidden=pages.length<=1;
    const key=`${index}/${pages.length}`;
    if(pager.dataset.state!==key){pager.dataset.state=key;pager.innerHTML=`<button type="button" class="small-button" data-step="-1" aria-label="Previous widget screen" ${index===0?'disabled':''}>Previous</button><span class="screen-position" role="status">Screen ${pages.length?index+1:0} of ${pages.length}</span><button type="button" class="small-button" data-step="1" aria-label="Next widget screen" ${index>=pages.length-1?'disabled':''}>Next</button>`;}
    paginateLists();
    for(const card of cards){
      if(card.classList.contains('screen-card-hidden'))continue;
      let button=card.querySelector(':scope > .fit-details');
      if(!button){button=document.createElement('button');button.type='button';button.className='fit-details';button.textContent='Details';button.setAttribute('aria-label','Show full '+(card.querySelector('h2')?.textContent||card.dataset.widget||'card')+' details');button.onclick=()=>details(card);card.append(button);}
      card.classList.toggle('fit-micro',card.clientHeight<170);
      // A summary never relies on clipped overflow. The original live content remains in Details.
      card.classList.remove('fit-summary','fit-tight');
      if(card.scrollHeight>card.clientHeight+2)card.classList.add('fit-summary');
      if(card.scrollHeight>card.clientHeight+2)card.classList.add('fit-tight');
      if(card.scrollHeight>card.clientHeight+2&&(rows>1||cockpitFront)&&!singleRow&&!explicit){singleRow=true;schedule();}
      for(const frame of card.querySelectorAll('iframe')){
        if(card.clientHeight<270&&frame.src.startsWith('https://www.youtube-nocookie.com/')){frame.dataset.deferredSrc=frame.src;frame.removeAttribute('src');}
        else if(card.clientHeight>=270&&frame.dataset.deferredSrc){frame.src=frame.dataset.deferredSrc;delete frame.dataset.deferredSrc;}
      }
    }
  }
  const move=step=>{if(!mode||index+step<0||index+step>=pages.length)return false;index+=step;update();return true;};
  pager.onclick=e=>{const button=e.target.closest('button');if(button)move(Number(button.dataset.step));};
  toggle.onclick=()=>{mode=!mode;try{localStorage.setItem('orbit-view-mode-v2',mode?'fit':'expanded');}catch{}schedule();};
  const key=e=>{if(document.querySelector('#modal').open||e.target.closest('input,textarea,select,button,a')||!['ArrowLeft','ArrowRight'].includes(e.key))return;if(move(e.key==='ArrowRight'?1:-1)){e.preventDefault();e.stopImmediatePropagation();}};
  const touchStart=e=>{start=e.target.closest('input,textarea,select,button,a,dialog,[data-widget="stack"]')?null:{x:e.changedTouches[0].screenX,y:e.changedTouches[0].screenY};};
  const touchEnd=e=>{if(!start)return;const dx=e.changedTouches[0].screenX-start.x,dy=e.changedTouches[0].screenY-start.y;start=null;if(Math.abs(dx)>70&&Math.abs(dx)>Math.abs(dy)*1.8&&move(dx<0?1:-1))e.stopImmediatePropagation();};
  window.addEventListener('keydown',key,true);app.addEventListener('touchstart',touchStart,{capture:true,passive:true});app.addEventListener('touchend',touchEnd,{capture:true,passive:true});
  const observer=new MutationObserver(schedule);observer.observe(grid,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});
  const resize=new ResizeObserver(schedule);resize.observe(app);window.addEventListener('resize',schedule);window.visualViewport?.addEventListener('resize',schedule);
  update();
  fullscreenChange();
  return ()=>{active=false;restoreDetails();cancelAnimationFrame(frame);observer.disconnect();resize.disconnect();dialog.removeEventListener('close',closeDetails);modalContent.removeEventListener('click',detailClick,true);window.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('resize',schedule);document.removeEventListener('fullscreenchange',fullscreenChange);window.removeEventListener('keydown',key,true);app.removeEventListener('touchstart',touchStart,true);app.removeEventListener('touchend',touchEnd,true);fullscreen.remove();toggle.remove();pager.remove();document.body.classList.remove('screen-fit','cockpit-layout','cockpit-front');document.documentElement.style.removeProperty('--viewport-height');for(const card of original){card.classList.remove('screen-card-hidden','fit-summary','fit-tight','fit-micro');card.querySelector(':scope > .fit-details')?.remove();}for(const el of grid.querySelectorAll('.screen-item-hidden'))el.classList.remove('screen-item-hidden');for(const controls of listPagers.values())controls.remove();};
}
