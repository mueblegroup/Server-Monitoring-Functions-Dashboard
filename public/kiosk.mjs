export function isNight(hour,start,end){return start!==end&&(start<end?hour>=start&&hour<end:hour>=start||hour<end);}
export function mountKiosk(settings,available){
  if(!settings.enabled)return ()=>{};
  let wake=null,active=true,last=Date.now(),touchUntil=0,paused=false;try{touchUntil=(Number(sessionStorage.getItem('orbit-kiosk-touch'))||0)+60000;paused=sessionStorage.getItem('orbit-kiosk-paused')==='true';}catch{}
  const button=document.createElement('button');button.className='small-button kiosk-toggle';button.type='button';document.querySelector('.header-right').prepend(button);
  const paint=()=>{button.textContent=paused?'Resume kiosk':'Pause kiosk';button.setAttribute('aria-pressed',String(!paused));};paint();
  const touch=()=>{touchUntil=Date.now()+60000;try{sessionStorage.setItem('orbit-kiosk-touch',String(Date.now()));}catch{}};
  button.onclick=()=>{paused=!paused;try{sessionStorage.setItem('orbit-kiosk-paused',String(paused));}catch{}touch();paint();};
  async function requestWake(){if(active&&settings.wake&&!document.hidden&&!wake&&navigator.wakeLock){try{const lock=await navigator.wakeLock.request('screen');if(!active){await lock.release();return;}wake=lock;lock.addEventListener('release',()=>{if(wake===lock)wake=null;});}catch{button.title='Screen wake lock unavailable. Check browser power settings.';}}}
  function dim(){document.body.classList.toggle('kiosk-night',isNight(new Date().getHours(),settings.nightStart,settings.nightEnd));document.documentElement.style.setProperty('--kiosk-brightness',String(settings.dim));}
  const visible=()=>{if(!document.hidden){requestWake();dim();touch();}};document.addEventListener('visibilitychange',visible);document.addEventListener('pointerdown',touch,{passive:true});document.addEventListener('keydown',touch);
  const timer=setInterval(()=>{dim();if(paused||document.hidden||document.querySelector('dialog[open]')||!document.querySelector('#page-loader')?.hidden||Date.now()<touchUntil||Date.now()-last<settings.interval*1000)return;
    const selectedPages=settings.pages.filter(p=>available.includes(p)),current=location.hash.slice(1)||'overview';if(!selectedPages.length)return;if(!selectedPages.includes(current)){location.hash=selectedPages[0];last=Date.now();return;}
    const pager=document.querySelector('.screen-pager'),next=pager?.querySelector('[data-step="1"]');if(pager&&!pager.hidden&&next&&!next.disabled)next.click();else{
      const pages=settings.pages.filter(p=>available.includes(p));if(!pages.length)return;const index=pages.indexOf(location.hash.slice(1)||'overview'),page=pages[(index+1)%pages.length];if(location.hash==='#'+page){for(let i=0;i<32;i++){const prev=pager?.querySelector('[data-step="-1"]');if(!prev||prev.disabled)break;prev.click();}}else location.hash=page;
    }last=Date.now();
  },1000);requestWake();dim();
  return ()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',visible);document.removeEventListener('pointerdown',touch);document.removeEventListener('keydown',touch);wake?.release().catch(()=>{});button.remove();document.body.classList.remove('kiosk-night');};
}
