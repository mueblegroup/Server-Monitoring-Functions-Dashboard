import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
const failure=message=>Object.assign(new Error(message),{status:424});
const finite=value=>typeof value==='number'&&Number.isFinite(value);
export function normalizeUsage(result){
  const bucket=result?.rateLimitsByLimitId?.codex||result?.rateLimits;
  if(!bucket||typeof bucket!=='object')throw failure('Codex returned no account usage limits. Sign in with your ChatGPT account.');
  const windows=['primary','secondary'].map(key=>{
    const window=bucket[key];if(!window||!finite(window.usedPercent))return null;
    const usedPercent=Math.max(0,Math.min(100,window.usedPercent));
    return {id:key,usedPercent,remainingPercent:100-usedPercent,durationMinutes:finite(window.windowDurationMins)?window.windowDurationMins:null,resetsAt:finite(window.resetsAt)?window.resetsAt:null};
  }).filter(Boolean);
  return {provider:'OpenAI Codex',plan:typeof bucket.planType==='string'?bucket.planType.slice(0,40):null,windows,updatedAt:new Date().toISOString()};
}
export function readCodexUsage(start=spawn){
  return new Promise((resolve,reject)=>{
    let child,reader,settled=false,received=0;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);reader?.close();child?.stdin?.end();child?.kill();error?reject(error):resolve(value);};
    const timer=setTimeout(()=>finish(failure('Codex usage request timed out. Check the CLI login and connection.')),20000);
    try{
      child=start(process.env.CODEX_BIN||'codex',['app-server'],{stdio:['pipe','pipe','pipe'],windowsHide:true});
      child.on('error',()=>finish(failure('Codex CLI is unavailable. Install @openai/codex and sign in as the user running Orbit.')));
      child.on('exit',()=>finish(failure('Codex usage connection closed. Run codex login --device-auth as the Orbit service user.')));
      child.stdin.on('error',()=>finish(failure('Codex usage connection could not be initialized.')));
      child.stderr.resume();
      const send=message=>child.stdin.write(JSON.stringify(message)+'\n');
      reader=createInterface({input:child.stdout});
      reader.on('line',line=>{
        received+=line.length;if(received>1048576){finish(failure('Codex usage response was too large.'));return;}
        let message;try{message=JSON.parse(line);}catch{return;}
        if(message.id!==1&&message.id!==2)return;
        if(message.error){finish(failure('Codex could not read ChatGPT usage limits. Run codex login --device-auth and verify your subscription.'));return;}
        if(message.id===1){send({method:'initialized',params:{}});send({id:2,method:'account/rateLimits/read'});}
        if(message.id===2){try{finish(null,normalizeUsage(message.result));}catch(error){finish(error);}}
      });
      send({id:1,method:'initialize',params:{clientInfo:{name:'orbit_usage',title:'Orbit usage dashboard',version:'0.1.0'}}});
    }catch{finish(failure('Unable to start the Codex usage reader. Check CODEX_BIN.'));}
  });
}
let cached=null,pending=null;
export async function codexUsage(){
  if(process.env.CODEX_USAGE_ENABLED!=='true')return {provider:'OpenAI Codex',configured:false,windows:[]};
  if(cached&&Date.now()-cached.time<60000)return cached.value;
  if(!pending)pending=readCodexUsage().then(value=>{cached={time:Date.now(),value:{configured:true,...value}};return cached.value;}).finally(()=>{pending=null;});
  return pending;
}
