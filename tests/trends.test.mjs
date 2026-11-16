import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sampleTrend,sparkline} from '../public/trends.mjs';
test('Trend sampling deduplicates and bounds session history without inventing values',()=>{
 assert.deepEqual(sampleTrend('test',1,24),[{time:1,value:24}]);
 assert.equal(sampleTrend('test',1,24).length,1);
 assert.equal(sampleTrend('test',2,NaN).length,1);
 assert.deepEqual(sampleTrend('test',2000,60),[{time:2000,value:60}]);
});
test('Sparkline requires two real samples and escapes its accessible label',()=>{
 assert.match(sparkline([{time:1,value:10}],'CPU'),/Collecting history/);
 const svg=sparkline([{time:1,value:10},{time:2,value:25}],'<private>',100);
 assert.match(svg,/<svg/);assert.ok(svg.includes('&lt;private&gt;'));assert.ok(!svg.includes('NaN'));
});
