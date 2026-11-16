import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
const exec=promisify(execFile);
const O={descr:'1.3.6.1.2.1.2.2.1.2',cpu:'1.3.6.1.2.1.25.3.3.1.2',storage:'1.3.6.1.2.1.25.2.3.1',agent:'1.3.6.1.2.1.1.3.0',uptime:'1.3.6.1.2.1.25.1.1.0'};
const fail=message=>Object.assign(new Error(message),{status:424});
export function parseSnmp(text){
  const values={};
  for(const line of text.split(/\r?\n/)){
    const match=line.match(/^\.?([\d.]+)\s*=\s*(.*)$/);if(!match)continue;
    values[match[1]]=match[2].replace(/^"|"$/g,'');
  }
  return values;
}
const num=value=>typeof value==='string'&&/^\d+$/.test(value)?Number(value):null;
const counter=value=>typeof value==='string'&&/^\d+$/.test(value)?value:null;
export function trafficRates(previous,current){
  const elapsed=previous?(current.time-previous.time)/1000:0;
  const valid=previous&&elapsed>0&&elapsed<=120&&previous.index===current.index&&previous.bits===current.bits&&current.agentTicks>=previous.agentTicks&&current.discontinuity===previous.discontinuity&&previous.up&&current.up;
  if(!valid||[previous?.rx,previous?.tx,current.rx,current.tx].some(v=>v===null||v===undefined))return {downloadMbps:null,uploadMbps:null};
  const rx=BigInt(current.rx)-BigInt(previous.rx),tx=BigInt(current.tx)-BigInt(previous.tx);
  // A counter reset must not produce a huge spike. Rebaseline on decreases.
  if(rx<0n||tx<0n)return {downloadMbps:null,uploadMbps:null};
  return {downloadMbps:Number(rx)*8/elapsed/1e6,uploadMbps:Number(tx)*8/elapsed/1e6};
}
export function hostMetrics(cpu,storage){
  const loads=Object.values(cpu).map(num).filter(n=>n!==null&&n<=100);
  let memory=null;
  for(const [oid,type] of Object.entries(storage)){
    if(!oid.startsWith(O.storage+'.2.')||type.replace(/^\./,'')!=='1.3.6.1.2.1.25.2.1.2')continue;
    const index=oid.slice((O.storage+'.2.').length),units=num(storage[O.storage+'.4.'+index]),size=num(storage[O.storage+'.5.'+index]),used=num(storage[O.storage+'.6.'+index]);
    if(units>0&&size>0&&used!==null)memory={usedBytes:used*units,totalBytes:size*units,percent:used/size*100};
    break;
  }
  return {cpuPercent:loads.length?loads.reduce((a,b)=>a+b,0)/loads.length:null,memory};
}
export function createPfSenseCollector(run=exec){
  let previous=null,cached=null,configKey='',pending=null;
  return async function collect(){
    const host=process.env.PFSENSE_SNMP_HOST||'',community=process.env.PFSENSE_SNMP_COMMUNITY||'',iface=process.env.PFSENSE_SNMP_INTERFACE||'pppoe2';
    const port=Number(process.env.PFSENSE_SNMP_PORT||161);
    if(!/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(host)||!Number.isInteger(port)||port<1||port>65535)throw fail('Invalid pfSense SNMP hostname or port. Use a hostname or IPv4 address without http://.');
    if(!community||/[\r\n\x00]/.test(community)||community.length>256)throw fail('Set a valid PFSENSE_SNMP_COMMUNITY in the server environment.');
    if(!/^[a-zA-Z0-9_.:-]{1,100}$/.test(iface))throw fail('Invalid pfSense interface name.');
    const key=JSON.stringify([host,port,community,iface]);
    if(pending)return pending;
    if(key!==configKey){previous=null;cached=null;configKey=key;}
    if(cached&&performance.now()-cached.time<4000)return cached.result;
    pending=(async()=>{
      const directory=await mkdtemp(join(tmpdir(),'orbit-snmp-'));
      try{
        // Keep the community out of argv and command error messages.
        await writeFile(join(directory,'snmp.conf'),`defCommunity "${community.replace(/\\/g,'\\\\').replace(/"/g,'\\"')}"\n`,{mode:0o600});
        const query=async(tool,oids)=>{
          try{
            const {stdout}=await run(tool,['-v2c','-OQnt','-t','2','-r','0',`udp:${host}:${port}`,...oids],{timeout:7000,maxBuffer:2*1024*1024,windowsHide:true,env:{...process.env,SNMPCONFPATH:directory,MIBS:'',LC_ALL:'C'}});
            return parseSnmp(stdout);
          }catch(error){throw fail(error.code==='ENOENT'?'SNMP tools are missing. Install the snmp package in the Orbit container.':'pfSense SNMP query failed. Check the read community, UDP 161 firewall rule, and SNMP interface binding.');}
        };
        const interfaces=await query('snmpwalk',[O.descr]);
        const match=Object.entries(interfaces).find(([,value])=>value===iface);
        if(!match)throw fail(`SNMP interface ${iface} was not found. Check PFSENSE_SNMP_INTERFACE after a PPPoE reconnect.`);
        const index=match[0].slice(O.descr.length+1);
        if(!/^\d+$/.test(index))throw fail('Invalid SNMP interface index.');
        const oper=`1.3.6.1.2.1.2.2.1.8.${index}`,rx64=`1.3.6.1.2.1.31.1.1.1.6.${index}`,tx64=`1.3.6.1.2.1.31.1.1.1.10.${index}`,rx32=`1.3.6.1.2.1.2.2.1.10.${index}`,tx32=`1.3.6.1.2.1.2.2.1.16.${index}`,disc=`1.3.6.1.2.1.31.1.1.1.19.${index}`;
        const [required,cpu,storage]=await Promise.allSettled([query('snmpget',[O.agent,O.uptime,oper,rx64,tx64,rx32,tx32,disc]),query('snmpwalk',[O.cpu]),query('snmpwalk',[O.storage])]);
        if(required.status==='rejected')throw required.reason;
        const values=required.value,has64=counter(values[rx64])!==null&&counter(values[tx64])!==null;
        const agentTicks=num(values[O.agent]),status=num(values[oper]);
        if(agentTicks===null||status===null)throw fail('pfSense did not return interface status or uptime. Enable the MibII SNMP module.');
        const sample={index,time:performance.now(),agentTicks,up:status===1,bits:has64?64:32,rx:counter(values[has64?rx64:rx32]),tx:counter(values[has64?tx64:tx32]),discontinuity:values[disc]||null};
        const rates=trafficRates(previous,sample);previous=sample;
        const metrics=hostMetrics(cpu.status==='fulfilled'?cpu.value:{},storage.status==='fulfilled'?storage.value:{}),hostUptime=num(values[O.uptime]);
        const result={...rates,...metrics,interface:iface,interfaceIndex:Number(index),interfaceStatus:status===1?'up':status===2?'down':'unknown',uptimeSeconds:hostUptime===null?null:hostUptime/100,agentUptimeSeconds:agentTicks/100,counterBits:sample.bits,updatedAt:new Date().toISOString(),warmingUp:rates.downloadMbps===null,source:'snmp',warnings:[]};
        if(!has64)result.warnings.push('64-bit counters unavailable; 32-bit rates may miss traffic across counter wraps.');
        if(metrics.cpuPercent===null||!metrics.memory)result.warnings.push('Some host metrics are unavailable. Enable Host Resources in pfSense SNMP.');
        cached={time:sample.time,result};return result;
      }finally{await rm(directory,{recursive:true,force:true});}
    })();
    try{return await pending;}finally{pending=null;}
  };
}
export const collectPfSense=createPfSenseCollector();
