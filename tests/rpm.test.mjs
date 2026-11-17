import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rpmGauge,hostGauges,gaugeDefaults} from '../public/rpm.mjs';
test('RPM arc clamps its scale without changing the measured reading and rejects CSS injection',()=>{
 assert.match(rpmGauge(140,{label:'Fan',unit:'RPM',max:100,color:'#ff0000'}),/stroke-dasharray="75 25"/);assert.match(rpmGauge(140,{unit:'RPM'}),/140/);assert.match(rpmGauge(null),/unavailable/);
 const value=rpmGauge(10,{label:'<script>',color:'red" onload="alert(1)'});assert.ok(!value.includes('<script>'));assert.ok(!value.includes('onload='));assert.match(value,/stroke="#c4f284"/);
});
test('hardware gauges preserve percentage fan units and never invent a health score',()=>{
 const value=hostGauges({stats:{cpu:.5,memory:{used:1,total:2},rootfs:{used:10,total:100}},sensors:{temperatures:[{celsius:43}],fans:[{percent:36.8}]}},gaugeDefaults());assert.match(value,/Fan speed: 37 %/);assert.match(value,/Temperature: 43 °C/);assert.match(value,/Root disk: 10 %/);assert.match(hostGauges({sensors:{fans:[{rpm:2000}]}}),/Fan speed: 2000 RPM/);
});
