import {opendir,stat,open} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
const kinds={task_started:'working',turn_started:'working',task_complete:'completed',turn_complete:'completed',turn_aborted:'interrupted',task_aborted:'interrupted'};
export function parseActivity(text,fallbackId='session'){
  let id=fallbackId,event=null;
  for(const line of text.split('\n')){let row;try{row=JSON.parse(line);}catch{continue;}
    if(row.type==='session_meta'&&typeof row.payload?.id==='string')id=row.payload.id;
    if(row.type!=='event_msg'||!kinds[row.payload?.type])continue;const timestamp=Date.parse(row.timestamp);if(!Number.isFinite(timestamp))continue;event={status:kinds[row.payload.type],updatedAt:new Date(timestamp).toISOString()};
  }
  return event?{sessionId:String(id).replace(/[^a-zA-Z0-9-]/g,'').slice(0,80)||'session',...event}:null;
}
export async function readCodexActivity(directory=process.env.CODEX_SESSIONS_DIR||join(process.env.CODEX_HOME||join(homedir(),'.codex'),'sessions')){
  const files=[];let visited=0;
  async function walk(path,depth){if(depth>4||visited>3000)return;let dir;try{dir=await opendir(path);}catch{return;}for await(const entry of dir){if(++visited>3000)break;if(entry.isDirectory())await walk(join(path,entry.name),depth+1);else if(entry.isFile()&&entry.name.endsWith('.jsonl')){const file=join(path,entry.name);try{const info=await stat(file);files.push({file,mtime:info.mtimeMs,size:info.size});}catch{}}}}
  await walk(directory,0);files.sort((a,b)=>b.mtime-a.mtime);const sessions=[];
  for(const f of files.slice(0,16)){let handle;try{handle=await open(f.file,'r');const count=Math.min(f.size,131072),buffer=Buffer.alloc(count);await handle.read(buffer,0,count,Math.max(0,f.size-count));const fallback=f.file.match(/([a-f0-9]{8}-[a-f0-9-]{27,})\.jsonl$/i)?.[1]||'session-'+Math.round(f.mtime);const value=parseActivity(buffer.toString('utf8'),fallback);if(value)sessions.push(value);}catch{}finally{await handle?.close();}}
  return sessions;
}
export function validateActivity(body){
  if(!body||typeof body.source!=='string'||!/^[-a-zA-Z0-9]{1,40}$/.test(body.source)||!Array.isArray(body.sessions)||body.sessions.length>16)throw Object.assign(Error('Invalid activity report'),{status:400});
  const sessions=body.sessions.map(s=>{if(!s||typeof s.sessionId!=='string'||!/^[-a-zA-Z0-9]{1,80}$/.test(s.sessionId)||!['working','waiting','completed','interrupted','failed','idle'].includes(s.status)||!Number.isFinite(Date.parse(s.updatedAt))||Math.abs(Date.now()-Date.parse(s.updatedAt))>30*86400000)throw Object.assign(Error('Invalid activity status'),{status:400});return {sessionId:s.sessionId,status:s.status,updatedAt:new Date(s.updatedAt).toISOString()};});return {source:body.source,sessions};
}
export function createActivityStore(db){
  db.exec('CREATE TABLE IF NOT EXISTS agent_activity(source TEXT,session TEXT,status TEXT,updated TEXT,received INTEGER,PRIMARY KEY(source,session))');
  let cached=null,pending=null;
  return {
    record(body){const report=validateActivity(body);for(const s of report.sessions)db.prepare('INSERT OR REPLACE INTO agent_activity VALUES(?,?,?,?,?)').run(report.source,s.sessionId,s.status,s.updatedAt,Date.now());db.prepare('DELETE FROM agent_activity WHERE received<?').run(Date.now()-30*86400000);return {ok:true};},
    async read(){
      let local=[];if(process.env.CODEX_ACTIVITY_ENABLED==='true'){
        if(!cached||Date.now()-cached.time>10000){if(!pending)pending=readCodexActivity().then(s=>{cached={time:Date.now(),sessions:s};}).finally(()=>pending=null);await pending;}
        local=(cached?.sessions||[]).map(s=>({...s,source:'local-codex',receivedAt:new Date(cached.time).toISOString()}));
      }
      const remote=db.prepare('SELECT source,session AS sessionId,status,updated AS updatedAt,received FROM agent_activity ORDER BY updated DESC LIMIT 32').all().map(({received,...s})=>({...s,receivedAt:new Date(received).toISOString()}));
      return {configured:process.env.CODEX_ACTIVITY_ENABLED==='true'||remote.length>0,chatgptAvailable:false,sessions:[...local,...remote].filter(s=>Date.now()-Date.parse(s.updatedAt)<30*86400000).sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt)).slice(0,16)};
    }
  };
}
