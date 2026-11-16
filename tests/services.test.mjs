import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {integration,jellyfinImage,collectHostSensors} from '../services.mjs';
import https from 'node:https';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
const originalFetch=globalThis.fetch;
const calls=[];
Object.assign(process.env,{PROXMOX_URL:'https://pve.example:8006',PROXMOX_TOKEN_ID:'orbit@pve!api',PROXMOX_TOKEN_SECRET:'test',HESTIA_URL:'https://hestia.example:8083',HESTIA_ACCESS_KEY:'access',HESTIA_SECRET_KEY:'secret',HOSTINGER_TOKEN:'test',CLOUDFLARE_TOKEN:'test',CLOUDFLARE_ACCOUNT_ID:'account'});
function mock(responses){calls.length=0;globalThis.fetch=async(url,options)=>{calls.push({url,...options});return new Response(JSON.stringify(responses.shift()),{status:200});};}
after(()=>{globalThis.fetch=originalFetch;});
test('TLS opt-out applies only to private servers and preserves authenticated POST bodies',async()=>{
 const originalRequest=https.request,previous=process.env.SERVER_TLS_VERIFY,requests=[];
 try{
  process.env.SERVER_TLS_VERIFY='false';
  https.request=(url,options,callback)=>{
   const req=new EventEmitter();
   req.end=body=>{
    requests.push({url,options,body});
    const res=Readable.from([Buffer.from(JSON.stringify({data:'UPID:test'}))]);
    res.statusCode=200;res.headers={'content-type':'application/json'};callback(res);
   };
   return req;
  };
  assert.equal(await integration('proxmox',{node:'pve',type:'qemu',vmid:'105',action:'start'},'POST'),'UPID:test');
  assert.equal(requests[0].options.rejectUnauthorized,false);
  assert.equal(requests[0].options.headers.Authorization,'PVEAPIToken=orbit@pve!api=test');
  assert.equal(requests[0].options.headers['Content-Length'],0);
  mock([{id:1}]);
  await integration('hostinger',{},'GET');
  assert.equal(calls.length,1);assert.equal(requests.length,1);
  process.env.SERVER_TLS_VERIFY='true';mock([{data:[]}]);
  await integration('proxmox',{},'GET');assert.equal(calls.length,1);assert.equal(requests.length,1);
 }finally{
  https.request=originalRequest;
  if(previous===undefined)delete process.env.SERVER_TLS_VERIFY;else process.env.SERVER_TLS_VERIFY=previous;
 }
});
test('Proxmox token and unprivileged CT allocation are sent correctly',async()=>{
 mock([{data:'UPID:test'}]);
 await integration('proxmox',{action:'create',type:'lxc',node:'pve',vmid:'300',name:'test',cores:'2',memory:'512',disk:'8',storage:'local-lvm',bridge:'vmbr0',template:'local:vztmpl/debian.tar.zst',password:'disposable-test-password'},'POST');
 assert.equal(calls[0].url,'https://pve.example:8006/api2/json/nodes/pve/lxc');assert.equal(calls[0].headers.Authorization,'PVEAPIToken=orbit@pve!api=test');
 const payload=new URLSearchParams(calls[0].body);assert.equal(payload.get('unprivileged'),'1');assert.equal(payload.get('rootfs'),'local-lvm:8');assert.equal(payload.get('net0'),'name=eth0,bridge=vmbr0,ip=dhcp');
});
test('Proxmox refuses path injection before any upstream call',async()=>{mock([]);await assert.rejects(integration('proxmox',{action:'stop',node:'../evil',vmid:'300'},'POST'),/Invalid name/);assert.equal(calls.length,0);});
test('Proxmox host statistics select an online node and scope guests to it',async()=>{
 mock([{data:[{node:'offline',status:'offline'},{node:'pve',status:'online',maxcpu:8}]},
  {data:[{node:'pve',vmid:100,type:'lxc',status:'running'},{node:'other',vmid:200,type:'qemu'}]},
  {data:{cpu:.25,memory:{used:10,total:100},swap:{used:0,total:10},uptime:1000}},{data:[{storage:'local',used:20,total:100,active:1}]}]);
 const result=await integration('proxmox',{view:'stats'},'GET');
 assert.equal(result.node,'pve');assert.equal(result.stats.cpu,.25);assert.equal(result.guests.length,1);assert.equal(result.storage[0].storage,'local');
 assert.equal(calls.length,4);assert.ok(calls.every(c=>c.method==='GET'));assert.deepEqual(result.errors,[]);
});
test('Proxmox rejects unknown statistics nodes before requesting their metrics',async()=>{
 mock([{data:[{node:'pve',status:'online'}]},{data:[]}]);
 await assert.rejects(integration('proxmox',{view:'stats',node:'other'},'GET'),/Unknown Proxmox node/);assert.equal(calls.length,2);
});
test('Optional last-hour graphs request Proxmox RRD without exposing extra fields',async()=>{
 mock([{data:[{node:'pve',status:'online'}]},{data:[]},{data:{cpu:.25}},{data:[]},{data:[{time:100,cpu:.2,memused:50,memtotal:100,rootused:20,roottotal:100,unneeded:'private'}]}]);
 const result=await integration('proxmox',{view:'stats',history:'1'},'GET');
 assert.equal(result.history[0].cpu,.2);assert.equal(result.history[0].unneeded,undefined);assert.ok(calls[4].url.endsWith('/rrddata?timeframe=hour&cf=AVERAGE'));
});
test('Offline Proxmox nodes do not trigger status or storage calls',async()=>{
 mock([{data:[{node:'pve',status:'offline'}]},{data:[]}]);const result=await integration('proxmox',{view:'stats'},'GET');
 assert.equal(result.stats,null);assert.equal(calls.length,2);
});
test('Hardware sensors are sanitized and belong to the selected host',async()=>{
 Object.assign(process.env,{PROXMOX_SENSORS_URL:'http://sensors.example:9109',PROXMOX_SENSORS_TOKEN:'sensor-secret'});
 try{
  const fixtures=()=>[{data:[{node:'pve',status:'online'}]},{data:[]},{data:{cpu:.25}},{data:[]}];
  mock([...fixtures(),{node:'pve',temperatures:[{label:'CPU',celsius:55},{label:'invalid',celsius:999}],fans:[{label:'CPU fan',rpm:1200}]}]);
  const result=await integration('proxmox',{view:'stats'},'GET');assert.equal(result.sensors.temperatures.length,1);assert.equal(result.sensors.fans[0].rpm,1200);assert.equal(calls[4].headers.Authorization,'Bearer sensor-secret');
  mock([...fixtures(),{node:'different-host',temperatures:[{celsius:55}]}]);
  const mismatch=await integration('proxmox',{view:'stats'},'GET');assert.equal(mismatch.sensors,null);assert.equal(mismatch.stats.cpu,.25);assert.match(mismatch.errors[0],/does not match/);
 }finally{delete process.env.PROXMOX_SENSORS_URL;delete process.env.PROXMOX_SENSORS_TOKEN;}
});
test('A failed storage request preserves usable CPU and memory statistics',async()=>{
 let count=0;globalThis.fetch=async()=>{count++;if(count===1)return Response.json({data:[{node:'pve',status:'online'}]});if(count===2)return Response.json({data:[]});if(count===3)return Response.json({data:{cpu:.5}});return new Response('',{status:403});};
 const result=await integration('proxmox',{view:'stats'},'GET');assert.equal(result.stats.cpu,.5);assert.equal(result.errors.length,1);assert.deepEqual(result.storage,[]);
});
test('Proxmox power actions send the correct method and endpoint',async()=>{
 for(const type of ['lxc','qemu'])for(const action of ['start','stop','shutdown','reboot']){
  mock([{data:'UPID:test'}]);
  assert.equal(await integration('proxmox',{action,type,node:'pve',vmid:'300'},'POST'),'UPID:test');
  assert.equal(calls[0].url,`https://pve.example:8006/api2/json/nodes/pve/${type}/300/status/${action}`);
  assert.equal(calls[0].method,'POST');
 }
});
test('Proxmox null power responses are not reported as accepted',async()=>{
 mock([{data:null}]);
 await assert.rejects(integration('proxmox',{action:'start',type:'lxc',node:'pve',vmid:'300'},'POST'),/no task ID/);
});
test('Proxmox VM interfaces unwrap the guest-agent result and CT interfaces stay arrays',async()=>{
 const interfaces=[{name:'eth0'}];
 mock([{data:{result:interfaces}}]);
 assert.deepEqual(await integration('proxmox',{type:'qemu',node:'pve',vmid:'300'},'GET'),interfaces);
 assert.ok(calls[0].url.endsWith('/qemu/300/agent/network-get-interfaces'));
 mock([{data:interfaces}]);
 assert.deepEqual(await integration('proxmox',{type:'lxc',node:'pve',vmid:'300'},'GET'),interfaces);
 assert.ok(calls[0].url.endsWith('/lxc/300/interfaces'));
});
test('Proxmox null interfaces explain guest prerequisites',async()=>{
 mock([{data:null}]);
 await assert.rejects(integration('proxmox',{type:'qemu',node:'pve',vmid:'300'},'GET'),/QEMU Guest Agent/);
 mock([{data:null}]);
 await assert.rejects(integration('proxmox',{type:'lxc',node:'pve',vmid:'300'},'GET'),/CT is running/);
});
test('Hestia uses restricted documented commands and access-key pair',async()=>{mock([0]);await integration('hestia',{action:'hsts',user:'admin',domain:'example.com'},'POST');const p=new URLSearchParams(calls[0].body);assert.equal(p.get('cmd'),'v-add-web-domain-ssl-hsts');assert.equal(p.get('hash'),'access:secret');assert.equal(p.get('arg2'),'example.com');});
test('Hostinger uses documented stop endpoint',async()=>{mock([{id:1}]);await integration('hostinger',{action:'stop',vmid:'123'},'POST');assert.equal(calls[0].url,'https://developers.hostinger.com/api/vps/v1/virtual-machines/123/stop');assert.equal(calls[0].method,'POST');});
test('Cloudflare preserves existing routes and catch-all when adding hostname',async()=>{
 mock([{result:{config:{originRequest:{connectTimeout:30},ingress:[{hostname:'old.example.com',service:'http://localhost:80'},{service:'http_status:404'}]}}},{result:{id:'record1'}},{result:{ok:true}}]);
 await integration('cloudflare',{action:'route',tunnel:'tunnel-id',zone:'zone',hostname:'new.example.com',service:'http://127.0.0.1:8080'},'POST');
 assert.equal(calls.length,3);const config=JSON.parse(calls[2].body).config;assert.equal(config.ingress.length,3);assert.equal(config.ingress[1].hostname,'old.example.com');assert.equal(config.ingress.at(-1).service,'http_status:404');assert.equal(config.originRequest.connectTimeout,30);
});

