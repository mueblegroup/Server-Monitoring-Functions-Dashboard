import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readApiResponse,networkAddresses} from '../public/response.mjs';
import {integration} from '../services.mjs';
test('frontend identifies HTML from the Orbit proxy without exposing the body',async()=>{
 await assert.rejects(readApiResponse(new Response('<!DOCTYPE html><p>private proxy body</p>',{status:502}),'proxmox'),e=>e.message.includes('/api/proxmox')&&e.message.includes('HTTP 502')&&!e.message.includes('private proxy body'));
});
test('JSON API errors remain usable',async()=>{assert.deepEqual(await readApiResponse(new Response('{"error":"Sign in to continue"}',{status:401}),'session'),{error:'Sign in to continue'});});
test('IP summary handles CT and VM fields, omitting loopback and link-local addresses',()=>{
 assert.deepEqual(networkAddresses([
  {name:'lo',inet:'127.0.0.1/8',inet6:'::1/128'},
  {name:'eth0',inet:'10.16.1.50/24',inet6:'fe80::123/64'},
  {name:'ens18','ip-addresses':[{'ip-address':'10.16.1.51'},{'ip-address':'10.16.1.51'},{'ip-address':'fd00::51'},{'ip-address':'169.254.1.2'}]}
 ]),[
  {interface:'eth0',address:'10.16.1.50',family:'IPv4'},
  {interface:'ens18',address:'10.16.1.51',family:'IPv4'},
  {interface:'ens18',address:'fd00::51',family:'IPv6'}
 ]);
 assert.deepEqual(networkAddresses(null),[]);
});
test('Proxmox rejection includes its JSON reason without passing HTML through',async()=>{
 Object.assign(process.env,{PROXMOX_URL:'https://pve.example:8006',PROXMOX_TOKEN_ID:'test',PROXMOX_TOKEN_SECRET:'secret'});
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>new Response(JSON.stringify({message:'Method not implemented',data:null}),{status:501,headers:{'Content-Type':'application/json'}});
  await assert.rejects(integration('proxmox',{node:'pve',type:'qemu',vmid:'105',action:'start'},'POST'),e=>e.status===424&&e.message.includes('Method not implemented')&&e.message.includes('POST /api2/json/nodes/pve/qemu/105/status/start'));
 }finally{globalThis.fetch=original;}
});
test('service HTML, redirects and authentication failures become safe actionable errors',async()=>{
 Object.assign(process.env,{PROXMOX_URL:'https://pve.example:8006',PROXMOX_TOKEN_ID:'test',PROXMOX_TOKEN_SECRET:'secret'});
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>new Response('<!DOCTYPE html>private-page');
  await assert.rejects(integration('proxmox',{},'GET'),e=>e.status===424&&e.message.includes('pve.example:8006')&&e.message.includes('HTML')&&!e.message.includes('private-page'));
  globalThis.fetch=async()=>new Response('',{status:302});
  await assert.rejects(integration('proxmox',{},'GET'),/redirected/);
  globalThis.fetch=async()=>new Response('private-body',{status:403});
  await assert.rejects(integration('proxmox',{},'GET'),/permissions/);
 }finally{globalThis.fetch=original;}
});
