import {randomBytes,createHash,createCipheriv,createDecipheriv} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const error=(message,status=424)=>Object.assign(new Error(message),{status});
const hash=value=>createHash('sha256').update(value).digest('hex');
export function createSpotify(db,directory,origin){
  db.exec('CREATE TABLE IF NOT EXISTS spotify_oauth(state TEXT PRIMARY KEY,email TEXT,session TEXT,verifier TEXT,expires INTEGER); CREATE TABLE IF NOT EXISTS spotify_tokens(email TEXT PRIMARY KEY,value TEXT)');
  const path=join(directory,'spotify-token.key');let key;
  try{key=readFileSync(path);}catch(e){if(e.code!=='ENOENT')throw e;key=randomBytes(32);writeFileSync(path,key,{mode:0o600,flag:'wx'});}
  if(key.length!==32)throw Error('Invalid Spotify token encryption key');
  const encrypt=value=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);const body=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64');};
  const decrypt=value=>{const bytes=Buffer.from(value,'base64'),cipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));cipher.setAuthTag(bytes.subarray(12,28));return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString());};
  const configured=()=>!!process.env.SPOTIFY_CLIENT_ID;
  const redirect=origin+'/api/spotify/callback';
  const load=email=>{const row=db.prepare('SELECT value FROM spotify_tokens WHERE email=?').get(email);return row?decrypt(row.value):null;};
  const store=(email,value)=>db.prepare('INSERT INTO spotify_tokens VALUES(?,?) ON CONFLICT(email) DO UPDATE SET value=excluded.value').run(email,encrypt(value));
  async function exchange(data){
    let response;try{response=await fetch('https://accounts.spotify.com/api/token',{method:'POST',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:process.env.SPOTIFY_CLIENT_ID,...data})});}catch{throw error('Spotify account connection failed. Check network connectivity.');}
    if(!response.ok)throw error(`Spotify authorization failed (HTTP ${response.status}). Reconnect your account.`,409);
    const value=await response.json();if(typeof value.access_token!=='string'||!Number.isFinite(value.expires_in))throw error('Invalid Spotify token response.');return value;
  }
  const refreshes=new Map();
  async function access(email){
    if(!configured())throw error('Set SPOTIFY_CLIENT_ID in Orbit .env and restart.',503);
    const saved=load(email);if(!saved)throw error('Connect your Spotify account first.',409);
    if(saved.expires>Date.now()+60000)return saved.access;
    if(!refreshes.has(email))refreshes.set(email,(async()=>{
      const value=await exchange({grant_type:'refresh_token',refresh_token:saved.refresh});
      if(!load(email))throw error('Spotify was disconnected. Connect your account again.',409);
      store(email,{access:value.access_token,refresh:value.refresh_token||saved.refresh,expires:Date.now()+value.expires_in*1000});return value.access_token;
    })().finally(()=>refreshes.delete(email)));
    return refreshes.get(email);
  }
  return {
    status(email){return {configured:configured(),connected:!!db.prepare('SELECT email FROM spotify_tokens WHERE email=?').get(email),redirectUri:redirect};},
    connect(email,session){
      if(!configured())throw error('Set SPOTIFY_CLIENT_ID in Orbit .env and restart.',503);
      const state=randomBytes(32).toString('hex'),verifier=randomBytes(48).toString('base64url');
      db.prepare('DELETE FROM spotify_oauth WHERE expires<?').run(Date.now());
      db.prepare('INSERT INTO spotify_oauth VALUES(?,?,?,?,?)').run(hash(state),email,session,verifier,Date.now()+600000);
      return {url:'https://accounts.spotify.com/authorize?'+new URLSearchParams({client_id:process.env.SPOTIFY_CLIENT_ID,response_type:'code',redirect_uri:redirect,state,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url'),scope:'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state'})};
    },
    async callback(params){
      const state=params.get('state');if(!/^[a-f0-9]{64}$/.test(state||''))throw error('Invalid Spotify connection state.',400);
      const pending=db.prepare('SELECT * FROM spotify_oauth WHERE state=?').get(hash(state));
      if(!pending)throw error('Spotify connection expired or already used. Connect again.',400);
      db.prepare('DELETE FROM spotify_oauth WHERE state=?').run(hash(state));
      if(pending.expires<Date.now()||!db.prepare('SELECT hash FROM sessions WHERE hash=? AND email=? AND expires>?').get(pending.session,pending.email,Date.now()))throw error('Orbit session expired. Sign in and reconnect Spotify.',400);
      if(params.has('error'))return 'denied';
      const code=params.get('code');if(!code||code.length>4096)throw error('Invalid Spotify authorization code.',400);
      const value=await exchange({grant_type:'authorization_code',code,redirect_uri:redirect,code_verifier:pending.verifier});
      if(typeof value.refresh_token!=='string')throw error('Spotify did not grant a refresh token. Reconnect.');
      store(pending.email,{access:value.access_token,refresh:value.refresh_token,expires:Date.now()+value.expires_in*1000});return 'connected';
    },
    async token(email){return {accessToken:await access(email)};},
    disconnect(email){db.prepare('DELETE FROM spotify_tokens WHERE email=?').run(email);db.prepare('DELETE FROM spotify_oauth WHERE email=?').run(email);return {ok:true};},
    async command(email,b){
      if(!/^[\w-]{1,128}$/.test(b.device||''))throw error('Spotify playback device is not ready.',400);
      if(!['transfer','play'].includes(b.action))throw error('Unsupported Spotify action.',400);
      if(b.context!==undefined&&!/^spotify:(playlist|album):[A-Za-z0-9]{10,100}$/.test(b.context))throw error('Use a Spotify playlist or album link.',400);
      const token=await access(email),path=b.action==='transfer'?'/me/player':'/me/player/play?device_id='+encodeURIComponent(b.device);
      let response;try{response=await fetch('https://api.spotify.com/v1'+path,{method:'PUT',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(b.action==='transfer'?{device_ids:[b.device],play:false}:b.context?{context_uri:b.context}:{})});}catch{throw error('Spotify playback request failed. Check connectivity.');}
      if(!response.ok)throw error(`Spotify playback failed (HTTP ${response.status}). ${response.status===403?'Premium or app access may be required.':response.status===404?'Select music in Spotify or choose a playlist here.':'Check your Spotify connection.'}`);
      return {ok:true};
    }
  };
}
