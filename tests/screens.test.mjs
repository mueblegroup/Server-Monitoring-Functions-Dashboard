import {test} from 'node:test';
import assert from 'node:assert/strict';
import {packScreens} from '../public/screens.mjs';
test('Phone screen packing preserves order and puts full-width widgets on separate screens',()=>{
 const cards=[{id:'cpu',width:4},{id:'memory',width:6},{id:'network',width:12}];
 assert.deepEqual(packScreens(cards,1,1),cards.map(({id})=>[{id,span:1}]));
});
test('Tablet pages fill available cells without losing widgets',()=>{
 const cards=Array.from({length:7},(_,id)=>({id,width:4}));const pages=packScreens(cards,2,2);
 assert.deepEqual(pages.map(page=>page.length),[4,3]);assert.deepEqual(pages.flat().map(c=>c.id),cards.map(c=>c.id));
});
test('Wide widgets reserve complete rows and never overflow a screen',()=>{
 const cards=[{id:1,width:4},{id:2,width:12},{id:3,width:6},{id:4,width:6}];
 const pages=packScreens(cards,3,2);
 assert.deepEqual(pages,[[{id:1,span:1},{id:2,span:3}],[{id:3,span:2},{id:4,span:2}]]);
 assert.deepEqual(packScreens([],1,1),[]);
});
