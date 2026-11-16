import {billCycle,todayLocal} from './billing.mjs';
export const extraTiles=[['stack','Smart stack',6],['power','Power & electricity',6],['uptime','Service uptime',6],['backups','Backup status',6],['automation','Automation',6],['billingSummary','Billing overview',6]];
export function defaultExperience(){return {layouts:{},appearance:{preset:'original',accent:'#c4f284',font:'system',spacing:12,corners:18,opacity:1},pageAppearance:{},electricity:{rate:null,currency:'MYR'},stack:{items:['cpu','memory','temperatures','fans'],interval:8},kiosk:{enabled:false,interval:30,pages:['overview'],nightStart:22,nightEnd:7,dim:.45,wake:false},alerts:{temperature:85,storage:90,billDays:7}};}
export const pageKey=value=>typeof value==='string'&&/^(overview|usage|billing|custom-[a-zA-Z0-9-]{1,64})$/.test(value);
export function placementsValid(items,ids){
  if(!Array.isArray(items)||items.length>32||new Set(items.map(x=>x?.id)).size!==items.length)return false;
  return items.every((p,i)=>p&&ids.includes(p.id)&&['x','y','w','h'].every(k=>Number.isInteger(p[k]))&&p.x>=0&&p.y>=0&&p.w>=1&&p.h>=1&&p.x+p.w<=12&&p.y+p.h<=6&&!items.slice(0,i).some(q=>p.x<q.x+q.w&&p.x+p.w>q.x&&p.y<q.y+q.h&&p.y+p.h>q.y));
}
export function nextPlacement(items,id){for(let y=0;y<6;y++)for(let x=0;x<=8;x+=4){const p={id,x,y,w:4,h:2};if(placementsValid([...items,p],[...items.map(p=>p.id),id]))return p;}return null;}
export function energySummary(samples,maxGapMs=180000){
  let kwh=0,coveredHours=0;const sorted=[...samples].filter(p=>Number.isFinite(p.time)&&Number.isFinite(p.watts)&&p.watts>=0).sort((a,b)=>a.time-b.time);
  for(let i=1;i<sorted.length;i++){const a=sorted[i-1],b=sorted[i],gap=b.time-a.time;if(gap<=0||gap>maxGapMs)continue;const hours=gap/3600000;coveredHours+=hours;kwh+=(a.watts+b.watts)/2/1000*hours;}return {kwh,coveredHours};
}
export function billingTotals(bills,today=todayLocal()){
  const currencies={};for(const b of bills){const c=billCycle(b,today);const total=currencies[b.currency]??={monthly:0,yearly:0};total.monthly+=c.monthly;total.yearly+=c.yearly;}
  return {currencies,upcoming:bills.map(b=>({...b,...billCycle(b,today)})).sort((a,b)=>a.daysLeft-b.daysLeft)};
}
export function healthAlerts(stats,bills,limits,now=Date.now()){
  const alerts=[];if(!stats)alerts.push({level:'info',text:'Waiting for host metrics'});
  else{
    if(now-Date.parse(stats.updatedAt)>90000)alerts.push({level:'warning',text:'Host metrics are stale'});
    for(const n of stats.nodes||[])if(n.status!=='online')alerts.push({level:'danger',text:n.node+' offline'});
    for(const s of stats.sensors?.temperatures||[])if(s.celsius>=(s.warningCelsius??limits.temperature))alerts.push({level:'warning',text:s.label+': '+s.celsius.toFixed(1)+' °C'});
    for(const s of stats.storage||[])if(s.total>0&&s.used/s.total*100>=limits.storage)alerts.push({level:'warning',text:s.storage+' storage '+Math.round(s.used/s.total*100)+'%'});
    if(stats.errors?.length)alerts.push({level:'warning',text:'Some host metrics are unavailable'});
  }
  for(const b of billingTotals(bills).upcoming)if(b.daysLeft<=limits.billDays)alerts.push({level:'info',text:b.name+' due '+(b.daysLeft?'in '+b.daysLeft+'d':'today')});return alerts;
}
