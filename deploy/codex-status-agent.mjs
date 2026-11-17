import {readCodexActivity} from '../codex-activity.mjs';
const destination=new URL(process.env.ORBIT_ACTIVITY_URL||'http://invalid');
const token=process.env.ORBIT_ACTIVITY_TOKEN||'';
if(destination.protocol!=='https:'||destination.username||destination.password||destination.search||destination.hash||token.length<24)throw Error('Set ORBIT_ACTIVITY_URL to your HTTPS Orbit origin and ORBIT_ACTIVITY_TOKEN to its separate 24+ character reporting token.');
let busy=false;
async function report(){if(busy)return;busy=true;try{const sessions=(await readCodexActivity()).filter(s=>Date.now()-Date.parse(s.updatedAt)<30*86400000);const response=await fetch(new URL('/api/agent-events',destination),{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({source:process.env.ORBIT_ACTIVITY_SOURCE||'codex-cli',sessions}),signal:AbortSignal.timeout(10000)});if(!response.ok)console.error('Orbit status report: HTTP '+response.status);}catch{console.error('Unable to report Codex activity. Check Orbit URL and reporting token.');}finally{busy=false;}}
await report();setInterval(report,10000);
