import {test} from 'node:test';
import assert from 'node:assert/strict';

test('meeting transition sends integrations notification with saved user token',async t=>{
 const values={backendConnection:{backendUrl:'http://localhost:4000',token:'saved-user-token'}};
 const listeners=[];
 const storage={get:async key=>({[key]:values[key]}),set:async v=>Object.assign(values,v),setAccessLevel:async()=>{},remove:async()=>{}};
 const previousChrome=globalThis.chrome,previousFetch=globalThis.fetch;
 t.after(()=>{globalThis.chrome=previousChrome;globalThis.fetch=previousFetch;});
 globalThis.chrome={storage:{local:storage},runtime:{id:'fixture',getURL:p=>'chrome-extension://fixture/'+p,onMessage:{addListener:f=>listeners.push(f)},onStartup:{addListener:()=>{}}},tabs:{onRemoved:{addListener:()=>{}}}};
 let complete;
 const sent=new Promise(resolve=>{complete=resolve;});
 globalThis.fetch=async (url,init)=>{complete({url,init});return new Response('{"status":"dispatched"}',{status:200});};
 await import('../background.js?incall-test');
 const event={inCall:true,meetingUrl:'https://meet.google.com/abc-defg-hij',requestId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',detectedAt:new Date().toISOString()};
 await new Promise((resolve,reject)=>{
  const listener=listeners[1];
  const result=listener({type:'meet.transition',event},{id:'fixture',frameId:0,tab:{id:7},url:event.meetingUrl},response=>response.ok?resolve():reject(Error('transition rejected')));
  assert.equal(result,true);
 });
 const {url,init}=await sent;
 assert.equal(url,'http://localhost:4000/integrations/v1/in-call');
 assert.equal(init.method,'POST');assert.equal(init.headers.authorization,'Bearer saved-user-token');assert.deepEqual(JSON.parse(init.body),{meetingUrl:event.meetingUrl});
});
