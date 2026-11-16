import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createSpotify} from '../spotify.mjs';
import {spotifyContext} from '../public/spotify-player.mjs';
const dir=mkdtempSync(join(tmpdir(),'orbit-spotify-test-')),db=new DatabaseSync(':memory:');
db.exec('CREATE TABLE sessions(hash TEXT,email TEXT,expires INTEGER)');
db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('session-hash','user@example.com',Date.now()+3600000);
process.env.SPOTIFY_CLIENT_ID='test-client-id';
const spotify=createSpotify(db,dir,'https://orbit.example'),original=globalThis.fetch;
after(()=>{globalThis.fetch=original;db.close();rmSync(dir,{recursive:true,force:true});});
test('Spotify context parsing accepts only playlist/album share links and URIs',()=>{
 assert.equal(spotifyContext('https://open.spotify.com/playlist/1234567890abcdefgh1234?si=abc'),'spotify:playlist:1234567890abcdefgh1234');
 assert.equal(spotifyContext('spotify:album:1234567890abcdef'),'spotify:album:1234567890abcdef');
 for(const value of ['https://evil.example/playlist/1234567890abcdefgh1234','javascript:alert(1)','spotify:track:1234567890abcdef'])assert.throws(()=>spotifyContext(value),/playlist or album/);
});
test('OAuth uses PKCE and one-use session-bound state, encrypting stored tokens',async()=>{
 const start=spotify.connect('user@example.com','session-hash'),url=new URL(start.url),state=url.searchParams.get('state');
 assert.equal(url.origin,'https://accounts.spotify.com');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('redirect_uri'),'https://orbit.example/api/spotify/callback');
 const pending=db.prepare('SELECT * FROM spotify_oauth').get();assert.notEqual(pending.state,state);assert.equal(url.searchParams.get('code_challenge'),createHash('sha256').update(pending.verifier).digest('base64url'));
 globalThis.fetch=async(target,options)=>{assert.equal(target,'https://accounts.spotify.com/api/token');const data=new URLSearchParams(options.body);assert.equal(data.get('code_verifier'),pending.verifier);return Response.json({access_token:'short-lived-test-access',refresh_token:'private-test-refresh',expires_in:3600});};
 assert.equal(await spotify.callback(new URLSearchParams({state,code:'test-code'})),'connected');
 assert.equal(spotify.status('user@example.com').connected,true);
 assert.ok(!db.prepare('SELECT value FROM spotify_tokens').get().value.includes('private-test-refresh'));
 assert.ok(!JSON.stringify(spotify.status('user@example.com')).includes('access'));
 await assert.rejects(spotify.callback(new URLSearchParams({state,code:'replayed'})),/already used/);
 assert.deepEqual(await spotify.token('user@example.com'),{accessToken:'short-lived-test-access'});
 await assert.rejects(spotify.token('different@example.com'),/Connect your Spotify/);
});
test('OAuth denies unknown states and expired Orbit sessions before exchanging a code',async()=>{
 let called=false;globalThis.fetch=async()=>{called=true;throw Error('Must not exchange');};
 await assert.rejects(spotify.callback(new URLSearchParams({state:'0'.repeat(64),code:'x'})),/expired or already used/);
 const start=spotify.connect('user@example.com','not-a-valid-session'),state=new URL(start.url).searchParams.get('state');
 await assert.rejects(spotify.callback(new URLSearchParams({state,code:'x'})),/Orbit session expired/);assert.equal(called,false);
});
test('Playback commands validate device and context, then call the exact Spotify API',async()=>{
 let called=0;globalThis.fetch=async(url,options)=>{called++;assert.equal(url,'https://api.spotify.com/v1/me/player');assert.equal(options.method,'PUT');assert.deepEqual(JSON.parse(options.body),{device_ids:['device123'],play:false});return new Response(null,{status:204});};
 await assert.rejects(spotify.command('user@example.com',{action:'remove',device:'device123'}),/Unsupported/);
 await assert.rejects(spotify.command('user@example.com',{action:'play',device:'device123',context:'https://evil.example'}),/playlist or album/);
 assert.deepEqual(await spotify.command('user@example.com',{action:'transfer',device:'device123'}),{ok:true});assert.equal(called,1);
 spotify.disconnect('user@example.com');assert.equal(spotify.status('user@example.com').connected,false);await assert.rejects(spotify.token('user@example.com'),/Connect your Spotify/);
});
test('Expired access tokens refresh server-side without exposing the refresh token',async()=>{
 const start=spotify.connect('user@example.com','session-hash'),state=new URL(start.url).searchParams.get('state');let count=0;
 globalThis.fetch=async(url,options)=>{count++;const params=new URLSearchParams(options.body);if(count===1)return Response.json({access_token:'expires-soon',refresh_token:'server-only-refresh',expires_in:1});assert.equal(params.get('grant_type'),'refresh_token');assert.equal(params.get('refresh_token'),'server-only-refresh');return Response.json({access_token:'renewed-access',expires_in:3600});};
 await spotify.callback(new URLSearchParams({state,code:'new-code'}));assert.deepEqual(await spotify.token('user@example.com'),{accessToken:'renewed-access'});assert.deepEqual(await spotify.token('user@example.com'),{accessToken:'renewed-access'});assert.equal(count,2);
 assert.ok(!JSON.stringify(spotify.status('user@example.com')).includes('server-only-refresh'));
});
