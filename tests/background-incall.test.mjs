import {test} from 'node:test';
import assert from 'node:assert/strict';

test('meeting transition records the event without dispatching a bot',async t=>{
 const values={backendConnection:{backendUrl:'http://localhost:4000',token:'saved-user-token'}};
 const listeners=[];
 const storage={get:async key=>({[key]:values[key]}),set:async v=>Object.assign(values,v),setAccessLevel:async()=>{},remove:async()=>{}};
 const previousChrome=globalThis.chrome,previousFetch=globalThis.fetch;
 t.after(()=>{globalThis.chrome=previousChrome;globalThis.fetch=previousFetch;});
 globalThis.chrome={storage:{local:storage},runtime:{id:'fixture',getURL:p=>'chrome-extension://fixture/'+p,onMessage:{addListener:f=>listeners.push(f)},onStartup:{addListener:()=>{}},onInstalled:{addListener:()=>{}}},tabs:{onRemoved:{addListener:()=>{}}}};
 globalThis.chrome.action={onClicked:{addListener:()=>{}}};
 let calls=0;
 globalThis.fetch=async ()=>{calls++;return new Response('{}',{status:200});};
 await import('../background.js?incall-test');
 const event={inCall:true,meetingUrl:'https://meet.google.com/abc-defg-hij',requestId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',detectedAt:new Date().toISOString()};
 await new Promise((resolve,reject)=>{
  const listener=listeners[1];
  const result=listener({type:'meet.transition',event},{id:'fixture',frameId:0,tab:{id:7},url:event.meetingUrl},response=>response.ok?resolve():reject(Error('transition rejected')));
  assert.equal(result,true);
 });
 await new Promise(resolve=>setTimeout(resolve,50));
 assert.equal(calls,0);
});
