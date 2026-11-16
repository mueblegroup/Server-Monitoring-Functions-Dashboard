import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {parseSnmp,trafficRates,hostMetrics,createPfSenseCollector} from '../pfsense.mjs';
import {configured} from '../services.mjs';
const root='1.3.6.1.2.1.25.2.3.1';
Object.assign(process.env,{PFSENSE_SNMP_HOST:'pfsense.example.lan',PFSENSE_SNMP_COMMUNITY:'test-secret-community',PFSENSE_SNMP_INTERFACE:'pppoe2'});
test('SNMP quick numeric output preserves 64-bit counter precision and interface names',()=>{
 assert.deepEqual(parseSnmp('.1.2.3 = "pppoe2"\n.1.2.4 = 9007199254740993\n.1.2.5 = No Such Instance currently exists at this OID'),{'1.2.3':'pppoe2','1.2.4':'9007199254740993','1.2.5':'No Such Instance currently exists at this OID'});
});
test('WAN rates use byte deltas and monotonic time; first sample is unknown',()=>{
 const previous={time:1000,index:'9',bits:64,agentTicks:100,discontinuity:'0',up:true,rx:'9007199254740993',tx:'10000000'};
 const current={...previous,time:6000,agentTicks:600,rx:'9007199264740993',tx:'15000000'};
 assert.deepEqual(trafficRates(null,current),{downloadMbps:null,uploadMbps:null});
 assert.deepEqual(trafficRates(previous,current),{downloadMbps:16,uploadMbps:8});
 for(const changes of [{index:'10'},{agentTicks:0},{discontinuity:'500'},{rx:'1'},{bits:32},{time:200000}])assert.equal(trafficRates(previous,{...current,...changes}).downloadMbps,null);
 assert.deepEqual(trafficRates({...previous,up:false},{...current,up:false}),{downloadMbps:16,uploadMbps:8});
});
test('Host Resources aggregates CPU and uses physical RAM allocation units',()=>{
 const storage={[root+'.2.1']:'.1.3.6.1.2.1.25.2.1.2',[root+'.4.1']:'4096',[root+'.5.1']:'1000',[root+'.6.1']:'310'};
 assert.deepEqual(hostMetrics({'1.2.1':'2','1.2.2':'4'},storage),{cpuPercent:3,memory:{usedBytes:1269760,totalBytes:4096000,percent:31}});
 assert.deepEqual(hostMetrics({},{}),{cpuPercent:null,memory:null});
});
test('System-wide UCD RAM is preferred over Host Resources pool accounting',()=>{
 const memory={'1.3.6.1.4.1.2021.4.5.0':'1000','1.3.6.1.4.1.2021.4.6.0':'400','1.3.6.1.4.1.2021.4.14.0':'100','1.3.6.1.4.1.2021.4.15.0':'200'};
 assert.deepEqual(hostMetrics({}, {}, memory).memory,{usedBytes:307200,totalBytes:1024000,percent:30});
});
test('Direct SNMP configuration enables pfSense without an HTTP token',()=>{assert.equal(configured().pfsense,true);});
test('Collector discovers index by name, protects the community, caches and cleans up',async()=>{
 let calls=0,directory;
 const run=async(tool,args,options)=>{
  calls++;directory=options.env.SNMPCONFPATH;
  assert.ok(!args.join(' ').includes(process.env.PFSENSE_SNMP_COMMUNITY));
  assert.ok((await readFile(join(directory,'snmp.conf'),'utf8')).includes('defCommunity "test-secret-community"'));
  const output=values=>({stdout:Object.entries(values).map(([oid,value])=>`.${oid} = ${value}`).join('\n')});
  if(tool==='snmpget')return output({'1.3.6.1.2.1.1.3.0':'10000','1.3.6.1.2.1.25.1.1.0':'20000','1.3.6.1.2.1.2.2.1.8.9':'1','1.3.6.1.2.1.31.1.1.1.6.9':'1000000','1.3.6.1.2.1.31.1.1.1.10.9':'500000','1.3.6.1.2.1.31.1.1.1.19.9':'0'});
  if(args.at(-1)==='1.3.6.1.2.1.2.2.1.2')return output({'1.3.6.1.2.1.2.2.1.2.1':'"vtnet0"','1.3.6.1.2.1.2.2.1.2.9':'"pppoe2"'});
  if(args.at(-1)==='1.3.6.1.2.1.25.3.3.1.2')return output({'1.3.6.1.2.1.25.3.3.1.2.1':'3'});
  return output({[root+'.2.1']:'.1.3.6.1.2.1.25.2.1.2',[root+'.4.1']:'4096',[root+'.5.1']:'1000',[root+'.6.1']:'310'});
 };
 const collect=createPfSenseCollector(run),result=await collect();
 assert.equal(result.interfaceIndex,9);assert.equal(result.cpuPercent,3);assert.equal(result.uptimeSeconds,200);assert.equal(result.counterBits,64);assert.equal(result.downloadMbps,null);assert.equal(result.interfaceStatus,'up');
 assert.ok(!JSON.stringify(result).includes('test-secret-community'));
 assert.deepEqual(await collect(),result);assert.equal(calls,4);await assert.rejects(access(directory));
});
test('Collector errors never forward command text or community secrets',async()=>{
 let directory;
 const collect=createPfSenseCollector(async(tool,args,options)=>{directory=options.env.SNMPCONFPATH;throw new Error('secret command: '+process.env.PFSENSE_SNMP_COMMUNITY);});
 await assert.rejects(collect(),error=>error.status===424&&!error.message.includes('test-secret-community')&&error.message.includes('UDP 161'));
 await assert.rejects(access(directory));
});
