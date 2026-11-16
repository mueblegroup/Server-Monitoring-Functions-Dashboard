import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultExperience,placementsValid,energySummary,billingTotals,healthAlerts} from '../public/experience-data.mjs';
import {validateExperience} from '../experience-state.mjs';
import {isNight} from '../public/kiosk.mjs';
test('orientation layouts reject overlaps, out of bounds and unsupported tiles',()=>{
 const value=defaultExperience();value.layouts.overview={portrait:[{id:'cpu',x:0,y:0,w:12,h:2}],landscape:[{id:'cpu',x:0,y:0,w:6,h:3},{id:'memory',x:6,y:0,w:6,h:3}]};assert.deepEqual(validateExperience(value),value);
 for(const change of [v=>v.layouts.overview.landscape[1].x=5,v=>v.layouts.overview.portrait[0].h=7,v=>v.layouts.overview.portrait[0].id='script',v=>v.layouts.overview.portrait[0].x=.5,v=>v.appearance.accent='red;position:fixed',v=>v.kiosk.pages=['javascript:alert(1)'],v=>v.electricity.rate=-1,v=>v.stack.items=[]]){const copy=structuredClone(value);change(copy);assert.throws(()=>validateExperience(copy));}
 assert.equal(placementsValid([{id:'cpu',x:0,y:0,w:6,h:2},{id:'memory',x:6,y:0,w:6,h:2}],['cpu','memory']),true);
});
test('energy integrates actual power samples and excludes missing-data gaps',()=>{
 const samples=[{time:0,watts:100},{time:60000,watts:200},{time:120000,watts:100},{time:3600000,watts:500}];const summary=energySummary(samples);assert.ok(Math.abs(summary.kwh-.005)<1e-10);assert.equal(summary.coveredHours,2/60);
 assert.deepEqual(energySummary([{time:0,watts:140}]),{kwh:0,coveredHours:0});
});
test('billing totals keep currencies separate and prorate yearly fees',()=>{
 const b=(id,amount,currency,frequency)=>({id,name:id,amount,currency,frequency,anchorDate:'2026-11-20'});
 const t=billingTotals([b('phone',100,'MYR','monthly'),b('annual',1200,'MYR','yearly'),b('usd',12,'USD','monthly')],'2026-11-16');assert.equal(t.currencies.MYR.monthly,200);assert.equal(t.currencies.MYR.yearly,2400);assert.equal(t.currencies.USD.monthly,12);assert.equal(t.upcoming[0].daysLeft,4);
});
test('health alerts honor hardware thresholds and expose stale readings',()=>{
 const settings=defaultExperience().alerts,s={updatedAt:new Date(0).toISOString(),nodes:[{node:'offline',status:'offline'}],sensors:{temperatures:[{label:'Zone 30',celsius:78,warningCelsius:110},{label:'CPU',celsius:95,warningCelsius:90}]},storage:[{storage:'local',used:95,total:100}]};const messages=healthAlerts(s,[],settings,100000).map(a=>a.text).join(' ');assert.match(messages,/stale/);assert.match(messages,/offline/);assert.match(messages,/CPU/);assert.match(messages,/local/);assert.doesNotMatch(messages,/Zone 30/);
});
test('kiosk dimming supports overnight ranges and disabled equal hours',()=>{assert.equal(isNight(23,22,7),true);assert.equal(isNight(6,22,7),true);assert.equal(isNight(12,22,7),false);assert.equal(isNight(12,12,12),false);});
