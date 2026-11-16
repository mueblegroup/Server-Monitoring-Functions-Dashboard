import {defaultExperience,pageKey,placementsValid} from './public/experience-data.mjs';
import {tileIds} from './workspace.mjs';
export function validateExperience(input){
  const fail=()=>{throw Object.assign(Error('Invalid dashboard experience settings'),{status:400});};
  if(!input||typeof input!=='object')fail();const d=defaultExperience(),out=structuredClone(d);
  const num=(v,min,max)=>Number.isFinite(v)&&v>=min&&v<=max;
  const appearance=a=>{if(!a||!['original','rounded','flat','glass'].includes(a.preset)||!/^#[0-9a-fA-F]{6}$/.test(a.accent)||!['system','rounded','mono'].includes(a.font)||!num(a.spacing,4,24)||!num(a.corners,0,32)||!num(a.opacity,.4,1))fail();return {preset:a.preset,accent:a.accent,font:a.font,spacing:a.spacing,corners:a.corners,opacity:a.opacity};};
  out.appearance=appearance(input.appearance??d.appearance);
  for(const [key,value] of Object.entries(input.pageAppearance||{})){if(!pageKey(key)||Object.keys(out.pageAppearance).length>=27)fail();out.pageAppearance[key]=appearance(value);}
  for(const [key,value] of Object.entries(input.layouts||{})){
    if(!pageKey(key)||!value||Object.keys(out.layouts).length>=27)fail();out.layouts[key]={};
    for(const orientation of ['portrait','landscape'])if(value[orientation]!==undefined){if(!placementsValid(value[orientation],tileIds))fail();out.layouts[key][orientation]=value[orientation].map(({id,x,y,w,h})=>({id,x,y,w,h}));}
  }
  const e=input.electricity??d.electricity;if(!e||(e.rate!==null&&!num(e.rate,0,1000))||!/^[A-Z]{3}$/.test(e.currency))fail();out.electricity={rate:e.rate,currency:e.currency};
  const s=input.stack??d.stack;if(!s||!Array.isArray(s.items)||!s.items.length||s.items.length>6||new Set(s.items).size!==s.items.length||s.items.some(x=>!['cpu','memory','temperatures','fans','power','network'].includes(x))||!num(s.interval,5,120))fail();out.stack={items:s.items,interval:s.interval};
  const k=input.kiosk??d.kiosk;if(!k||typeof k.enabled!=='boolean'||typeof k.wake!=='boolean'||!num(k.interval,10,600)||!Array.isArray(k.pages)||!k.pages.length||k.pages.length>27||!k.pages.every(pageKey)||!Number.isInteger(k.nightStart)||!num(k.nightStart,0,23)||!Number.isInteger(k.nightEnd)||!num(k.nightEnd,0,23)||!num(k.dim,.1,1))fail();out.kiosk={enabled:k.enabled,wake:k.wake,interval:k.interval,pages:[...new Set(k.pages)],nightStart:k.nightStart,nightEnd:k.nightEnd,dim:k.dim};
  const a=input.alerts??d.alerts;if(!a||!num(a.temperature,40,150)||!num(a.storage,50,100)||!num(a.billDays,0,60))fail();out.alerts={temperature:a.temperature,storage:a.storage,billDays:a.billDays};return out;
}
