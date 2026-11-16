import {calendarDate} from './public/billing.mjs';
export const tileIds=['cpu','memory','health','storage','guests','clock','weather','infrastructure','network','music','movies','codex','stripe','launch','bills','hostinger'];
export function validateWorkspace(input){
  const fail=()=>{throw Object.assign(new Error('Invalid page or recurring billing settings'),{status:400});};
  const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9-]{1,64}$/.test(value);
  const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
  if(!input||!Array.isArray(input.pages)||input.pages.length>24||!Array.isArray(input.bills)||input.bills.length>100)fail();
  if(new Set(input.pages.map(p=>p?.id)).size!==input.pages.length||new Set(input.bills.map(b=>b?.id)).size!==input.bills.length)fail();
  const pages=input.pages.map(p=>{
    if(!p||!validId(p.id)||!text(p.title,60)||!Array.isArray(p.widgets)||p.widgets.length<1||p.widgets.length>tileIds.length||new Set(p.widgets.map(w=>w?.id)).size!==p.widgets.length)fail();
    if(p.widgets.some(w=>!w||!tileIds.includes(w.id)||![4,6,12].includes(w.width)||typeof w.visible!=='boolean'))fail();
    return {id:p.id,title:p.title.trim(),widgets:p.widgets.map(({id,width,visible})=>({id,width,visible}))};
  });
  const bills=input.bills.map(b=>{
    if(!b||!validId(b.id)||!text(b.name,80)||!Number.isFinite(b.amount)||b.amount<0||b.amount>100000000||typeof b.currency!=='string'||!/^[A-Z]{3}$/.test(b.currency)||!['monthly','yearly'].includes(b.frequency)||!calendarDate(b.anchorDate))fail();
    return {id:b.id,name:b.name.trim(),amount:Math.round(b.amount*100)/100,currency:b.currency,frequency:b.frequency,anchorDate:b.anchorDate};
  });return {pages,bills};
}
