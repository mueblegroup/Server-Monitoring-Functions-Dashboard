import {test} from 'node:test';
import assert from 'node:assert/strict';
import {weatherKind,weatherIcon,createLoadIndicator} from '../public/motion.mjs';
test('weather animations match conditions and use a moon at night',()=>{
 for(const [code,kind] of [[0,'clear'],[2,'partly'],[3,'cloudy'],[45,'fog'],[63,'rain'],[75,'snow'],[95,'storm'],[null,'unknown'],[999,'unknown']])assert.equal(weatherKind(code),kind);
 assert.match(weatherIcon(0,false),/class="weather-moon"/);assert.doesNotMatch(weatherIcon(0,false),/class="weather-sun"/);
 assert.match(weatherIcon(95),/class="weather-lightning"/);assert.match(weatherIcon(63),/class="weather-rain"/);
 assert.doesNotMatch(weatherIcon('<script>alert(1)</script>'),/<script>/);
});
test('loading indicator waits for overlapping requests and settles after failures or completion',async()=>{
 const element={hidden:true},begin=createLoadIndicator(element,{delay:5,settle:5});
 const first=begin(),second=begin();await new Promise(r=>setTimeout(r,15));assert.equal(element.hidden,false);
 first();first();await new Promise(r=>setTimeout(r,15));assert.equal(element.hidden,false);
 second();await new Promise(r=>setTimeout(r,15));assert.equal(element.hidden,true);
 const fast=begin();fast();await new Promise(r=>setTimeout(r,15));assert.equal(element.hidden,true);
});
