import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readApiResponse} from '../public/response.mjs';
import {integration} from '../services.mjs';
test('frontend identifies HTML from the Orbit proxy without exposing the body',async()=>{
 await assert.rejects(readApiResponse(new Response('<!DOCTYPE html><p>private proxy body</p>',{status:502}),'proxmox'),e=>e.message.includes('/api/proxmox')&&e.message.includes('HTTP 502')&&!e.message.includes('private proxy body'));
});
test('JSON API errors remain usable',async()=>{assert.deepEqual(await readApiResponse(new Response('{"error":"Sign in to continue"}',{status:401}),'session'),{error:'Sign in to continue'});});
test('service HTML, redirects and authentication failures become safe actionable errors',async()=>{
 Object.assign(process.env,{PROXMOX_URL:'https://pve.example:8006',PROXMOX_TOKEN_ID:'test',PROXMOX_TOKEN_SECRET:'secret'});
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>new Response('<!DOCTYPE html>private-page');
  await assert.rejects(integration('proxmox',{},'GET'),e=>e.status===502&&e.message.includes('pve.example:8006')&&e.message.includes('HTML')&&!e.message.includes('private-page'));
  globalThis.fetch=async()=>new Response('',{status:302});
  await assert.rejects(integration('proxmox',{},'GET'),/redirected/);
  globalThis.fetch=async()=>new Response('private-body',{status:403});
  await assert.rejects(integration('proxmox',{},'GET'),/permissions/);
 }finally{globalThis.fetch=original;}
});
