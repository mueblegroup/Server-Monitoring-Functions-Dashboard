import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {parseActivity,readCodexActivity,createActivityStore,validateActivity} from '../codex-activity.mjs';
test('Codex reports lifecycle events without exporting prompts, responses or cwd',()=>{
 const text=[{type:'session_meta',payload:{id:'test-session',cwd:'/private'}},{type:'event_msg',timestamp:'2026-11-17T00:00:00Z',payload:{type:'task_started',prompt:'secret prompt'}},{type:'response_item',payload:{message:'secret response'}},{type:'event_msg',timestamp:'2026-11-17T00:01:00Z',payload:{type:'task_complete',last_agent_message:'secret answer'}}].map(JSON.stringify).join('\n');const result=parseActivity(text);assert.deepEqual(result,{sessionId:'test-session',status:'completed',updatedAt:'2026-11-17T00:01:00.000Z'});assert.ok(!JSON.stringify(result).includes('secret'));assert.equal(parseActivity('invalid'),null);
});
test('the CLI reader discovers local session files and ignores malformed data',async()=>{
 const root=await mkdtemp(join(tmpdir(),'orbit-activity-'));try{await mkdir(join(root,'2026'));await writeFile(join(root,'2026','rollout.jsonl'),JSON.stringify({type:'event_msg',timestamp:new Date().toISOString(),payload:{type:'turn_started'}})+'\nnot json');const rows=await readCodexActivity(root);assert.equal(rows.length,1);assert.equal(rows[0].status,'working');}finally{await rm(root,{recursive:true,force:true});}
});
test('status reports persist only validated metadata and mark ChatGPT chat access unavailable',async()=>{
 const db=new DatabaseSync(':memory:'),store=createActivityStore(db),previous=process.env.CODEX_ACTIVITY_ENABLED;process.env.CODEX_ACTIVITY_ENABLED='false';
 try{store.record({source:'desktop',sessions:[{sessionId:'chat-1',status:'waiting',updatedAt:new Date().toISOString(),prompt:'do not store'}]});const rows=await store.read();assert.equal(rows.sessions[0].status,'waiting');assert.equal(rows.chatgptAvailable,false);assert.ok(!JSON.stringify(rows).includes('do not store'));assert.throws(()=>validateActivity({source:'x',sessions:[{sessionId:'x',status:'arbitrary',updatedAt:new Date().toISOString()}]}));}finally{db.close();if(previous===undefined)delete process.env.CODEX_ACTIVITY_ENABLED;else process.env.CODEX_ACTIVITY_ENABLED=previous;}
});
