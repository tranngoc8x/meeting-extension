import { test } from 'node:test';
import assert from 'node:assert/strict';
const { recordTransition } = await import('../events.js').catch(() => ({recordTransition:undefined}));
function storage() {
 const data = {};
 return {data, get: async key=>({[key]:structuredClone(data[key])}), set:async values=>Object.assign(data,structuredClone(values))};
}
const event = {inCall:true, meetingUrl:'https://meet.google.com/abc-defg-hij', requestId:'11111111-1111-4111-8111-111111111111', detectedAt:'2026-11-13T00:00:00.000Z'};
test('same event retry and reload retain ID; leave/rejoin and room change get new IDs', async()=>{
 const s=storage();
 const first=await recordTransition(s,1,event);
 assert.equal((await recordTransition(s,1,{...event,requestId:'22222222-2222-4222-8222-222222222222'})).requestId,first.requestId);
 await recordTransition(s,1,{...event,inCall:false});
 const rejoin=await recordTransition(s,1,{...event,requestId:'33333333-3333-4333-8333-333333333333'});
 assert.notEqual(rejoin.requestId,first.requestId);
 assert.notEqual((await recordTransition(s,2,event)).tabId,rejoin.tabId);
 assert.equal(Object.keys(s.data).length,2);
});
test('storage failure is reported; retry keeps candidate ID; invalid input rejected', async()=>{
 const s=storage();
 await assert.rejects(()=>recordTransition({...s,set:async()=>{throw Error('disk');}},1,event),/disk/);
 assert.equal((await recordTransition(s,1,event)).requestId,event.requestId);
 await assert.rejects(()=>recordTransition(s,1,{...event,meetingUrl:'https://evil.test'}));
});
