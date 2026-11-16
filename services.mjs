import https from 'node:https';
import {collectPfSense} from './pfsense.mjs';
const env=k=>process.env[k];
// Only configured private server integrations may opt out of certificate checks.
function serverRequest(url,options){
  return new Promise((resolve,reject)=>{
    const headers={...options.headers};
    if(options.body!==undefined)headers['Content-Length']=Buffer.byteLength(options.body);
    const req=https.request(url,{method:options.method,headers,rejectUnauthorized:false,agent:false,signal:options.signal},res=>{
      const chunks=[];let size=0;
      res.on('data',chunk=>{
        size+=chunk.length;
        if(size>4*1024*1024){res.destroy(new Error('Service response too large'));return;}
        chunks.push(chunk);
      });
      res.on('error',reject);
      res.on('end',()=>{
        const text=Buffer.concat(chunks).toString('utf8');
        resolve({status:res.statusCode,ok:res.statusCode>=200&&res.statusCode<300,
          headers:{get:key=>res.headers[key.toLowerCase()]||null},
          arrayBuffer:async()=>Buffer.concat(chunks),text:async()=>text,json:async()=>JSON.parse(text)});
      });
    });
    req.on('error',reject);
    req.end(options.body);
  });
}
const needs={proxmox:['PROXMOX_URL','PROXMOX_TOKEN_ID','PROXMOX_TOKEN_SECRET'],hestia:['HESTIA_URL','HESTIA_ACCESS_KEY','HESTIA_SECRET_KEY'],cloudflare:['CLOUDFLARE_TOKEN','CLOUDFLARE_ACCOUNT_ID'],hostinger:['HOSTINGER_TOKEN'],jellyfin:['JELLYFIN_URL','JELLYFIN_TOKEN'],pfsense:['PFSENSE_METRICS_URL','PFSENSE_METRICS_TOKEN']};
export const configured=()=>Object.fromEntries(Object.entries(needs).map(([k,v])=>[k,k==='pfsense'&&env('PFSENSE_SNMP_HOST')&&env('PFSENSE_SNMP_COMMUNITY')?true:v.every(x=>!!env(x))]));
function requireValue(value,pattern,label){if(typeof value!=='string'||!pattern.test(value)) throw Object.assign(new Error(`Invalid ${label}`),{status:400});return value;}
const id=v=>requireValue(String(v??''),/^\d{1,10}$/,'ID');
const name=v=>requireValue(v,/^[a-zA-Z0-9_.-]{1,100}$/,'name');
const domain=v=>requireValue(v,/^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/,'domain');
function allowed(action,actions){if(!actions.includes(action))throw Object.assign(new Error('Unsupported action'),{status:400});}
async function request(base,path,headers={},method='GET',data,form=false,privateServer=false){
  // A provider failure is a failed dependency, not an Orbit gateway outage.
  // Keep JSON diagnostics separate from proxy-generated 502 error pages.
  const error=message=>Object.assign(new Error(message),{status:424});
  let u;try{u=new URL(base);}catch{throw error('Invalid service base URL. Include http:// or https:// and the panel port.');}
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw error('Invalid service URL. Use a base URL without credentials, query parameters or fragments.');
  let r;
  const transport=u.protocol==='https:'&&privateServer&&env('SERVER_TLS_VERIFY')==='false'?serverRequest:fetch;
  try {r=await transport(base.replace(/\/$/,'')+path,{method,redirect:'manual',signal:AbortSignal.timeout(20000),headers:{...headers,...(data?{'Content-Type':form?'application/x-www-form-urlencoded':'application/json'}:{})},body:data?(form?new URLSearchParams(data).toString():JSON.stringify(data)):undefined});}
  catch(e){
    const code=e.cause?.code||e.code;
    const hint=['ENOTFOUND','EAI_AGAIN'].includes(code)?'DNS lookup failed. Check that the container can resolve the panel hostname.':['ECONNREFUSED','ETIMEDOUT','EHOSTUNREACH','ENETUNREACH'].includes(code)?'Cannot reach the panel. Check its port, firewall and container routing.':/CERT|TLS|SELF_SIGNED/.test(code||'')?'TLS certificate verification failed. Install the private CA using NODE_EXTRA_CA_CERTS.':e.name==='TimeoutError'?'The service timed out. Check container connectivity.':'Connection failed. Check the URL, TLS certificate and network access.';
    throw error(`${u.host}: ${hint}${code?` (${code})`:''}`);
  }
  if(r.status>=300&&r.status<400)throw error(`${u.host} redirected the API request (HTTP ${r.status}). Use the panel API origin, not a login page or access-portal URL.`);
  if(!r.ok){
    let detail='';
    // Proxmox sends the actual failure reason in its JSON message. Never forward HTML pages.
    if(path.startsWith('/api2/json/')&&/application\/json/i.test(r.headers.get('content-type')||'')){
      try{const body=await r.json();if(typeof body?.message==='string')detail=body.message.replace(/[\x00-\x1f\x7f]/g,' ').slice(0,400);}catch{}
    }
    throw error(`${u.host} rejected ${method} ${path} (HTTP ${r.status}). ${detail||([401,403].includes(r.status)?'Check API credentials, permissions, IP allowlists and access policies.':r.status===404?'Check the base URL and panel port.':'Check the service or reverse proxy.')}`);
  }
  const text=await r.text();let value;
  try{value=text?JSON.parse(text):null;}catch{throw error(`${u.host} returned ${/^\s*</.test(text)?'HTML':'non-JSON content'} instead of API JSON. Check the panel base URL/port and any proxy or Cloudflare Access policy. Proxmox uses /api2/json; Hestia uses /api/. Do not put those paths in the base URL.`);}
  if(value?.success===false||value?.error)throw error(`${u.host} reported an API error. Check service permissions and configuration.`);return value;
}
export async function integration(service,b,method){
  if(!configured()[service])throw Object.assign(new Error('Not connected. Configure this service in the server environment.'),{status:503});
  if(service==='proxmox') {
    const call=(path,m='GET',data)=>request(env('PROXMOX_URL'),'/api2/json'+path,{Authorization:`PVEAPIToken=${env('PROXMOX_TOKEN_ID')}=${env('PROXMOX_TOKEN_SECRET')}`},m,data,true,true).then(x=>x.data);
    if(method==='GET'){
      if(b.view==='backups'){
        const results=await Promise.allSettled([call('/cluster/backup'),call('/nodes')]);
        const jobs=results[0].status==='fulfilled'&&Array.isArray(results[0].value)?results[0].value:[];
        const nodes=results[1].status==='fulfilled'&&Array.isArray(results[1].value)?results[1].value:[];
        const taskResults=await Promise.allSettled(nodes.filter(n=>n.status==='online').slice(0,30).map(n=>call('/nodes/'+name(n.node)+'/tasks?typefilter=vzdump&limit=50')));
        const tasks=taskResults.filter(r=>r.status==='fulfilled'&&Array.isArray(r.value)).flatMap(r=>r.value).filter(t=>t.type==='vzdump');
        return {jobs:jobs.map(j=>({id:j.id,node:j.node,schedule:j.schedule,enabled:j.enabled,nextRun:j['next-run'],storage:j.storage})),tasks:tasks.map(t=>({node:t.node,id:t.id,starttime:t.starttime,endtime:t.endtime,status:t.status,upid:t.upid})),errors:[...results,...taskResults].filter(r=>r.status==='rejected').map(r=>r.reason.message),updatedAt:new Date().toISOString()};
      }
      if(b.view==='stats'){

        const [nodes,resources]=await Promise.all([call('/nodes'),call('/cluster/resources?type=vm')]);
        if(!Array.isArray(nodes)||!Array.isArray(resources))throw Object.assign(new Error('Proxmox returned an invalid node inventory.'),{status:424});
        const selected=b.node?name(b.node):(nodes.find(n=>n.status==='online')?.node||nodes[0]?.node);
        if(!selected)return {nodes:[],node:null,stats:null,storage:[],guests:[],errors:[],updatedAt:new Date().toISOString()};
        name(selected);
        if(!nodes.some(n=>n.node===selected))throw Object.assign(new Error('Unknown Proxmox node'),{status:400});
        const online=nodes.find(n=>n.node===selected).status==='online';
        const results=online?await Promise.allSettled([call(`/nodes/${selected}/status`),call(`/nodes/${selected}/storage`),
          env('PROXMOX_SENSORS_URL')&&env('PROXMOX_SENSORS_TOKEN')?collectHostSensors(selected):Promise.resolve(null),b.history==='1'?call(`/nodes/${selected}/rrddata?timeframe=hour&cf=AVERAGE`):Promise.resolve([])]):[];
        return {nodes:nodes.map(({node,status,cpu,maxcpu,mem,maxmem,uptime})=>({node,status,cpu,maxcpu,mem,maxmem,uptime})),node:selected,
          stats:results[0]?.status==='fulfilled'?results[0].value:null,
          storage:results[1]?.status==='fulfilled'?results[1].value:[],
          sensors:results[2]?.status==='fulfilled'?results[2].value:null,
          history:results[3]?.status==='fulfilled'&&Array.isArray(results[3].value)?results[3].value.map(({time,cpu,memused,memtotal,rootused,roottotal})=>({time,cpu,memused,memtotal,rootused,roottotal})):[],
          guests:resources.filter(r=>r.node===selected).map(({vmid,name,type,status,cpu,mem,maxmem})=>({vmid,name,type,status,cpu,mem,maxmem})),
          errors:results.filter(r=>r.status==='rejected').map(r=>r.reason?.message||'Metrics unavailable'),updatedAt:new Date().toISOString()};
      }
      if(b.node&&b.vmid){
        const prefix=`/nodes/${name(b.node)}/${b.type==='qemu'?'qemu':'lxc'}/${id(b.vmid)}`;
        const data=await call(prefix+(b.type==='qemu'?'/agent/network-get-interfaces':'/interfaces'));
        const interfaces=b.type==='qemu'?data?.result:data;
        if(!Array.isArray(interfaces)||!interfaces.length)throw Object.assign(new Error(b.type==='qemu'?'No VM network interfaces returned. Ensure the VM is running and QEMU Guest Agent is installed, enabled in Proxmox, and running inside the guest.':'No container network interfaces returned. Ensure the CT is running and its network interface is configured.'),{status:424});
        return interfaces;
      }
      return call('/cluster/resources?type=vm');
    }
    allowed(b.action,['start','reboot','shutdown','stop','remove','create']);
    const prefix=`/nodes/${name(b.node)}/${b.type==='qemu'?'qemu':'lxc'}`;
    if(b.action==='create'){
      const memory=Number(b.memory),cores=Number(b.cores),disk=Number(b.disk);
      if(!Number.isInteger(memory)||memory<128||memory>1048576||!Number.isInteger(cores)||cores<1||cores>128||!Number.isInteger(disk)||disk<1||disk>65536)throw Object.assign(new Error('Invalid resource allocation'),{status:400});
      const data={vmid:id(b.vmid),cores,memory};
      if(b.type==='qemu')Object.assign(data,{name:name(b.name),scsi0:`${name(b.storage)}:${disk}`,net0:`virtio,bridge=${name(b.bridge)}`,ide2:requireValue(b.template,/^[\w./:-]+$/,'ISO')+',media=cdrom',ostype:'l26'});
      else {if(typeof b.password!=='string'||b.password.length<14)throw Object.assign(new Error('CT password needs 14 characters'),{status:400});Object.assign(data,{hostname:name(b.name),ostemplate:requireValue(b.template,/^[\w./:-]+$/,'template'),rootfs:`${name(b.storage)}:${disk}`,net0:`name=eth0,bridge=${name(b.bridge)},ip=dhcp`,unprivileged:1,password:b.password});}
      return call(prefix,'POST',data);
    }
    const path=prefix+'/'+id(b.vmid);
    const task=await (b.action==='remove'?call(path,'DELETE'):call(path+'/status/'+b.action,'POST',{}));
    if(typeof task!=='string'||!task.startsWith('UPID:'))throw Object.assign(new Error('Proxmox returned no task ID. The action could not be verified; check the Proxmox task log before retrying.'),{status:424});
    return task;
  }
  if(service==='hestia'){
    const call=async(command,args=[])=>{
      const data={hash:env('HESTIA_ACCESS_KEY')+':'+env('HESTIA_SECRET_KEY'),returncode:'no',cmd:command};args.forEach((x,i)=>data['arg'+(i+1)]=x);
      const result=await request(env('HESTIA_URL'),'/api/',{},'POST',data,true,true);
      if(typeof result==='number'&&result!==0)throw new Error('Hestia command failed');return result;
    };
    if(method==='GET'){
      const result=await (b.user?call('v-list-web-domains',[name(b.user),'json']):call('v-list-users',['json']));
      const fields=b.user?['SSL','SSL_HSTS','SSL_FORCE','IP','SUSPENDED']:['NAME','WEB_DOMAINS','SUSPENDED'];
      return Object.fromEntries(Object.entries(result||{}).map(([key,value])=>[key,Object.fromEntries(fields.filter(f=>value[f]!==undefined).map(f=>[f,value[f]]))]));
    }
    const commands={create:'v-add-web-domain',remove:'v-delete-web-domain',https:'v-add-letsencrypt-domain',redirect:'v-add-web-domain-ssl-force',hsts:'v-add-web-domain-ssl-hsts'};
    allowed(b.action,Object.keys(commands));return call(commands[b.action],[name(b.user),domain(b.domain)]);
  }
  if(service==='cloudflare'){
    const account=name(env('CLOUDFLARE_ACCOUNT_ID'));
    const call=(p,m='GET',d)=>request('https://api.cloudflare.com/client/v4',p,{Authorization:'Bearer '+env('CLOUDFLARE_TOKEN')},m,d).then(x=>x.result);
    if(method==='GET')return call(`/accounts/${account}/cfd_tunnel?is_deleted=false`);
    allowed(b.action,['route']);
    const tunnel=name(b.tunnel),hostname=domain(b.hostname),zone=name(b.zone);
    requireValue(b.service,/^https?:\/\/(?:localhost|127\.0\.0\.1|[a-zA-Z0-9.-]+)(?::\d{1,5})?$/,'origin service');
    const path=`/accounts/${account}/cfd_tunnel/${tunnel}/configurations`,old=await call(path);
    const ingress=old.config?.ingress||[{service:'http_status:404'}];
    if(ingress.some(x=>x.hostname===hostname))throw Object.assign(new Error('Hostname already exists in this tunnel'),{status:409});
    // Create DNS first. If configuration fails, report a partial result for manual repair.
    const record=await call(`/zones/${zone}/dns_records`,'POST',{type:'CNAME',name:hostname,content:`${tunnel}.cfargotunnel.com`,proxied:true});
    try {return await call(path,'PUT',{config:{...old.config,ingress:[{hostname,service:b.service},...ingress]}});}
    catch {throw Object.assign(new Error(`DNS record ${record.id} created, but tunnel update failed. Remove the DNS record or repair the tunnel in Cloudflare.`),{status:502});}
  }
  if(service==='hostinger'){
    const base='/api/vps/v1/virtual-machines',headers={Authorization:'Bearer '+env('HOSTINGER_TOKEN')};
    if(method==='GET'){
      const servers=await request('https://developers.hostinger.com',base+(b.vmid?'/'+id(b.vmid):''),headers);
      if(b.view!=='billing')return servers;
      try{const subscriptions=await request('https://developers.hostinger.com','/api/billing/v1/subscriptions',headers);
      return {servers:(Array.isArray(servers)?servers:servers.data||[]).map(vm=>{const sub=(Array.isArray(subscriptions)?subscriptions:subscriptions.data||[]).find(x=>String(x.id)===String(vm.subscription_id));return {...vm,billing:sub?{name:sub.name,currency:sub.currency_code,amount:Number.isFinite(sub.renewal_price)?sub.renewal_price/100:null,due:sub.is_auto_renewed?sub.next_billing_at:sub.expires_at,autoRenew:sub.is_auto_renewed,period:sub.billing_period,unit:sub.billing_period_unit}:null};})};
      }catch(error){return {servers:Array.isArray(servers)?servers:servers.data||[],billingError:error.message};}
    }
    allowed(b.action,['start','stop','restart']);return request('https://developers.hostinger.com',base+'/'+id(b.vmid)+'/'+b.action,headers,'POST');
  }
  if(method!=='GET')throw Object.assign(new Error('Read-only integration'),{status:405});
  if(service==='jellyfin')return request(env('JELLYFIN_URL'),'/Items?IncludeItemTypes=Movie&Recursive=true&SortBy=Random&Limit=8&Fields=Overview',{Authorization:`MediaBrowser Token="${env('JELLYFIN_TOKEN')}"`},'GET',undefined,false,true);
  if(service==='pfsense')return env('PFSENSE_SNMP_HOST')&&env('PFSENSE_SNMP_COMMUNITY')?collectPfSense():request(env('PFSENSE_METRICS_URL'),'',{Authorization:'Bearer '+env('PFSENSE_METRICS_TOKEN')},'GET',undefined,false,true);
}