test('Hostinger billing joins subscription IDs and converts cents without inventing prices',async()=>{
 mock([[{id:1,subscription_id:'sub-1'},{id:2,subscription_id:'sub-2'}],[{id:'sub-1',renewal_price:12345,currency_code:'MYR',is_auto_renewed:true,next_billing_at:'2026-12-10',billing_period:1,billing_period_unit:'month'},{id:'sub-2',is_auto_renewed:false,next_billing_at:'2026-12-10',expires_at:'2027-01-01'}]]);
 const result=await integration('hostinger',{view:'billing'},'GET');assert.equal(result.servers[0].billing.amount,123.45);assert.equal(result.servers[1].billing.amount,null);assert.equal(result.servers[1].billing.due,'2027-01-01');assert.equal(calls[1].url,'https://developers.hostinger.com/api/billing/v1/subscriptions');
});
test('Hostinger still returns servers when billing permissions fail',async()=>{
 let count=0;globalThis.fetch=async()=>++count===1?new Response(JSON.stringify([{id:1}])):new Response('Unauthorized',{status:401});
 const result=await integration('hostinger',{view:'billing'},'GET');assert.equal(result.servers[0].id,1);assert.ok(result.billingError);
});

test('Jellyfin artwork uses the configured server and keeps credentials in request headers',async()=>{
 process.env.JELLYFIN_URL='http://jellyfin.example:8096';process.env.JELLYFIN_TOKEN='private-token';
 globalThis.fetch=async(url,options)=>{assert.equal(url,'http://jellyfin.example:8096/Items/abc123/Images/Backdrop?maxWidth=1000&quality=85');assert.equal(options.headers['X-Emby-Token'],'private-token');assert.equal(options.redirect,'manual');return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/jpeg'}});};
 const result=await jellyfinImage('abc123','Backdrop');assert.equal(result.type,'image/jpeg');assert.equal(result.bytes.length,3);
 await assert.rejects(jellyfinImage('../escape','Backdrop'),/Invalid/);
 globalThis.fetch=async()=>new Response('<script>',{headers:{'content-type':'text/html'}});await assert.rejects(jellyfinImage('abc123','Backdrop'),/Invalid artwork/);
});

test('Power readings select the total meter instead of summing duplicate PSU and ACPI readings',async()=>{
 Object.assign(process.env,{PROXMOX_SENSORS_URL:'http://sensors.example',PROXMOX_SENSORS_TOKEN:'sensor-secret'});
 try{mock([{node:'pve',power:[{label:'IPMI: Power Supply 1',watts:140},{label:'acpi: power1',watts:140},{label:'IPMI: Power Meter',watts:138}],temperatures:[{label:'Temp 30',celsius:78,warningCelsius:110}],fans:[{label:'Fan 1',percent:13.72}]}]);const result=await collectHostSensors('pve');assert.equal(result.watts,138);assert.equal(result.temperatures[0].warningCelsius,110);assert.equal(result.fans[0].percent,13.72);}finally{delete process.env.PROXMOX_SENSORS_URL;delete process.env.PROXMOX_SENSORS_TOKEN;}
});
test('Backup tiles read node task history and retain schedules when one node fails',async()=>{
 mock([{data:[{id:'daily',enabled:1,schedule:'02:00','next-run':1900000000}]},{data:[{node:'pve',status:'online'}]},{data:[{node:'pve',type:'vzdump',endtime:1800000000,status:'OK'}]}]);const result=await integration('proxmox',{view:'backups'},'GET');assert.equal(result.jobs[0].nextRun,1900000000);assert.equal(result.tasks[0].status,'OK');assert.match(calls[2].url,/nodes\/pve\/tasks\?typefilter=vzdump&limit=50/);assert.equal(calls.every(c=>c.method==='GET'),true);
 let call=0;globalThis.fetch=async()=>{call++;if(call===1)return Response.json({data:[{id:'daily'}]});if(call===2)return Response.json({data:[{node:'pve',status:'online'}]});return new Response('Forbidden',{status:403});};const partial=await integration('proxmox',{view:'backups'},'GET');assert.equal(partial.jobs.length,1);assert.equal(partial.errors.length,1);
});
