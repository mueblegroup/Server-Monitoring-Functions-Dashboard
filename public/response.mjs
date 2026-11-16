// Do not include upstream bodies: HTML error pages can contain private information.
export function networkAddresses(interfaces){
  const rows=[],seen=new Set();
  for(const item of Array.isArray(interfaces)?interfaces:[]){
    const label=item.name||item.iface||'Network';
    if(label==='lo')continue;
    const entries=Array.isArray(item['ip-addresses'])?item['ip-addresses']:[];
    for(const raw of [item.inet,item.inet6,...entries.map(x=>x['ip-address'])]){
      if(typeof raw!=='string')continue;
      const address=raw.split('/')[0].trim();
      if(!address||address==='::1'||address==='::'||/^127\./.test(address)||/^169\.254\./.test(address)||address==='0.0.0.0'||/^fe[89ab][0-9a-f]:/i.test(address))continue;
      const family=address.includes(':')?'IPv6':'IPv4',key=`${label}/${address}`;
      if(!seen.has(key)){seen.add(key);rows.push({interface:label,address,family});}
    }
  }
  return rows.sort((a,b)=>a.family.localeCompare(b.family));
}
export async function readApiResponse(response,path){
  const raw=await response.text();
  let data;
  try {data=JSON.parse(raw);}catch {
    const kind=/^\s*</.test(raw)?'HTML':'a non-JSON response';
    throw Error(`Orbit /api/${path.split('?')[0]} returned ${kind} (HTTP ${response.status}). The proxy returned no usable JSON error. If other Orbit requests work, check the integration error directly on the Orbit server; this response alone does not identify a routing or permissions problem.`);
  }
  return data;
}
