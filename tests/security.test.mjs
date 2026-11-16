import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHmac} from 'node:crypto';
import {defaultLayout} from '../public/dashboard.mjs';
const dir=mkdtempSync(join(tmpdir(),'orbit-test-'));
const origin='http://127.0.0.1:3097';
let handler,closeDatabase,cookie,csrf;
async function request(path,method='GET',data,headers={}){
 const raw=data===undefined?'':typeof data==='string'?data:JSON.stringify(data);
 const req=Readable.from(raw?[Buffer.from(raw)]:[]);
 req.url=path==='/'?'/':'/api/'+path; req.method=method;
 req.headers=Object.fromEntries(Object.entries({Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...headers}).map(([k,v])=>[k.toLowerCase(),v]));
 req.socket={remoteAddress:'127.0.0.1'};
 const out={};let status,content;
 const res={setHeader(k,v){out[k.toLowerCase()]=v;},writeHead(code,values){status=code;for(const[k,v]of Object.entries(values))out[k.toLowerCase()]=v;},end(value){content=String(value);}};
 await handler(req,res);
 return {status,headers:{get:k=>out[k.toLowerCase()]},json:async()=>JSON.parse(content),text:async()=>content};
}
before(async()=>{
 Object.assign(process.env,{ORBIT_TEST_MODE:'true',PUBLIC_ORIGIN:origin,DB_PATH:join(dir,'test.sqlite'),ADMIN_EMAIL:'test@example.com',ADMIN_PASSWORD:'correct-long-passphrase',STRIPE_WEBHOOK_SECRET:'whsec_test'});
 for(const k of ['PROXMOX_URL','HESTIA_URL','CLOUDFLARE_TOKEN','HOSTINGER_TOKEN','JELLYFIN_URL','PFSENSE_METRICS_URL'])delete process.env[k];
 ({handler,closeDatabase}=await import('../server.mjs'));
});
after(()=>{closeDatabase?.();rmSync(dir,{recursive:true,force:true});});
test('private endpoints reject anonymous access',async()=>{assert.equal((await request('proxmox')).status,401);});
test('invalid credentials and hostile origins are rejected',async()=>{assert.equal((await request('login','POST',{email:'test@example.com',password:'bad'})).status,401);assert.equal((await request('login','POST',{}, {Origin:'https://evil.example'})).status,403);});
test('remembered login has a 90-day HttpOnly cookie',async()=>{const r=await request('login','POST',{email:'test@example.com',password:'correct-long-passphrase',remember:true});assert.equal(r.status,200);const set=r.headers.get('set-cookie');assert.match(set,/Max-Age=7776000/);assert.match(set,/HttpOnly/);assert.match(set,/SameSite=Strict/);cookie=set.split(';')[0];csrf=(await r.json()).csrf;assert.equal((await request('session')).status,200);});
test('actions require CSRF, explicit confirmation and configuration',async()=>{assert.equal((await request('proxmox','POST',{action:'stop'})).status,403);assert.equal((await request('proxmox','POST',{action:'stop'},{'X-CSRF-Token':csrf})).status,400);assert.equal((await request('proxmox','POST',{action:'stop',confirm:'stop'},{'X-CSRF-Token':csrf})).status,503);const r=await request('audit');const entries=await r.json();assert.equal(entries[0].outcome,'failed');});
test('GET cannot perform mutations',async()=>{assert.equal((await request('proxmox?action=remove')).status,405);});
test('Dashboard layouts require authenticated CSRF-protected writes and persist valid widget order',async()=>{
 assert.deepEqual(await (await request('dashboard')).json(),{});
 const layout=defaultLayout();layout.widgets.reverse();layout.widgets[0].visible=false;layout.refresh=15;layout.node='proxmox-main';
 assert.equal((await request('dashboard','POST',layout)).status,403);
 const saved=await request('dashboard','POST',layout,{'X-CSRF-Token':csrf});assert.equal(saved.status,200);
 assert.deepEqual(await (await request('dashboard')).json(),layout);
 const invalid=structuredClone(layout);invalid.widgets[0].id=invalid.widgets[1].id;
 assert.equal((await request('dashboard','POST',invalid,{'X-CSRF-Token':csrf})).status,400);
 assert.equal((await request('dashboard','POST',{...layout,refresh:1},{'X-CSRF-Token':csrf})).status,400);
 assert.deepEqual(await (await request('dashboard')).json(),layout);
 assert.equal((await request('dashboard', 'GET', undefined,{Cookie:''})).status,401);
});
test('Stripe rejects forged signatures and deduplicates valid events',async()=>{
 const raw=JSON.stringify({id:'evt_test',type:'payment_intent.succeeded',data:{object:{amount_received:40000,currency:'myr'}}});
 assert.equal((await request('stripe/webhook','POST',raw,{'stripe-signature':'t=0,v1=bad'})).status,401);
 const t=Math.floor(Date.now()/1000),sig=createHmac('sha256','whsec_test').update(`${t}.${raw}`).digest('hex');
 for(let i=0;i<2;i++)assert.equal((await request('stripe/webhook','POST',raw,{'stripe-signature':`t=${t},v1=${sig}`})).status,200);
 const r=await request('stripe');assert.equal((await r.json()).events.length,1);
});
test('secrets are not exposed and frontend has a restrictive CSP',async()=>{const r=await request('session');assert.ok(!JSON.stringify(await r.json()).includes('whsec_test'));const html=await request('/');assert.equal(html.status,200);assert.match(html.headers.get('content-security-policy'),/frame-ancestors 'none'/);});
test('logout invalidates session immediately',async()=>{assert.equal((await request('logout','POST',{}, {'X-CSRF-Token':csrf})).status,200);assert.equal((await request('session')).status,401);});
