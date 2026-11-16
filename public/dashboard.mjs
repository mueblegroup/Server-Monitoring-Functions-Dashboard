import {sampleTrend,sparkline} from './trends.mjs';
const definitions=[['cpu','CPU usage',4],['memory','Memory & swap',4],['health','Server health',4],['storage','Storage pools',6],['guests','Containers & VMs',6],['clock','Clock',4],['weather','Weather',4],['infrastructure','Infrastructure',4],['network','Network',6],['music','Music',6],['stripe','Stripe events',4],['movies','Movies',4],['launch','Quick launch',4]];
const front=['clock','music','cpu','memory','health','network'];
export const defaultLayout=()=>({node:'',refresh:30,musicPlaylist:'',cockpitVersion:1,widgets:[...front.map(id=>definitions.find(d=>d[0]===id)),...definitions.filter(d=>!front.includes(d[0]))].map(([id,,width])=>({id,width,visible:true}))});
export function playlistId(input){
  const value=String(input||'').trim();if(!value)return '';
  if(/^[-\w]{8,150}$/.test(value))return value;
  try{const url=new URL(value);if(url.protocol!=='https:'||!['youtube.com','www.youtube.com','music.youtube.com','youtu.be'].includes(url.hostname))throw Error();const id=url.searchParams.get('list');if(/^[-\w]{8,150}$/.test(id||''))return id;}catch{}
  throw Error('Paste a YouTube or YouTube Music playlist link containing list=, or a playlist ID.');
}
const numeric=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
const bytes=value=>numeric(value)?`${(Number(value)/1073741824).toFixed(1)} GiB`:'Unavailable';
const percent=(used,total)=>numeric(used)&&numeric(total)&&Number(total)>0?Math.min(100,Math.max(0,Number(used)/Number(total)*100)):null;
const uptime=value=>{if(!numeric(value))return 'Unavailable';const h=Math.floor(Number(value)/3600);return `${Math.floor(h/24)}d ${h%24}h`;};
export function mountDashboard({api,esc,connected,demo,openModal,toast}){
  const grid=document.querySelector('#app > .grid');
  if(!grid)return ()=>{};
  let active=true,timer,networkTimer,networkBusy=false,busy=false,layout=defaultLayout(),latest=null,lastSuccess=null,saving=false;
  const cards=new Map();
  const existing=['clock','weather','infrastructure','network','music','stripe','movies','launch'];
  [...grid.children].forEach((el,index)=>{el.dataset.widget=existing[index];cards.set(existing[index],el);});
  const weather=cards.get('weather').querySelector('#weather');
  if(weather){weather.classList.add('cockpit-weather');cards.get('clock').append(weather);cards.get('weather').innerHTML='<div class="card-head"><h2>Weather</h2></div><p>Local conditions appear beside the clock on the first screen.</p>';}
  if(!demo){cards.get('network').innerHTML='<div class="card-head"><h2>Network pulse</h2><span class="label">PFSENSE</span></div><div id="network-metrics"><p>Connect pfSense SNMP to see WAN traffic and firewall health.</p></div>';}
  for(const [id,title] of definitions.slice(0,5)){
    const el=document.createElement('section');el.className='card span4';el.dataset.widget=id;
    el.innerHTML=`<div class="card-head"><h2>${title}</h2><span class="label">PROXMOX</span></div><div class="host-metric">${connected('proxmox')?'Loading metrics...':'Connect Proxmox to see host metrics.'}</div>`;
    cards.set(id,el);grid.append(el);
  }
  const toolbar=document.createElement('section');toolbar.className='dashboard-toolbar';
  toolbar.innerHTML='<div><span class="eyebrow">YOUR DASHBOARD</span><p class="subtle" id="metrics-updated">Host metrics refresh automatically while this page is visible.</p></div><div class="dashboard-controls"><label>Server<select id="dashboard-node" aria-label="Proxmox server"><option value="">Auto select</option></select></label><button type="button" class="small-button" id="dashboard-refresh">Refresh stats</button><button type="button" class="primary" id="dashboard-customize">Customize</button></div>';
  grid.before(toolbar);
  const nodeSelect=toolbar.querySelector('select'),updated=toolbar.querySelector('#metrics-updated');
  const apply=()=>{
    for(const widget of layout.widgets){const el=cards.get(widget.id);if(!el)continue;el.hidden=!widget.visible;el.classList.remove('span3','span4','span5','span6','span7','span8','span12');el.classList.add(`span${widget.width}`);grid.append(el);}
    if(!layout.widgets.some(w=>w.visible))updated.textContent='All widgets are hidden. Choose Customize to add them back.';
  };
  function music(){
    const card=cards.get('music');card.innerHTML=`<div class="card-head"><h2>YouTube Music</h2><button type="button" class="small-button" id="connect-music">${layout.musicPlaylist?'Change playlist':'Connect playlist'}</button></div><div id="music-player"></div><a class="subtle" href="https://music.youtube.com/" target="_blank" rel="noreferrer">Open YouTube Music</a>`;
    const player=card.querySelector('#music-player');
    if(layout.musicPlaylist){const frame=document.createElement('iframe');frame.src='https://www.youtube-nocookie.com/embed/videoseries?'+new URLSearchParams({list:layout.musicPlaylist,playsinline:'1',autoplay:'0'});frame.title='YouTube playlist player';frame.allow='encrypted-media; fullscreen; picture-in-picture';frame.allowFullscreen=true;frame.referrerPolicy='strict-origin-when-cross-origin';frame.className='music-player';player.append(frame);}
    else player.innerHTML='<p>Your music, on the first screen.</p><p class="subtle">Connect a public or unlisted playlist to play here. No API key required.</p>';
    card.querySelector('#connect-music').onclick=()=>{
      openModal('<h1>Connect your playlist</h1><p>In YouTube Music, open a playlist, choose Share, then Copy link. Use a public or unlisted playlist.</p><form id="music-connect-form"><label>Playlist link or ID<input name="playlist" placeholder="https://music.youtube.com/playlist?list=..."></label><p class="subtle">This uses the YouTube embedded player. It does not sign into your YouTube Music account. Some tracks or playlists may not allow embedded playback.</p><button class="primary" type="submit">Save playlist</button><p class="error" role="alert"></p></form>');
      const form=document.querySelector('#music-connect-form');form.elements.playlist.value=layout.musicPlaylist||'';
      form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('button');button.disabled=true;try{const id=playlistId(form.elements.playlist.value);await save({...layout,musicPlaylist:id,widgets:[{...layout.widgets.find(w=>w.id==='music'),visible:true},...layout.widgets.filter(w=>w.id!=='music')]});if(active){music();form.closest('dialog').close();toast('Playlist saved. Press Play to start.');}}catch(error){form.querySelector('.error').textContent=error.message;}finally{button.disabled=false;}};
    };
  }
  const meter=(value)=>value===null?'':`<progress class="host-progress" max="100" value="${value.toFixed(1)}" aria-label="Usage ${value.toFixed(1)} percent"></progress>`;
  async function refreshNetwork(){
    if(!active||demo||networkBusy||document.hidden||cards.get('network').hidden||!connected('pfsense'))return;
    networkBusy=true;
    try{
      const {data}=await api('pfsense');if(!active)return;
      const rate=value=>numeric(value)?Number(value).toFixed(2):'--';
      const body=cards.get('network').querySelector('#network-metrics');
      body.innerHTML=`<div class="flex"><span class="mono">${esc(data.interface||'WAN')}</span><span class="status ${data.interfaceStatus==='up'?'':'off'}">${esc(data.interfaceStatus||'Connected')}</span></div><div class="network-values"><div><span class="subtle">Download</span><div class="metric mono">${rate(data.downloadMbps)}<small>Mbps</small></div></div><div><span class="subtle">Upload</span><div class="metric mono">${rate(data.uploadMbps)}<small>Mbps</small></div></div></div>${data.warmingUp?'<p class="subtle">Sampling traffic. Rates appear after the next refresh.</p>':''}<dl class="data-list"><dt>CPU (SNMP)</dt><dd>${numeric(data.cpuPercent)?Number(data.cpuPercent).toFixed(1)+'%':'Unavailable'}</dd><dt>Memory</dt><dd>${data.memory?Number(data.memory.percent).toFixed(1)+'% ('+bytes(data.memory.usedBytes)+' / '+bytes(data.memory.totalBytes)+')':'Unavailable'}</dd><dt>Firewall uptime</dt><dd>${uptime(data.uptimeSeconds)}</dd></dl><p class="subtle">${data.updatedAt?'Updated '+esc(new Date(data.updatedAt).toLocaleTimeString()):'Live collector'} &middot; refreshes every 5 seconds</p>`;
      if(data.warnings?.length){const detail=document.createElement('details');detail.innerHTML='<summary>Metric notes</summary>';const text=document.createElement('p');text.textContent=data.warnings.join(' ');detail.append(text);body.append(detail);}
      const trend=sampleTrend('wan:'+(data.interface||'WAN'),data.updatedAt?Date.parse(data.updatedAt)/1000:Date.now()/1000,numeric(data.downloadMbps)?Number(data.downloadMbps):NaN);
      body.insertAdjacentHTML('beforeend',sparkline(trend,'WAN download throughput history')+'<p class="trend-caption">Download history &middot; sampled every 5s</p>');
    }catch(error){if(active){const body=cards.get('network').querySelector('#network-metrics');body.textContent='Network metrics unavailable: '+error.message;}}
    finally{networkBusy=false;}
  }
  const set=(id,html)=>{cards.get(id).querySelector('.host-metric').innerHTML=html;};
  function show(data){
    latest=data;const s=data.stats,selected=data.nodes.find(n=>n.node===data.node),online=selected?.status==='online';
    const clockStatus=cards.get('clock').querySelector('.status');if(clockStatus)clockStatus.textContent=`${data.node||'No host'} · ${online?'Online':'Offline'}`;
    const options=data.nodes.map(n=>`<option value="${esc(n.node)}">${esc(n.node)}${n.status==='online'?'':' (offline)'}</option>`).join('');
    nodeSelect.innerHTML=options||'<option value="">No servers found</option>';nodeSelect.value=data.node||'';
    if(!s){for(const id of ['cpu','memory','health'])set(id,`<p>${online?'Host metrics unavailable.':selected?'Server offline.':'No servers found.'}</p>`);}
    else{
      const cpu=percent(s.cpu,1),memory=percent(s.memory?.used,s.memory?.total),swap=percent(s.swap?.used,s.swap?.total);
      set('cpu',`<div class="metric mono">${cpu===null?'Unavailable':cpu.toFixed(1)+'<small>%</small>'}</div>${meter(cpu)}<p>${esc(s.cpuinfo?.cpus??selected?.maxcpu??'Unknown')} logical CPUs</p><p class="subtle">${esc(s.cpuinfo?.model||'')}</p>`);
      set('memory',`<div class="metric mono">${memory===null?'Unavailable':memory.toFixed(1)+'<small>%</small>'}</div>${meter(memory)}<p>${bytes(s.memory?.used)} / ${bytes(s.memory?.total)}</p><div class="divider"></div><div class="flex"><span class="subtle">Swap</span><strong>${Number(s.swap?.total)===0?'Disabled':swap===null?'Unavailable':swap.toFixed(1)+'%'}</strong></div><p class="subtle">${bytes(s.swap?.used)} / ${bytes(s.swap?.total)}</p>`);
      const disk=percent(s.rootfs?.used,s.rootfs?.total);
      set('health',`<div class="metric mono">${disk===null?'--':disk.toFixed(1)}<small>% disk</small></div><p class="subtle">${esc(data.node)} &middot; uptime ${uptime(s.uptime)}</p><dl class="data-list host-details"><dt>Load (1 / 5 / 15 min)</dt><dd>${esc(Array.isArray(s.loadavg)?s.loadavg.join(' / '):'Unavailable')}</dd><dt>Proxmox</dt><dd>${esc(s.pveversion||'Unavailable')}</dd><dt>Root filesystem</dt><dd>${bytes(s.rootfs?.used)} / ${bytes(s.rootfs?.total)}</dd></dl>`);
      const at=Date.parse(data.updatedAt)/1000;
      for(const [id,field,value] of [['cpu','cpu',cpu],['memory','memory',memory],['health','disk',disk]]){
        let history=(data.history||[]).map(p=>({time:p.time,value:field==='cpu'&&Number.isFinite(p.cpu)?p.cpu*100:field==='memory'?percent(p.memused,p.memtotal):field==='disk'?percent(p.rootused,p.roottotal):null})).filter(p=>Number.isFinite(p.value));
        const sampled=sampleTrend(`${id}:${data.node}`,at,value===null?NaN:value);if(history.length<2)history=sampled;
        cards.get(id).querySelector('.host-metric').insertAdjacentHTML('beforeend',sparkline(history,`${id} usage history`,100)+`<p class="trend-caption">${(data.history||[]).length>1?'Last hour &middot; Proxmox':'Live samples since opening'}</p>`);
      }
    }
    if(s){
      const temperatures=data.sensors?.temperatures||[],fans=data.sensors?.fans||[];
      const temp=temperatures.length?Math.max(...temperatures.map(r=>r.celsius)).toFixed(1)+' °C':'--';
      const fan=fans.length?Math.max(...fans.map(r=>r.rpm)).toFixed(0)+' RPM':'--';
      const badges=document.createElement('div');badges.className='sensor-badges';
      badges.innerHTML=`<button type="button" class="sensor-badge" aria-label="Server temperatures" title="Highest reported temperature">&#127777; ${temp}</button><button type="button" class="sensor-badge" aria-label="Server fan speeds" title="Highest reported fan speed">&#10051; ${fan}</button>`;
      badges.onclick=()=>openModal(`<h2>Hardware sensors</h2><p class="subtle">${esc(data.node)} &middot; Readings from the physical host</p>${temperatures.length||fans.length?`<dl class="data-list">${temperatures.map(r=>`<dt>${esc(r.label)}</dt><dd>${r.celsius.toFixed(1)} °C</dd>`).join('')}${fans.map(r=>`<dt>${esc(r.label)}</dt><dd>${r.rpm.toFixed(0)} RPM</dd>`).join('')}</dl>`:'<p>No sensor readings available. Configure the host sensor collector described in the README. Fan readings require hardware and drivers that expose RPM.</p>'}`);
      cards.get('health').querySelector('.host-metric').append(badges);
    }
    set('storage',Array.isArray(data.storage)&&data.storage.length?data.storage.map(pool=>{
      const usage=percent(pool.used,pool.total),available=pool.active===1||pool.active===true;
      return `<div class="storage-pool"><div class="flex"><strong>${esc(pool.storage)}</strong><span class="status ${available?'':'off'}">${available?'Active':'Inactive'}</span></div><p>${bytes(pool.used)} / ${bytes(pool.total)}${usage===null?'':' ('+usage.toFixed(1)+'%)'}</p>${meter(usage)}<p class="subtle">${esc(pool.type||'Storage')}</p></div>`;
    }).join(''):'<p>No storage metrics available.</p>');
    const guests=data.guests||[],running=guests.filter(g=>g.status==='running').length;
    set('guests',`<div class="guest-totals"><div><strong>${running}</strong><span>Running</span></div><div><strong>${guests.filter(g=>g.status==='stopped').length}</strong><span>Stopped</span></div><div><strong>${guests.filter(g=>g.type==='lxc').length}</strong><span>CTs</span></div><div><strong>${guests.filter(g=>g.type==='qemu').length}</strong><span>VMs</span></div></div><p class="subtle">${esc(data.node||'No server selected')} &middot; ${guests.length} guests total</p><a class="small-button" href="#proxmox">Manage containers & VMs</a>`);
    const stamp=new Date(data.updatedAt).toLocaleTimeString();
    updated.textContent=demo?'Sample metrics - demo only':`Updated ${stamp}${data.errors?.length?' - Some metrics unavailable':''}`;
    if(data.errors?.length){const detail=document.createElement('details');detail.innerHTML='<summary>Metric connection details</summary>';const p=document.createElement('p');p.textContent=data.errors.join(' | ');detail.append(p);cards.get('health').querySelector('.host-metric').append(detail);}
  }
  const sample=()=>({nodes:[{node:'demo-node',status:'online',maxcpu:8}],node:'demo-node',stats:{cpu:.24,cpuinfo:{cpus:8,model:'Example host CPU'},memory:{used:18*1073741824,total:32*1073741824},swap:{used:0,total:4*1073741824},rootfs:{used:30*1073741824,total:100*1073741824},uptime:918000,loadavg:['1.2','0.9','0.8'],pveversion:'Demo'},storage:[{storage:'local-lvm',active:1,type:'lvmthin',used:200*1073741824,total:500*1073741824}],guests:[{type:'lxc',status:'running'},{type:'qemu',status:'stopped'}],errors:[],updatedAt:new Date().toISOString()});
  async function refresh(){
    if(!active||busy||document.hidden)return;
    if(demo){show(sample());return;}
    if(!connected('proxmox')){updated.textContent='Connect Proxmox to enable live server statistics.';return;}
    const requestedNode=layout.node;
    busy=true;toolbar.querySelector('#dashboard-refresh').disabled=true;
    try{const result=await api('proxmox?'+new URLSearchParams({view:'stats',history:'1',...(requestedNode?{node:requestedNode}:{})}));if(active&&requestedNode===layout.node){show(result.data);lastSuccess=Date.now();}}
    catch(error){if(active){updated.textContent=`${lastSuccess?'Stats are stale. ':''}${error.message}`;if(!lastSuccess)for(const id of ['cpu','memory','health','storage','guests'])set(id,'<p>Metrics unavailable. See the connection message above.</p>');}}
    finally{busy=false;if(active){toolbar.querySelector('#dashboard-refresh').disabled=false;if(requestedNode!==layout.node)refresh();}}
  }
  function schedule(){clearInterval(timer);if(!demo&&layout.refresh)timer=setInterval(refresh,layout.refresh*1000);}
  async function save(next){
    if(demo){layout=next;apply();schedule();return;}
    layout=await api('dashboard',{method:'POST',body:JSON.stringify(next)});if(active){apply();schedule();}
  }
  toolbar.querySelector('#dashboard-refresh').onclick=()=>{refresh();refreshNetwork();};
  nodeSelect.onchange=async()=>{
    const previous=layout.node;
    try{await save({...layout,node:nodeSelect.value});lastSuccess=null;await refresh();}
    catch(error){layout.node=previous;nodeSelect.value=previous||latest?.node||'';toast(error.message);}
  };
  toolbar.querySelector('#dashboard-customize').onclick=()=>{
    let draft=structuredClone(layout);
    openModal('<div class="eyebrow">MAKE IT YOURS</div><h1>Customize dashboard</h1><p>Show, resize, and reorder your widgets. Layout follows your account across devices.</p><form id="dashboard-layout-form"><div id="dashboard-layout-list"></div><label class="dashboard-refresh-label">Refresh host stats<select name="refresh"><option value="0">Manually</option><option value="15">Every 15 seconds</option><option value="30">Every 30 seconds</option><option value="60">Every 60 seconds</option></select></label><div class="actions"><button class="primary" type="submit">Save layout</button><button class="small-button" type="button" id="dashboard-reset">Reset layout</button></div><p class="error" role="alert"></p></form>');
    const form=document.querySelector('#dashboard-layout-form'),list=form.querySelector('#dashboard-layout-list');form.elements.refresh.value=String(draft.refresh);
    const paint=()=>{list.innerHTML=draft.widgets.map((w,i)=>`<div class="layout-widget"><label class="check"><input type="checkbox" data-id="${w.id}" ${w.visible?'checked':''}>${definitions.find(d=>d[0]===w.id)[1]}</label><div class="layout-widget-controls"><select aria-label="${definitions.find(d=>d[0]===w.id)[1]} width" data-width="${w.id}"><option value="4" ${w.width===4?'selected':''}>Compact</option><option value="6" ${w.width===6?'selected':''}>Half width</option><option value="12" ${w.width===12?'selected':''}>Full width</option></select><button type="button" class="small-button" data-move="${i}" data-direction="-1" aria-label="Move ${w.id} up" ${i===0?'disabled':''}>Up</button><button type="button" class="small-button" data-move="${i}" data-direction="1" aria-label="Move ${w.id} down" ${i===draft.widgets.length-1?'disabled':''}>Down</button></div></div>`).join('');};paint();
    list.onchange=e=>{const w=draft.widgets.find(w=>w.id===(e.target.dataset.id||e.target.dataset.width));if(w){if(e.target.dataset.id)w.visible=e.target.checked;else w.width=Number(e.target.value);}};
    list.onclick=e=>{const button=e.target.closest('button[data-move]');if(!button)return;const i=Number(button.dataset.move),j=i+Number(button.dataset.direction);[draft.widgets[i],draft.widgets[j]]=[draft.widgets[j],draft.widgets[i]];paint();list.querySelector(`[data-move="${j}"][data-direction="${button.dataset.direction}"]`)?.focus();};
    form.querySelector('#dashboard-reset').onclick=()=>{draft={...defaultLayout(),musicPlaylist:layout.musicPlaylist||''};form.elements.refresh.value='30';paint();};
    form.onsubmit=async e=>{e.preventDefault();if(saving||!active)return;saving=true;const button=form.querySelector('[type=submit]');button.disabled=true;try{draft.refresh=Number(form.elements.refresh.value);await save(draft);if(active){form.closest('dialog').close();toast(demo?'Demo layout updated for this visit.':'Dashboard layout saved.');lastSuccess=null;refreshNetwork();await refresh();}}catch(error){form.querySelector('.error').textContent=error.message;}finally{saving=false;button.disabled=false;}};
  };
  const onVisible=()=>{if(!document.hidden){refresh();refreshNetwork();}};document.addEventListener('visibilitychange',onVisible);
  (async()=>{try{if(!demo){const stored=await api('dashboard');if(!active)return;if(Array.isArray(stored.widgets)&&stored.widgets.length===definitions.length){layout=stored;if(layout.musicPlaylist===undefined)layout.musicPlaylist='';if(layout.cockpitVersion!==1){layout.cockpitVersion=1;layout.widgets=[...front.map(id=>({...layout.widgets.find(w=>w.id===id),visible:true})),...layout.widgets.filter(w=>!front.includes(w.id))];}}}}catch(error){if(active)toast('Could not load saved layout: '+error.message);}if(active){music();apply();schedule();refresh();refreshNetwork();if(!demo)networkTimer=setInterval(refreshNetwork,5000);}})();
  return ()=>{active=false;clearInterval(timer);clearInterval(networkTimer);document.removeEventListener('visibilitychange',onVisible);};
}
