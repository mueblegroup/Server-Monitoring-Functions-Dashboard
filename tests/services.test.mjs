import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {integration} from '../services.mjs';
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
