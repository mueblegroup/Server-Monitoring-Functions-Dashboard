import {collectHostSensors} from './services.mjs';
import {energySummary} from './public/experience-data.mjs';
const problem=message=>Object.assign(Error(message),{status:400});
export function configuredTargets(raw,actions=false){
  let values;try{values=JSON.parse(raw||'[]');}catch{throw problem('Invalid monitoring configuration');}
  if(!Array.isArray(values)||values.length>30)throw problem('Too many configured targets');
  const ids=new Set();return values.map(t=>{
    if(!t||typeof t.id!=='string'||!/^[-\w]{1,64}$/.test(t.id)||ids.has(t.id)||typeof t.name!=='string'||!t.name.trim()||t.name.length>80)throw problem('Invalid monitoring target');ids.add(t.id);
    let url;try{url=new URL(t.url);}catch{throw problem('Invalid target URL');}
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash)throw problem('Invalid target URL');
    if(t.token!==undefined&&(typeof t.token!=='string'||/[\r\n]/.test(t.token)))throw problem('Invalid target token');
    if(actions){if(t.callbackToken!==undefined&&(typeof t.callbackToken!=='string'||t.callbackToken.length<24))throw problem('Callback tokens need 24 characters');return {id:t.id,name:t.name,url:url.href,token:t.token,callbackToken:t.callbackToken};}
    const interval=t.intervalSeconds??60,expected=t.expectedStatus??200;
    if(!Number.isInteger(interval)||interval<30||interval>3600||!Number.isInteger(expected)||expected<100||expected>599)throw problem('Invalid monitor interval or status');
    return {id:t.id,name:t.name,url:url.href,token:t.token,intervalSeconds:interval,expectedStatus:expected};
  });
}
export function createMonitoring(db,{fetcher=fetch,sensors=collectHostSensors,clock=Date.now}={}){
  db.exec(`CREATE TABLE IF NOT EXISTS monitor_checks(target TEXT,time INTEGER,ok INTEGER,ms REAL,status INTEGER,PRIMARY KEY(target,time));
  CREATE TABLE IF NOT EXISTS power_samples(node TEXT,time INTEGER,watts REAL,source TEXT,PRIMARY KEY(node,time));
  CREATE TABLE IF NOT EXISTS automation_results(id TEXT PRIMARY KEY,time INTEGER,status TEXT,summary TEXT);
  CREATE INDEX IF NOT EXISTS monitor_check_time ON monitor_checks(time);
  CREATE INDEX IF NOT EXISTS power_sample_time ON power_samples(time);`);
  let timer,busy=false,stopped=false;const inFlight=new Set();
  const targets=()=>configuredTargets(process.env.ORBIT_MONITORS||JSON.stringify([{id:'orbit',name:'Orbit',url:'http://127.0.0.1:'+(process.env.PORT||3000)+'/'}]));
  const actions=()=>configuredTargets(process.env.ORBIT_AUTOMATIONS,true);
  async function check(t){const started=clock();let ok=false,status=null;try{const r=await fetcher(t.url,{headers:t.token?{Authorization:'Bearer '+t.token}:{},redirect:'manual',signal:AbortSignal.timeout(8000)});status=r.status;ok=status===t.expectedStatus;await r.body?.cancel();}catch{}if(stopped)return;db.prepare('INSERT OR REPLACE INTO monitor_checks VALUES(?,?,?,?,?)').run(t.id,started,ok?1:0,Math.max(0,clock()-started),status);}
  async function tick(){if(busy||stopped)return;busy=true;try{
    let ts=[];try{ts=targets();}catch{}
    // Small sequential batches bound outbound requests and keep one failing service isolated.
    const due=ts.filter(t=>{const last=db.prepare('SELECT time FROM monitor_checks WHERE target=? ORDER BY time DESC LIMIT 1').get(t.id);return !last||clock()-last.time>=t.intervalSeconds*1000;});
    for(let i=0;i<due.length&&!stopped;i+=5)await Promise.allSettled(due.slice(i,i+5).map(check));
    if(process.env.PROXMOX_SENSORS_URL&&process.env.PROXMOX_SENSORS_TOKEN){try{const s=await sensors();if(!stopped&&Number.isFinite(s.watts))db.prepare('INSERT OR REPLACE INTO power_samples VALUES(?,?,?,?)').run(s.node,clock(),s.watts,s.powerSource||'Host meter');}catch{}}
    if(!stopped){const cutoff=clock()-30*86400000;db.prepare('DELETE FROM monitor_checks WHERE time<?').run(cutoff);db.prepare('DELETE FROM power_samples WHERE time<?').run(cutoff);}
  }finally{busy=false;}}
  function status(){let ts=[],as=[],configurationError=false;try{ts=targets();as=actions();}catch{configurationError=true;}
    return {configurationError,monitors:ts.map(t=>{const history=db.prepare('SELECT time,ok,ms,status FROM monitor_checks WHERE target=? ORDER BY time DESC LIMIT 1440').all(t.id).reverse();const latest=history.at(-1)||null;const outages=[];let outage=null;for(const p of history){if(!p.ok&&!outage){outage={startedAt:p.time,endedAt:null};outages.push(outage);}if(p.ok&&outage){outage.endedAt=p.time;outage=null;}}return {id:t.id,name:t.name,intervalSeconds:t.intervalSeconds,latest,history,passingPercent:history.length?history.filter(h=>h.ok).length/history.length*100:null,outages:outages.slice(-20)};}),actions:as.map(a=>({id:a.id,name:a.name,result:db.prepare('SELECT time,status,summary FROM automation_results WHERE id=?').get(a.id)||null}))};
  }
  function power(node){const resolved=node||db.prepare('SELECT node FROM power_samples ORDER BY time DESC LIMIT 1').get()?.node;if(!resolved)return {node:null,latest:null,history:[],observed:energySummary([])};
    const history=db.prepare('SELECT time,watts,source FROM power_samples WHERE node=? AND time>=? ORDER BY time').all(resolved,clock()-30*86400000);return {node:resolved,latest:history.at(-1)||null,history:history.filter(p=>p.time>=clock()-86400000),observed:energySummary(history),since:history[0]?.time??null};
  }
  function record(id,value){if(!['running','success','failed'].includes(value?.status)||typeof value.summary!=='string'||value.summary.length>500)throw problem('Invalid workflow result');db.prepare('INSERT OR REPLACE INTO automation_results VALUES(?,?,?,?)').run(id,clock(),value.status,value.summary);}
  async function run(id){const action=actions().find(x=>x.id===id);if(!action)throw problem('Unknown workflow');if(inFlight.has(id))throw Object.assign(Error('Workflow request is already running'),{status:409});inFlight.add(id);record(id,{status:'running',summary:'Sending workflow request; awaiting completion callback.'});
    try{const r=await fetcher(action.url,{method:'POST',redirect:'manual',headers:{'Content-Type':'application/json',...(action.token?{Authorization:'Bearer '+action.token}:{})},body:JSON.stringify({source:'orbit',action:id,requestedAt:new Date(clock()).toISOString()}),signal:AbortSignal.timeout(15000)});await r.body?.cancel();if(!r.ok)throw Error('Workflow endpoint rejected the request');return {accepted:true};}
    catch{if(db.prepare('SELECT status FROM automation_results WHERE id=?').get(id)?.status==='running')record(id,{status:'failed',summary:'Request failed or timed out. Check workflow history before trying again.'});throw Object.assign(Error('Workflow request failed. Its execution status may be unknown; check n8n before retrying.'),{status:424});}finally{inFlight.delete(id);}
  }
  return {tick,status,power,record,run,callbackTarget:id=>actions().find(a=>a.id===id),start(){stopped=false;timer=setInterval(tick,30000);timer.unref();tick();},stop(){stopped=true;clearInterval(timer);}};
}
