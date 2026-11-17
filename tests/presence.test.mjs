import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PresenceClock,PersonPresence} from '../public/presence.mjs';
test('relaxed person detection needs repeated weak evidence and survives brief misses',()=>{
 const person=new PersonPresence();
 assert.equal(person.sample(.3,0).present,false);
 assert.equal(person.sample(0,2000).present,false);
 assert.equal(person.sample(.32,4000).present,true);
 assert.deepEqual(person.sample(0,6000),{present:true,held:true,score:0});
 assert.equal(person.sample(.18,8000).present,true);
 assert.equal(person.sample(0,20000).present,true);
 assert.equal(person.sample(0,22000).present,false);
});
test('isolated weak detections cannot acquire presence and stale frames cannot retain it',()=>{
 const person=new PersonPresence();person.sample(.3,0);person.sample(0,2000);person.sample(0,4000);
 assert.equal(person.sample(.3,6000).present,false);
 assert.equal(person.sample(.7,8000).present,true);
 assert.equal(person.sample(0,40000).present,false);
 person.sample(.7,42000);assert.equal(person.sample(0,1000).present,false);
});
test('slow but regular tablet inference can accumulate a break session',()=>{
 const clock=new PresenceClock({maxGapMs:30000}),person=new PersonPresence();
 for(let now=0;now<=1800000;now+=15000)clock.sample(person.sample(.7,now).present,now);
 assert.equal(clock.state().due,true);
});
test('break reminders trigger only after thirty minutes of observed person presence',()=>{
 const clock=new PresenceClock();for(let time=0;time<1800000;time+=2000)assert.equal(clock.sample(true,time).due,false);
 assert.equal(clock.sample(true,1800000).due,true);clock.dismiss(1800000);assert.equal(clock.state().due,false);assert.equal(clock.state().elapsedMs,0);assert.equal(clock.sample(true,1802000).elapsedMs,2000);
});
test('brief missed detections do not add time; sustained absence and hidden-tab gaps reset',()=>{
 const clock=new PresenceClock({thresholdMs:100000});clock.sample(true,0);clock.sample(true,2000);clock.sample(false,4000);clock.sample(true,6000);assert.equal(clock.elapsed,2000);
 for(let time=8000;time<=68000;time+=2000)clock.sample(false,time);assert.equal(clock.elapsed,0);
 clock.sample(true,70000);clock.sample(true,72000);assert.equal(clock.elapsed,2000);clock.sample(true,100000);assert.equal(clock.elapsed,0);clock.sample(true,90000);assert.equal(clock.elapsed,0);
});
