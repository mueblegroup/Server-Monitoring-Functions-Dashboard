import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PresenceClock} from '../public/presence.mjs';
test('break reminders trigger only after thirty minutes of observed person presence',()=>{
 const clock=new PresenceClock();for(let time=0;time<1800000;time+=2000)assert.equal(clock.sample(true,time).due,false);
 assert.equal(clock.sample(true,1800000).due,true);clock.dismiss(1800000);assert.equal(clock.state().due,false);assert.equal(clock.state().elapsedMs,0);assert.equal(clock.sample(true,1802000).elapsedMs,2000);
});
test('brief missed detections do not add time; sustained absence and hidden-tab gaps reset',()=>{
 const clock=new PresenceClock({thresholdMs:100000});clock.sample(true,0);clock.sample(true,2000);clock.sample(false,4000);clock.sample(true,6000);assert.equal(clock.elapsed,2000);
 for(let time=8000;time<=68000;time+=2000)clock.sample(false,time);assert.equal(clock.elapsed,0);
 clock.sample(true,70000);clock.sample(true,72000);assert.equal(clock.elapsed,2000);clock.sample(true,100000);assert.equal(clock.elapsed,0);clock.sample(true,90000);assert.equal(clock.elapsed,0);
});
