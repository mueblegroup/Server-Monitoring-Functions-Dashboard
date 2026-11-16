let sdkPromise;
function loadSDK(){
  if(window.Spotify?.Player)return Promise.resolve();
  if(sdkPromise)return sdkPromise;
  sdkPromise=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{sdkPromise=null;reject(Error('Spotify player timed out. Check browser tracking protection and connectivity.'));},20000);
    window.onSpotifyWebPlaybackSDKReady=()=>{clearTimeout(timer);resolve();};
    const script=document.createElement('script');script.src='https://sdk.scdn.co/spotify-player.js';
    script.onerror=()=>{clearTimeout(timer);sdkPromise=null;reject(Error('Spotify player could not load. Check browser tracking protection.'));};document.head.append(script);
  });return sdkPromise;
}
export function spotifyContext(value){
  const raw=String(value||'').trim();if(/^spotify:(playlist|album):[a-zA-Z0-9]{10,100}$/.test(raw))return raw;
  try{const url=new URL(raw);if(url.protocol==='https:'&&url.hostname==='open.spotify.com'){const match=url.pathname.match(/^\/(?:intl-[a-z]+\/)?(playlist|album)\/([a-zA-Z0-9]{10,100})\/?$/);if(match)return `spotify:${match[1]}:${match[2]}`;}}catch{}
  throw Error('Paste a Spotify playlist or album Share link.');
}
const time=ms=>`${Math.floor(Math.max(0,ms)/60000)}:${String(Math.floor(Math.max(0,ms)/1000)%60).padStart(2,'0')}`;
export function mountSpotify(card,{api,toast,openModal,onYouTube,demo=false}){
  let active=true,player,device=null,state=null,syncedAt=Date.now(),connected=false,lastVolume=.4;
  card.classList.add('spotify-card');
  card.innerHTML='<div class="spotify-top"><div class="spotify-art-placeholder" aria-hidden="true">&#9835;</div><img class="spotify-art" alt="Current album cover" hidden><div class="spotify-meta"><span class="spotify-wordmark">SPOTIFY</span><h2 class="spotify-title">Your music, in Orbit.</h2><p class="spotify-artist">Connect your Spotify Premium account.</p><div class="spotify-account-actions"><button type="button" class="small-button spotify-account">Connect Spotify</button><button type="button" class="small-button spotify-youtube">YouTube</button></div></div></div><div class="spotify-timeline"><input class="spotify-seek" type="range" min="0" max="1" value="0" aria-label="Playback position" disabled><div class="spotify-times"><span class="spotify-elapsed">0:00</span><span class="spotify-duration">0:00</span></div></div><div class="spotify-controls"><button type="button" class="spotify-control" data-control="previousTrack" aria-label="Previous track" disabled>&#9198;</button><button type="button" class="spotify-play" data-control="togglePlay" aria-label="Play" disabled>&#9654;</button><button type="button" class="spotify-control" data-control="nextTrack" aria-label="Next track" disabled>&#9197;</button><button type="button" class="spotify-control spotify-mute" aria-label="Mute" disabled>&#9834;</button><input class="spotify-volume" type="range" min="0" max="100" value="40" aria-label="Volume" disabled><span class="spotify-volume-value">40</span></div><div class="spotify-bottom"><button type="button" class="small-button spotify-transfer" disabled>Use this device</button><button type="button" class="small-button spotify-choose" disabled>Choose music</button><a href="https://open.spotify.com/" target="_blank" rel="noreferrer">Open Spotify</a></div><p class="spotify-status" role="status">Spotify Premium and a connected Spotify Developer app are required.</p>';
  const $=selector=>card.querySelector(selector),status=message=>{if(active)$('.spotify-status').textContent=message;};
  const ready=value=>card.querySelectorAll('[data-control],.spotify-seek,.spotify-mute,.spotify-volume,.spotify-transfer,.spotify-choose').forEach(el=>el.disabled=!value);
  async function action(fn){try{await fn();}catch(error){status(error.message||'Playback action failed.');}}
  function paint(next){
    if(!active)return;state=next;syncedAt=Date.now();const track=state?.track_window?.current_track;
    $('.spotify-title').textContent=track?.name||'Ready to play';$('.spotify-artist').textContent=track?track.artists.map(a=>a.name).join(' · ')+' · '+track.album.name:'Choose music, or select Orbit Dashboard in Spotify Connect.';
    $('.spotify-bottom a').href=/^[a-zA-Z0-9]{10,100}$/.test(track?.id||'')?'https://open.spotify.com/track/'+track.id:'https://open.spotify.com/';
    const artwork=track?.album?.images?.[0]?.url;let safe=false;try{safe=new URL(artwork).protocol==='https:';}catch{}
    $('.spotify-art').hidden=!safe;$('.spotify-art-placeholder').hidden=safe;if(safe)$('.spotify-art').src=artwork;
    $('.spotify-seek').max=String(state?.duration||1);$('.spotify-duration').textContent=time(state?.duration||0);
    $('.spotify-play').textContent=state&&!state.paused?'❚❚':'▶';$('.spotify-play').setAttribute('aria-label',state&&!state.paused?'Pause':'Play');tick();
  }
  function tick(){if(!active)return;const position=state?Math.min(state.duration,state.position+(state.paused?0:Date.now()-syncedAt)):0;$('.spotify-elapsed').textContent=time(position);if(document.activeElement!==$('.spotify-seek'))$('.spotify-seek').value=String(position);}
  $('.spotify-youtube').onclick=onYouTube;
  if(demo)$('.spotify-account').disabled=true;
  $('.spotify-account').onclick=()=>action(async()=>{if(connected){await api('spotify/disconnect',{method:'POST',body:'{}'});player?.disconnect();connected=false;ready(false);$('.spotify-account').textContent='Connect Spotify';status('Spotify disconnected.');}else{const result=await api('spotify/connect',{method:'POST',body:'{}'});location.assign(result.url);}});
  card.querySelectorAll('[data-control]').forEach(button=>button.onclick=()=>action(async()=>{await player.activateElement();if(button.dataset.control==='togglePlay'&&!state){await api('spotify/command',{method:'POST',body:JSON.stringify({action:'play',device})});}else await player[button.dataset.control]();}));
  $('.spotify-seek').onchange=()=>action(()=>player.seek(Number($('.spotify-seek').value)));
  $('.spotify-volume').onchange=()=>action(async()=>{lastVolume=Number($('.spotify-volume').value)/100;await player.setVolume(lastVolume);$('.spotify-volume-value').textContent=String(Math.round(lastVolume*100));});
  $('.spotify-mute').onclick=()=>action(async()=>{const volume=await player.getVolume(),next=volume>0?0:lastVolume||.4;await player.setVolume(next);$('.spotify-volume').value=String(Math.round(next*100));$('.spotify-volume-value').textContent=String(Math.round(next*100));$('.spotify-mute').setAttribute('aria-label',next===0?'Unmute':'Mute');});
  $('.spotify-transfer').onclick=()=>action(async()=>{await player.activateElement();await api('spotify/command',{method:'POST',body:JSON.stringify({action:'transfer',device})});status('Orbit is selected. Choose music here or start a track in Spotify.');});
  $('.spotify-choose').onclick=()=>{
    openModal('<h2>Choose Spotify music</h2><p>Copy a playlist or album Share link from Spotify.</p><form id="spotify-music-form"><label>Spotify link<input name="context" required placeholder="https://open.spotify.com/playlist/..."></label><button class="primary">Play on Orbit</button><p class="error" role="alert"></p></form>');
    const form=document.querySelector('#spotify-music-form');form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;try{await player.activateElement();await api('spotify/command',{method:'POST',body:JSON.stringify({action:'play',device,context:spotifyContext(form.elements.context.value)})});form.closest('dialog').close();status('Playing on Orbit Dashboard.');}catch(error){form.querySelector('.error').textContent=error.message;}finally{button.disabled=false;}};
  };
  (async()=>{
    try{
      if(demo){status('Spotify playback is available after signing in and connecting your account.');return;}
      const account=await api('spotify/status');if(!active)return;connected=account.connected;
      if(!account.configured){status('Set SPOTIFY_CLIENT_ID in Orbit .env. Register '+account.redirectUri+' as your app redirect URI.');return;}
      if(!connected){status('Connect Spotify to authorize playback. Spotify Premium is required.');return;}
      $('.spotify-account').textContent='Disconnect';status('Starting Spotify player...');await loadSDK();if(!active)return;
      player=new window.Spotify.Player({name:'Orbit Dashboard',volume:.4,getOAuthToken:callback=>{api('spotify/token',{method:'POST',body:'{}'}).then(result=>{if(active)callback(result.accessToken);}).catch(error=>status(error.message));}});
      for(const event of ['initialization_error','authentication_error','account_error','playback_error'])player.addListener(event,({message})=>status(message));
      player.addListener('ready',({device_id})=>{if(!active)return;device=device_id;ready(true);status('Ready. Select Use this device, or choose a playlist.');});
      player.addListener('not_ready',()=>{device=null;ready(false);status('Spotify device is offline. Reconnect or reload.');});
      player.addListener('player_state_changed',paint);if(!await player.connect())status('Spotify could not connect. Check Premium and browser playback support.');
    }catch(error){status(error.message);}
  })();
  const ticker=setInterval(tick,1000);
  return ()=>{active=false;clearInterval(ticker);player?.disconnect();card.classList.remove('spotify-card');};
}
