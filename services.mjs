const env=k=>process.env[k];
const needs={proxmox:['PROXMOX_URL','PROXMOX_TOKEN_ID','PROXMOX_TOKEN_SECRET'],hestia:['HESTIA_URL','HESTIA_ACCESS_KEY','HESTIA_SECRET_KEY'],cloudflare:['CLOUDFLARE_TOKEN','CLOUDFLARE_ACCOUNT_ID'],hostinger:['HOSTINGER_TOKEN'],jellyfin:['JELLYFIN_URL','JELLYFIN_TOKEN'],pfsense:['PFSENSE_METRICS_URL','PFSENSE_METRICS_TOKEN']};
export const configured=()=>Object.fromEntries(Object.entries(needs).map(([k,v])=>[k,v.every(x=>!!env(x))]));
function requireValue(value,pattern,label){if(typeof value!=='string'||!pattern.test(value)) throw Object.assign(new Error(`Invalid ${label}`),{status:400});return value;}
const id=v=>requireValue(String(v??''),/^\d{1,10}$/,'ID');
const name=v=>requireValue(v,/^[a-zA-Z0-9_.-]{1,100}$/,'name');
const domain=v=>requireValue(v,/^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/,'domain');
function allowed(action,actions){if(!actions.includes(action))throw Object.assign(new Error('Unsupported action'),{status:400});}
async function request(base,path,headers={},method='GET',data,form=false){
  const u=new URL(base); if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new Error('Invalid service URL');
  const r=await fetch(base.replace(/\/$/,'')+path,{method,redirect:'error',signal:AbortSignal.timeout(20000),headers:{...headers,...(data?{'Content-Type':form?'application/x-www-form-urlencoded':'application/json'}:{})},body:data?(form?new URLSearchParams(data).toString():JSON.stringify(data)):undefined});
  if(!r.ok)throw new Error('Upstream rejected request');
  const text=await r.text(); const value=text?JSON.parse(text):null;
  if(value?.success===false||value?.error)throw new Error('Upstream reported error');return value;
}
export async function integration(service,b,method){
  if(!configured()[service])throw Object.assign(new Error('Not connected. Configure this service in the server environment.'),{status:503});
  if(service==='proxmox') {
    const call=(path,m='GET',data)=>request(env('PROXMOX_URL'),'/api2/json'+path,{Authorization:`PVEAPIToken=${env('PROXMOX_TOKEN_ID')}=${env('PROXMOX_TOKEN_SECRET')}`},m,data,true).then(x=>x.data);
    if(method==='GET'){
      if(b.node&&b.vmid){const prefix=`/nodes/${name(b.node)}/${b.type==='qemu'?'qemu':'lxc'}/${id(b.vmid)}`;return call(prefix+(b.type==='qemu'?'/agent/network-get-interfaces':'/interfaces'));}
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
    return b.action==='remove'?call(path,'DELETE'):call(path+'/status/'+b.action,'POST',{});
  }
  if(service==='hestia'){
    const call=async(command,args=[])=>{
      const data={hash:env('HESTIA_ACCESS_KEY')+':'+env('HESTIA_SECRET_KEY'),returncode:'no',cmd:command};args.forEach((x,i)=>data['arg'+(i+1)]=x);
      const result=await request(env('HESTIA_URL'),'/api/',{},'POST',data,true);
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
    if(method==='GET')return request('https://developers.hostinger.com',base+(b.vmid?'/'+id(b.vmid):''),headers);
    allowed(b.action,['start','stop','restart']);return request('https://developers.hostinger.com',base+'/'+id(b.vmid)+'/'+b.action,headers,'POST');
  }
  if(method!=='GET')throw Object.assign(new Error('Read-only integration'),{status:405});
  if(service==='jellyfin')return request(env('JELLYFIN_URL'),'/Items?IncludeItemTypes=Movie&Recursive=true&SortBy=Random&Limit=8&Fields=Overview',{Authorization:`MediaBrowser Token="${env('JELLYFIN_TOKEN')}"`});
  if(service==='pfsense')return request(env('PFSENSE_METRICS_URL'),'',{Authorization:'Bearer '+env('PFSENSE_METRICS_TOKEN')});
}
