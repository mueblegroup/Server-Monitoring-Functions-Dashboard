import http from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scryptSync, timingSafeEqual, createHash, createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { integration, configured } from './services.mjs';

const root = dirname(fileURLToPath(import.meta.url));
mkdirSync(resolve(root, 'data'), {recursive:true, mode:0o700});
const db = new DatabaseSync(process.env.DB_PATH || resolve(root, 'data/orbit.sqlite'));
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users(email TEXT PRIMARY KEY, salt TEXT, hash TEXT);
CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, email TEXT, csrf TEXT, expires INTEGER);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, time TEXT, email TEXT, service TEXT, action TEXT, outcome TEXT);
CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, time TEXT, type TEXT, amount INTEGER, currency TEXT);`);
db.exec('CREATE TABLE IF NOT EXISTS dashboard_preferences(email TEXT PRIMARY KEY, value TEXT NOT NULL)');
const digest = s => createHash('sha256').update(s).digest('hex');
const token = () => randomBytes(32).toString('hex');
const admin = process.env.ADMIN_EMAIL;
if (!db.prepare('SELECT email FROM users LIMIT 1').get() && admin && process.env.ADMIN_PASSWORD?.length >= 14) {
  const salt=token();
  db.prepare('INSERT INTO users VALUES(?,?,?)').run(admin.toLowerCase(),salt,scryptSync(process.env.ADMIN_PASSWORD,salt,64).toString('hex'));
}
const attempts = new Map();
const origin = process.env.PUBLIC_ORIGIN || 'http://localhost:3000';
const secure = process.env.COOKIE_SECURE === 'true';
const cookie = (value,age) => `orbit=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure?'; Secure':''}`;
const files = {'/':['public/index.html','text/html'], '/app.js':['public/app.js','text/javascript'], '/dashboard.mjs':['public/dashboard.mjs','text/javascript'], '/response.mjs':['public/response.mjs','text/javascript'], '/style.css':['public/style.css','text/css'], '/manifest.webmanifest':['public/manifest.webmanifest','application/manifest+json'], '/icon.svg':['public/icon.svg','image/svg+xml']};
async function body(req) {
  const chunks=[]; let size=0;
  for await (const chunk of req) { size+=chunk.length; if(size>65536) throw Object.assign(new Error('Request too large'),{status:413}); chunks.push(chunk); }
  return Buffer.concat(chunks).toString();
}
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
export async function handler(req,res){
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Permissions-Policy','geolocation=(self), camera=(), microphone=()');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('Cache-Control','no-store');
  if(secure) res.setHeader('Strict-Transport-Security','max-age=31536000');
  const send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  try {
    const url=new URL(req.url,origin), path=url.pathname;
    if(req.method==='GET' && files[path]) {const [file,type]=files[path];res.writeHead(200,{'Content-Type':type});res.end(readFileSync(resolve(root,file)));return;}
    if(path==='/api/stripe/webhook' && req.method==='POST') {
      const raw=await body(req),secret=process.env.STRIPE_WEBHOOK_SECRET;
      if(!secret) fail('Webhook not configured',503);
      const fields=(req.headers['stripe-signature']||'').split(',').map(x=>x.split('='));
      const t=fields.find(x=>x[0]==='t')?.[1];
      if(!/^\d+$/.test(t||'') || Math.abs(Date.now()/1000-Number(t))>300) fail('Invalid signature',401);
      const expected=createHmac('sha256',secret).update(`${t}.${raw}`).digest();
      if(!fields.some(([k,v])=>k==='v1' && /^[a-f0-9]{64}$/.test(v||'') && timingSafeEqual(expected,Buffer.from(v,'hex')))) fail('Invalid signature',401);
      const event=JSON.parse(raw),obj=event.data?.object||{};
      db.prepare('INSERT OR IGNORE INTO events VALUES(?,?,?,?,?)').run(event.id,new Date().toISOString(),event.type,obj.amount_received??obj.amount??0,obj.currency||'');
      send(200,{received:true});return;
    }
    if(req.method!=='GET' && req.headers.origin!==origin) fail('Origin rejected',403);
    if(path==='/api/login' && req.method==='POST') {
      const ip=req.socket.remoteAddress,now=Date.now();
      if(attempts.size>10000) for(const [key,value] of attempts) if(value.until<now) attempts.delete(key);
      const state=attempts.get(ip)||{count:0,until:now+900000};
      if(state.until<now){state.count=0;state.until=now+900000;}
      if(++state.count>10) {attempts.set(ip,state);fail('Too many attempts. Try again in 15 minutes.',429);}
      attempts.set(ip,state);
      const b=JSON.parse(await body(req));
      if(typeof b.email!=='string'||typeof b.password!=='string'||b.password.length>512) fail('Invalid credentials',401);
      const user=db.prepare('SELECT * FROM users WHERE email=?').get(b.email.toLowerCase());
      const actual=scryptSync(b.password,user?.salt||'dummy-salt',64);
      if(!user||!timingSafeEqual(actual,Buffer.from(user.hash,'hex'))) fail('Invalid credentials',401);
      attempts.delete(ip);
      const sid=token(),csrf=token(),age=b.remember?90*86400:12*3600;
      db.prepare('DELETE FROM sessions WHERE expires < ?').run(now);
      db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(digest(sid),user.email,csrf,now+age*1000);
      res.setHeader('Set-Cookie',cookie(sid,age));send(200,{email:user.email,csrf});return;
    }
    const sid=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('orbit='))?.slice(6);
    const session=sid?db.prepare('SELECT * FROM sessions WHERE hash=? AND expires>?').get(digest(sid),Date.now()):null;
    if(!session) fail('Sign in to continue',401);
    if(req.method!=='GET'&&req.headers['x-csrf-token']!==session.csrf) fail('Session verification failed',403);
    if(path==='/api/session'&&req.method==='GET'){send(200,{email:session.email,csrf:session.csrf,configured:configured()});return;}
    if(path==='/api/dashboard'&&req.method==='GET'){
      const row=db.prepare('SELECT value FROM dashboard_preferences WHERE email=?').get(session.email);
      send(200,row?JSON.parse(row.value):{});return;
    }
    if(path==='/api/dashboard'&&req.method==='POST'){
      const b=JSON.parse(await body(req));
      const valid=['cpu','memory','storage','guests','health','clock','weather','infrastructure','network','music','stripe','movies','launch'];
      if(!b||!Array.isArray(b.widgets)||b.widgets.length!==valid.length||new Set(b.widgets.map(w=>w?.id)).size!==valid.length||b.widgets.some(w=>!w||!valid.includes(w.id)||typeof w.visible!=='boolean'||![4,6,12].includes(w.width))||![0,15,30,60].includes(b.refresh)||typeof b.node!=='string'||!/^[-\w.]{0,100}$/.test(b.node))fail('Invalid dashboard layout');
      const value={widgets:b.widgets.map(({id,visible,width})=>({id,visible,width})),node:b.node,refresh:b.refresh};
      db.prepare('INSERT INTO dashboard_preferences VALUES(?,?) ON CONFLICT(email) DO UPDATE SET value=excluded.value').run(session.email,JSON.stringify(value));
      send(200,value);return;
    }
    if(path==='/api/logout'&&req.method==='POST'){db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(sid));res.setHeader('Set-Cookie',cookie('',0));send(200,{ok:true});return;}
    if(path==='/api/audit'&&req.method==='GET'){send(200,db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 50').all());return;}
    if(path==='/api/stripe'&&req.method==='GET'){send(200,{configured:!!process.env.STRIPE_WEBHOOK_SECRET,events:db.prepare('SELECT * FROM events ORDER BY time DESC LIMIT 20').all()});return;}
    if(path==='/api/weather'&&req.method==='GET') {
      const lat=Number(url.searchParams.get('lat')),lon=Number(url.searchParams.get('lon'));
      if(!url.searchParams.has('lat')||!url.searchParams.has('lon')||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180) fail('Invalid coordinates');
      const r=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code&timezone=auto`,{signal:AbortSignal.timeout(10000)});
      if(!r.ok) fail('Weather unavailable',502);send(200,await r.json());return;
    }
    const match=path.match(/^\/api\/(proxmox|hestia|cloudflare|hostinger|jellyfin|pfsense)$/);
    if(match && ['GET','POST'].includes(req.method)) {
      const b=req.method==='POST'?JSON.parse(await body(req)):Object.fromEntries(url.searchParams);
      if(req.method==='GET'&&b.action) fail('Actions require POST',405);
      if(req.method==='POST'&&b.confirm!==b.action) fail('Confirm the action before continuing');
      let outcome='failed';
      try {const result=await integration(match[1],b,req.method);outcome='accepted';send(200,{data:result});}
      finally {if(req.method==='POST') db.prepare('INSERT INTO audit(time,email,service,action,outcome) VALUES(?,?,?,?,?)').run(new Date().toISOString(),session.email,match[1],b.action||'unknown',outcome);}
      return;
    }
    fail('Not found',404);
  }catch(e){send(e.status||(e instanceof SyntaxError?400:502),{error:e.status?e.message:e instanceof SyntaxError?'Invalid JSON request or service response.':'Service request failed. Check configuration, permissions and connectivity.'});}
}
export const server = http.createServer(handler);
export const closeDatabase = () => db.close();
if(process.env.ORBIT_TEST_MODE!=='true') server.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log(`Orbit listening on ${origin}`));
