const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const gaugeDefaults=()=>({cpu:'#2ad4bc',memory:'#a78bfa',temperature:'#f6ac38',fan:'#78c9ed',health:'#a3d94c',temperatureMax:120,fanMaxRpm:12000});
export function rpmGauge(value,{label='',unit='%',max=100,color='#c4f284',digits=0}={}){
  const valid=typeof value==='number'&&Number.isFinite(value),safeColor=/^#[0-9a-f]{6}$/i.test(color)?color:'#c4f284',limit=Number.isFinite(max)&&max>0?max:100;
  const fraction=valid?Math.max(0,Math.min(1,value/limit)):0,angle=-135+fraction*270;
  return `<div class="rpm-gauge" role="img" aria-label="${esc(label)}: ${valid?esc(value.toFixed(digits)+' '+unit):'unavailable'}"><svg viewBox="0 0 140 125" aria-hidden="true"><circle class="rpm-track" cx="70" cy="70" r="53" pathLength="100" stroke-dasharray="75 25" transform="rotate(135 70 70)"/><circle class="rpm-arc" cx="70" cy="70" r="53" pathLength="100" stroke="${safeColor}" stroke-dasharray="${fraction*75} ${100-fraction*75}" transform="rotate(135 70 70)"/>${[0,1,2,3,4,5,6].map(i=>`<path class="rpm-tick" d="M70 10v5" transform="rotate(${-135+i*45} 70 70)"/>`).join('')}<path class="rpm-needle" d="M70 12v12" stroke="${safeColor}" transform="rotate(${angle} 70 70)"/></svg><div class="rpm-reading"><strong>${valid?esc(value.toFixed(digits)):'—'}</strong><span>${esc(unit)}</span></div><div class="rpm-label">${esc(label)}</div></div>`;
}
export function hostGauges(data,colors=gaugeDefaults()){
  const s=data?.stats,temps=data?.sensors?.temperatures||[],fans=data?.sensors?.fans||[],rpm=fans.filter(f=>Number.isFinite(f.rpm));
  const cpu=Number.isFinite(s?.cpu)?s.cpu*100:null,memory=s?.memory?.total>0?s.memory.used/s.memory.total*100:null,disk=s?.rootfs?.total>0?s.rootfs.used/s.rootfs.total*100:null,temp=temps.length?Math.max(...temps.map(t=>t.celsius)):null,fan=rpm.length?Math.max(...rpm.map(f=>f.rpm)):fans.length?Math.max(...fans.map(f=>f.percent)):null;
  return rpmGauge(cpu,{label:'CPU',color:colors.cpu})+rpmGauge(memory,{label:'RAM',color:colors.memory})+rpmGauge(temp,{label:'Temperature',unit:'°C',max:colors.temperatureMax,color:colors.temperature})+rpmGauge(fan,{label:'Fan speed',unit:rpm.length?'RPM':'%',max:rpm.length?colors.fanMaxRpm:100,color:colors.fan})+rpmGauge(disk,{label:'Root disk',color:colors.health});
}
