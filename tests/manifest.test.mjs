import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
test('MV3 manifest is Meet-only, minimal permission, all entry points exist', async () => {
 const root = new URL('../', import.meta.url);
 const m = JSON.parse(await readFile(new URL('manifest.json',root)));
 assert.equal(m.manifest_version,3);
 assert.deepEqual(m.permissions,['storage','identity']);
 assert.equal(m.host_permissions,undefined);
 assert.deepEqual(m.content_scripts[0].matches,['https://meet.google.com/*']);
 assert.equal(m.content_scripts[0].all_frames,false);
 assert.equal(m.background.type,'module');
 for(const path of [...m.content_scripts[0].js,m.background.service_worker,m.action.default_popup]) await access(new URL(path,root));
});
