import {test} from 'node:test';
import assert from 'node:assert/strict';
import {playlistId,defaultLayout} from '../public/dashboard.mjs';
test('Music accepts playlist shares and rejects arbitrary origins and injected URLs',()=>{
 assert.equal(playlistId('https://music.youtube.com/playlist?list=PL123456789&si=abc'),'PL123456789');
 assert.equal(playlistId('https://www.youtube.com/watch?v=video&list=PL123456789'),'PL123456789');
 assert.equal(playlistId('PL123456789'),'PL123456789');assert.equal(playlistId(''),'');
 for(const input of ['javascript:alert(1)','https://attacker.example/?list=PL123456789','https://youtube.com.attacker.example/?list=PL123456789','https://music.youtube.com/playlist?list=%22%3E'])assert.throws(()=>playlistId(input),/playlist/);
 assert.deepEqual(defaultLayout().widgets.slice(0,6).map(w=>w.id),['clock','music','cpu','memory','health','network']);
});
