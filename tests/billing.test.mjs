import {test} from 'node:test';
import assert from 'node:assert/strict';
import {billCycle,countdown} from '../public/billing.mjs';
import {validateWorkspace} from '../workspace.mjs';
test('month-end bills clamp dates without drifting their original day',()=>{
 const bill={amount:310,frequency:'monthly',anchorDate:'2026-01-31'};
 assert.equal(billCycle(bill,'2026-02-01').due,'2026-02-28');
 assert.equal(billCycle(bill,'2026-03-01').due,'2026-03-31');
 assert.equal(billCycle(bill,'2026-03-31').daysLeft,0);
 assert.equal(billCycle(bill,'2026-04-01').due,'2026-04-30');
});
test('yearly fees have calendar proration, monthly equivalents and leap-year dates',()=>{
 const b={amount:1200,frequency:'yearly',anchorDate:'2024-02-29'};
 const c=billCycle(b,'2025-02-28');assert.equal(c.monthly,100);assert.equal(c.yearly,1200);assert.equal(c.allocated,1200);assert.equal(c.remaining,0);
 assert.equal(billCycle(b,'2028-02-01').due,'2028-02-29');
 assert.equal(countdown('2026-11-15',30,'2026-11-16').days,-1);
});
test('workspace validates fixed bill data and allows only supported tiles',()=>{
 const value={pages:[{id:'test',title:'Home',widgets:[{id:'music',width:6,visible:true}]}],bills:[{id:'phone',name:'Phone',amount:88,currency:'MYR',frequency:'monthly',anchorDate:'2026-11-20'}]};
 assert.deepEqual(validateWorkspace(value),value);
 for(const change of [v=>v.pages[0].widgets[0].id='script',v=>v.bills[0].amount=-1,v=>v.bills[0].anchorDate='2026-02-30',v=>v.bills[0].frequency='daily',v=>v.pages.push(v.pages[0])]){const copy=structuredClone(value);change(copy);assert.throws(()=>validateWorkspace(copy));}
});
