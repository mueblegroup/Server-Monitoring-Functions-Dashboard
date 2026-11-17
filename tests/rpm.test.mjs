import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rpmGauge,hostGauges,gaugeDefaults,rpmLayout} from '../public/rpm.mjs';
test('all five complete dials fit short and narrow tile interiors without clipping',()=>{
 for(const [width,height] of [[180,100],[220,140],[350,120],[500,220],[120,260]]){
  const layout=rpmLayout(width,height),rows=Math.ceil(5/layout.columns);
  assert.ok(layout.width*layout.columns+5*(layout.columns-1)<=width+.01);
  assert.ok(layout.width*125/140*rows+5*(rows-1)<=height+.01);
  assert.ok(layout.width>0);
 }
 assert.equal(rpmLayout(500,90).columns,5);
});
test('RPM arc clamps its scale without changing the measured reading and rejects CSS injection',()=>{
 assert.match(rpmGauge(140,{label:'Fan',unit:'RPM',max:100,color:'#ff0000'}),/stroke-dasharray="75 25"/);assert.match(rpmGauge(140,{unit:'RPM'}),/140/);assert.match(rpmGauge(null),/unavailable/);
 const value=rpmGauge(10,{label:'<script>',color:'red" onload="alert(1)'});assert.ok(!value.includes('<script>'));assert.ok(!value.includes('onload='));assert.match(value,/stroke="#c4f284"/);
});
test('hardware gauges preserve percentage fan units and never invent a health score',()=>{
 const value=hostGauges({stats:{cpu:.5,memory:{used:1,total:2},rootfs:{used:10,total:100}},sensors:{temperatures:[{celsius:43}],fans:[{percent:36.8}]}},gaugeDefaults());assert.match(value,/Fan speed: 37 %/);assert.match(value,/Temperature: 43 °C/);assert.match(value,/Root disk: 10 %/);assert.match(hostGauges({sensors:{fans:[{rpm:2000}]}}),/Fan speed: 2000 RPM/);
});
