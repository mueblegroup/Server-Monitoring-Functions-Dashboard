import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createMonitoring,configuredTargets} from '../monitoring.mjs';
test('monitor targets validate configuration and never accept URL credentials',()=>{
 for(const url of ['file:///etc/passwd','https://user:password@example.com','javascript:alert(1)'])assert.throws(()=>configuredTargets(JSON.stringify([{id:'a',name:'A',url}])));
 assert.throws(()=>configuredTargets(JSON.stringify([{id:'a',name:'A',url:'https://a.example',intervalSeconds:1}])));
});
test('checks, outage recovery and measured energy survive a monitoring instance restart',async()=>{
 const saved={...process.env};process.env.ORBIT_MONITORS=JSON.stringify([{id:'service',name:'Service',url:'https://service.example',intervalSeconds:30}]);process.env.PROXMOX_SENSORS_URL='http://sensor';process.env.PROXMOX_SENSORS_TOKEN='private';let now=1000000,ok=false;
 const db=new DatabaseSync(':memory:');const dependencies={clock:()=>now,fetcher:async()=>new Response('',{status:ok?200:503}),sensors:async()=>({node:'pve',watts:140,powerSource:'IPMI: Power Meter'})};
 try{let m=createMonitoring(db,dependencies);await m.tick();now+=60000;ok=true;await m.tick();assert.equal(m.status().monitors[0].passingPercent,50);assert.equal(m.status().monitors[0].outages[0].endedAt,now);assert.ok(m.power('pve').observed.kwh>0);m.stop();m=createMonitoring(db,dependencies);assert.equal(m.power('pve').latest.watts,140);assert.equal(m.status().monitors[0].history.length,2);m.stop();}finally{db.close();for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);}
});
test('automation is allowlisted, does not retry, blocks overlapping requests, and preserves early completion callbacks',async()=>{
 const previous=process.env.ORBIT_AUTOMATIONS;process.env.ORBIT_AUTOMATIONS=JSON.stringify([{id:'backup',name:'Backup',url:'https://n8n.example/webhook/backup',token:'private',callbackToken:'a'.repeat(32)}]);const db=new DatabaseSync(':memory:');let release,calls=0,m;const fetcher=async(url,options)=>{calls++;assert.equal(url,'https://n8n.example/webhook/backup');assert.equal(options.headers.Authorization,'Bearer private');await new Promise(r=>release=r);m.record('backup',{status:'success',summary:'Done'});return new Response('',{status:202});};
 try{m=createMonitoring(db,{fetcher});await assert.rejects(m.run('arbitrary'),/Unknown/);const running=m.run('backup');await assert.rejects(m.run('backup'),/already running/);release();await running;assert.equal(calls,1);assert.equal(m.status().actions[0].result.status,'success');assert.ok(!JSON.stringify(m.status()).includes('private'));assert.throws(()=>m.record('backup',{status:'invalid',summary:'x'}));m.stop();}finally{db.close();if(previous===undefined)delete process.env.ORBIT_AUTOMATIONS;else process.env.ORBIT_AUTOMATIONS=previous;}
});
