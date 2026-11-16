// Do not include upstream bodies: HTML error pages can contain private information.
export async function readApiResponse(response,path){
  const raw=await response.text();
  let data;
  try {data=JSON.parse(raw);}catch {
    const kind=/^\s*</.test(raw)?'HTML':'a non-JSON response';
    throw Error(`Orbit /api/${path.split('?')[0]} returned ${kind} (HTTP ${response.status}). Check the reverse proxy or Cloudflare route: /api/* must reach the Orbit Node server on port 3000, without a login-page redirect or HTML error page.`);
  }
  return data;
}
