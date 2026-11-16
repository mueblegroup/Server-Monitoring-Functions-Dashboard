const histories=new Map();
export function sampleTrend(key,time,value){
  const points=histories.get(key)||[];
  if(Number.isFinite(time)&&Number.isFinite(value)&&!points.some(p=>p.time===time))points.push({time,value});
  const recent=points.filter(p=>p.time>=time-1800).sort((a,b)=>a.time-b.time).slice(-360);histories.set(key,recent);return recent;
}
export function sparkline(points,label,ceiling){
  const values=points.filter(p=>Number.isFinite(p.time)&&Number.isFinite(p.value)).sort((a,b)=>a.time-b.time);
  if(values.length<2)return '<div class="trend-empty">Collecting history...</div>';
  const start=values[0].time,duration=values.at(-1).time-start;if(duration<=0)return '<div class="trend-empty">Collecting history...</div>';
  const max=ceiling||Math.max(1,...values.map(p=>p.value))*1.15;
  const coords=values.map(p=>`${((p.time-start)/duration*400).toFixed(1)},${(76-Math.max(0,Math.min(1,p.value/max))*70).toFixed(1)}`);
  const safeLabel=String(label).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  return `<svg class="metric-trend" viewBox="0 0 400 80" preserveAspectRatio="none" role="img" aria-label="${safeLabel}"><path class="trend-fill" d="M${coords.join(' L')} L400,80 L0,80 Z"/><path class="trend-line" d="M${coords.join(' L')}"/></svg>`;
}
