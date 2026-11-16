import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {normalizeUsage,readCodexUsage} from '../codex-usage.mjs';
test('Quota gauges prefer the Codex bucket, preserve missing windows and exclude account data',()=>{
 const value=normalizeUsage({rateLimits:{primary:{usedPercent:90}},rateLimitsByLimitId:{codex:{planType:'plus',primary:{usedPercent:12,windowDurationMins:300,resetsAt:2000000000},secondary:{usedPercent:27,windowDurationMins:10080,resetsAt:2000200000},accountId:'private'}}});
 assert.equal(value.windows[0].remainingPercent,88);assert.equal(value.windows[1].remainingPercent,73);assert.ok(!JSON.stringify(value).includes('private'));
 assert.deepEqual(normalizeUsage({rateLimits:{primary:null,secondary:null}}).windows,[]);
});
test('Usage reader initializes app-server and issues only a read-only quota request',async()=>{
 const messages=[];let killed=false;
 const value=await readCodexUsage((binary,args)=>{
  assert.deepEqual(args,['app-server']);const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
  child.stdin=new Writable({write(chunk,encoding,done){const request=JSON.parse(chunk.toString());messages.push(request.method);if(request.method==='initialize')queueMicrotask(()=>child.stdout.write(JSON.stringify({id:1,result:{}})+'\n'));if(request.method==='account/rateLimits/read')queueMicrotask(()=>child.stdout.write(JSON.stringify({id:2,result:{rateLimits:{primary:{usedPercent:34,windowDurationMins:300}}}})+'\n'));done();}});
  child.kill=()=>{killed=true;};return child;
 });
 assert.deepEqual(messages,['initialize','initialized','account/rateLimits/read']);assert.equal(value.windows[0].usedPercent,34);assert.ok(killed);
});
