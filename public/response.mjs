// Do not include upstream bodies: HTML error pages can contain private information.
export async function readApiResponse(response,path){
  const raw=await response.text();
  let data;
  try {data=JSON.parse(raw);}catch {
    const kind=/^\s*</.test(raw)?'HTML':'a non-JSON response';
    throw Error(`Orbit /api/${path.split('?')[0]} returned ${kind} (HTTP ${response.status}). The proxy returned no usable JSON error. If other Orbit requests work, check the integration error directly on the Orbit server; this response alone does not identify a routing or permissions problem.`);
  }
  return data;
}