export async function jellyfinImage(item,kind='Backdrop'){
  requireValue(item,/^[a-fA-F0-9-]{1,64}$/,'movie ID');
  if(!['Backdrop','Primary'].includes(kind))throw Object.assign(Error('Invalid image kind'),{status:400});
  if(!configured().jellyfin)throw Object.assign(Error('Connect Jellyfin first'),{status:400});
  const base=new URL(env('JELLYFIN_URL'));if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash)throw Error('Invalid Jellyfin URL');
  const transport=base.protocol==='https:'&&env('SERVER_TLS_VERIFY')==='false'?serverRequest:fetch;
  const response=await transport(env('JELLYFIN_URL').replace(/\/$/,'')+'/Items/'+item+'/Images/'+kind+'?maxWidth=1000&quality=85',{method:'GET',headers:{'X-Emby-Token':env('JELLYFIN_TOKEN')},redirect:'manual',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Object.assign(Error('Movie artwork unavailable'),{status:404});
  const type=response.headers.get('content-type')?.split(';')[0];if(!['image/jpeg','image/png','image/webp'].includes(type))throw Error('Invalid artwork response');
  const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>4194304)throw Error('Artwork too large');return {type,bytes};
}

export async function collectHostSensors(node){
 const value=await request(env('PROXMOX_SENSORS_URL'),'/metrics',{Authorization:'Bearer '+env('PROXMOX_SENSORS_TOKEN')},'GET',undefined,false,true);
 if(node&&value?.node!==node)throw Object.assign(Error('Sensor collector node does not match the selected Proxmox node.'),{status:424});
 if(typeof value?.node!=='string'||!/^[-\w.]{1,100}$/.test(value.node))throw Error('Invalid sensor host');
 const clean=(rows,key,min,max)=>(Array.isArray(rows)?rows:[]).filter(r=>r&&Number.isFinite(r[key])&&r[key]>=min&&r[key]<=max).slice(0,100).map(r=>({label:String(r.label||'Sensor').slice(0,100),[key]:r[key],...(key==='celsius'&&Number.isFinite(r.warningCelsius)&&r.warningCelsius>0&&r.warningCelsius<=200?{warningCelsius:r.warningCelsius}:{})}));
 const power=clean(value.power,'watts',0,100000);const meter=power.find(r=>/^IPMI: Power Meter$/i.test(r.label))||power.find(r=>!/supply|psu/i.test(r.label));
 return {node:value.node,temperatures:clean(value.temperatures,'celsius',-50,200),fans:[...clean(value.fans,'rpm',0,100000),...clean(value.fans,'percent',0,100)],power,watts:meter?.watts??null,powerSource:meter?.label??null};
}
