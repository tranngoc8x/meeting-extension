import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const source = await readFile(new URL('../detector.js', import.meta.url), 'utf8').catch(() => '/* detector not implemented */');
const call = '<div role="toolbar"><button aria-label="Leave call">End</button></div>';
async function fixture(t, html) {
  const browser = await chromium.launch({headless:true, channel: process.env.CHROME_CHANNEL || "chrome"});
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(html);
  await page.addScriptTag({content: source});
  await page.evaluate(() => {
    window.events = [];
    window.detector = window.MeetDetector.create({document, getUrl: () => window.room || 'https://meet.google.com/abc-defg-hij?authuser=1', onTransition: e => events.push(e)});
  });
  return page;
}
const settle = p => p.waitForTimeout(120);
test('prejoin/waiting is silent; join emits once; mutation burst coalesces; exit emits once', async t => {
  const p = await fixture(t, '<main><button>Join now</button><p>Waiting for admission</p></main>');
  assert.deepEqual(await p.evaluate(() => events), []);
  await p.evaluate(html => document.querySelector('main').innerHTML = html, call);
  await settle(p);
  assert.equal(await p.evaluate(() => events.length), 1);
  assert.equal(await p.evaluate(() => events[0].inCall), true);
  await p.evaluate(() => { for(let i=0;i<100;i++) document.querySelector('button').setAttribute('aria-label', 'Leave call'); });
  await settle(p);
  assert.equal(await p.evaluate(() => events.length), 1);
  await p.evaluate(() => document.querySelector('main').innerHTML = '<p>You left</p>');
  await settle(p);
  assert.deepEqual(await p.evaluate(() => events.map(e=>e.inCall)), [true,false]);
});
test('initial in-call, hidden controls, UI replacement, room change and teardown', async t => {
  const p = await fixture(t, `<section><main>${call}</main></section>`);
  assert.equal(await p.evaluate(() => events.length), 1);
  await p.evaluate(() => document.querySelector('main').hidden = true);
  await settle(p);
  assert.equal(await p.evaluate(() => events.at(-1).inCall), false);
  await p.evaluate(html => document.querySelector('section').outerHTML = `<section><main>${html}</main></section>`, call);
  await settle(p);
  assert.equal(await p.evaluate(() => events.at(-1).inCall), true);
  await p.evaluate(() => { window.room='https://meet.google.com/xyz-abcd-efg'; window.dispatchEvent(new PopStateEvent('popstate')); });
  await settle(p);
  assert.equal(await p.evaluate(() => events.at(-1).meetingUrl), 'https://meet.google.com/xyz-abcd-efg');
  await p.evaluate(() => detector.stop());
  const n = await p.evaluate(() => events.length);
  await p.evaluate(() => document.querySelector('main').remove());
  await settle(p);
  assert.equal(await p.evaluate(() => events.length), n);
});
test('late root, localized icon, unrelated mutations and disabled/hidden buttons', async t => {
  const p = await fixture(t, '<div id="shell"></div><aside></aside>');
  await p.evaluate(() => document.querySelector('#shell').innerHTML = '<main><div role="toolbar"><button aria-label="Rời cuộc gọi" disabled>Exit</button></div></main>');
  await settle(p);
  assert.equal(await p.evaluate(() => events.length),0);
  await p.evaluate(() => document.querySelector('button').disabled = false);
  await settle(p);
  assert.equal(await p.evaluate(() => events.length),1);
  const checks = await p.evaluate(() => detector.stats.checks);
  await p.evaluate(() => { for(let i=0;i<100;i++) document.querySelector('aside').append(document.createElement('span')); });
  await settle(p);
  assert.equal(await p.evaluate(() => detector.stats.checks),checks);
  await p.evaluate(() => document.querySelector('main').innerHTML='<button><i class="google-symbols">call_end</i></button>');
  await settle(p);
  assert.equal(await p.evaluate(() => events.length),1);
});
test('URL normalization rejects arbitrary hosts and room paths', async t => {
  const p = await fixture(t,'<main></main>');
  assert.deepEqual(await p.evaluate(() => ['https://meet.google.com/abc-defg-hij?x=1#x','https://evil.test/abc-defg-hij','https://meet.google.com/lookup/name','http://meet.google.com/abc-defg-hij'].map(MeetDetector.normalizeUrl)), ['https://meet.google.com/abc-defg-hij',null,null,null]);
});
