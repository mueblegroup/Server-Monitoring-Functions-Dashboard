export function weatherKind(code){
  if(code===0)return 'clear';
  if([1,2].includes(code))return 'partly';
  if(code===3)return 'cloudy';
  if([45,48].includes(code))return 'fog';
  if(code>=95&&code<=99)return 'storm';
  if([71,73,75,77,85,86].includes(code))return 'snow';
  if([51,53,55,56,57,61,63,65,66,67,80,81,82].includes(code))return 'rain';
  return 'unknown';
}
export function weatherIcon(code,isDay=true){
  const kind=weatherKind(code),label={clear:isDay?'Clear sky':'Clear night',partly:'Partly cloudy',cloudy:'Cloudy',fog:'Fog',rain:'Rain',snow:'Snow',storm:'Thunderstorm',unknown:'Weather illustration'}[kind];
  const sun='<g class="weather-sun"><g class="weather-rays" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M37 7v6m0 48v6M7 37h6m48 0h6M16 16l4 4m34 34 4 4M16 58l4-4m34-34 4-4"/></g><circle cx="37" cy="37" r="16" fill="currentColor"/></g>';
  const moon='<path class="weather-moon" d="M50 13a24 24 0 1 0 11 40A24 24 0 0 1 50 13Z" fill="currentColor"/>';
  const cloud='<path class="weather-cloud" d="M25 61a13 13 0 0 1-1-26 20 20 0 0 1 37-7 16 16 0 0 1 7 31c-3 2-8 2-12 2Z" fill="currentColor"/>';
  const drops='<g class="weather-rain" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="m29 70-3 7"/><path d="m45 70-3 7"/><path d="m61 70-3 7"/></g>';
  const snow='<g class="weather-snow" fill="currentColor"><circle cx="29" cy="73" r="2.5"/><circle cx="45" cy="76" r="2.5"/><circle cx="61" cy="72" r="2.5"/></g>';
  const fog='<g class="weather-fog" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 69h47M26 77h38"/></g>';
  return `<span class="weather-icon weather-animated weather-${kind}"><svg viewBox="0 0 90 90" role="img" aria-label="${label}">${['clear','partly','unknown'].includes(kind)?(isDay?sun:moon):''}${kind!=='clear'?cloud:''}${['rain','storm'].includes(kind)?drops:''}${kind==='snow'?snow:''}${kind==='fog'?fog:''}${kind==='storm'?'<path class="weather-lightning" d="m48 49-9 18h9l-5 14 19-23H51l6-9Z" fill="currentColor"/>':''}</svg></span>`;
}
export const loadingState=(label='Loading')=>`<div class="loading-state" role="status"><span class="loading-orbit" aria-hidden="true"></span><span>${label}<span class="loading-dots" aria-hidden="true">…</span></span></div>`;
export function createLoadIndicator(element,{delay=120,settle=240}={}){
  let pending=0,showTimer,hideTimer;
  return ()=>{
    pending++;clearTimeout(hideTimer);
    if(pending===1)showTimer=setTimeout(()=>{element.hidden=false;},delay);
    let finished=false;
    return ()=>{if(finished)return;finished=true;pending=Math.max(0,pending-1);if(!pending){clearTimeout(showTimer);hideTimer=setTimeout(()=>{if(!pending)element.hidden=true;},settle);}};
  };
}
