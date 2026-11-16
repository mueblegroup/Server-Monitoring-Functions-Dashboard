const DAY=86400000;
export function calendarDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
  const date=new Date(value+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value?date:null;
}
const iso=date=>date.toISOString().slice(0,10);
function shifted(anchor,months){
  const first=new Date(Date.UTC(anchor.getUTCFullYear(),anchor.getUTCMonth()+months,1));
  const last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
  first.setUTCDate(Math.min(anchor.getUTCDate(),last));return first;
}
export function billCycle(bill,today){
  const anchor=calendarDate(bill.anchorDate),now=calendarDate(today);if(!anchor||!now)throw Error('Invalid billing date');
  const step=bill.frequency==='yearly'?12:1;
  let offset=Math.floor(((now.getUTCFullYear()-anchor.getUTCFullYear())*12+now.getUTCMonth()-anchor.getUTCMonth())/step)*step;
  let due=shifted(anchor,offset);if(due<now){offset+=step;due=shifted(anchor,offset);}
  const start=shifted(anchor,offset-step),days=Math.round((due-start)/DAY),daysLeft=Math.max(0,Math.round((due-now)/DAY));
  const elapsed=Math.max(0,Math.min(1,(days-daysLeft)/days));
  return {due:iso(due),start:iso(start),daysLeft,periodDays:days,elapsedPercent:elapsed*100,
    allocated:Math.round(bill.amount*elapsed*100)/100,remaining:Math.round(bill.amount*(1-elapsed)*100)/100,
    monthly:bill.frequency==='yearly'?bill.amount/12:bill.amount,yearly:bill.frequency==='yearly'?bill.amount:bill.amount*12};
}
export function todayLocal(){const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
export function money(amount,currency){return Number.isFinite(amount)?`${currency||''} ${amount.toFixed(2)}`:'Amount unavailable';}
export function countdown(due,period=30,today=todayLocal()){
  const date=calendarDate(String(due||'').slice(0,10)),now=calendarDate(today);if(!date)return null;
  const days=Math.round((date-now)/DAY);return {days,elapsedPercent:Math.max(0,Math.min(100,(1-days/Math.max(1,period))*100))};
}
export function gauge(value,label){
  const progress=Math.max(0,Math.min(100,value.elapsedPercent));
  return `<div class="billing-gauge" role="img" aria-label="${Math.abs(value.daysLeft??value.days)} days ${value.days<0?'overdue':'remaining'}"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="billing-track" cx="60" cy="60" r="50"/><circle class="billing-value" cx="60" cy="60" r="50" pathLength="100" stroke-dasharray="${progress} ${100-progress}"/></svg><strong>${value.daysLeft??value.days}<small>${label}</small></strong></div>`;
}
