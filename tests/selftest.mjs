/*
 * Offline self-test with fully fictional data. No real credentials here.
 * Run: node tests/selftest.mjs
 */
import B from '../src/core.js';
import assert from 'node:assert/strict';

const servers = B.normalize([
  {
    name: '测试服务器 A', serverName: '测试 A', type: 'emby',
    url: 'https://emby-a.example.com:8920', username: 'alice', password: 'pw-123',
    userId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', accessToken: '0123456789abcdef0123456789abcdef',
    icon: 'https://example.com/icon.png',
    lines: [
      { name: '默认', url: 'https://emby-a.example.com:8920', active: true },
      { name: '反代', url: 'https://proxy.example.com/emby', active: false }
    ]
  },
  {
    name: '测试服务器 B', type: 'jellyfin', url: 'http://192.168.1.20:8096',
    username: 'bob', password: 'pw-456', userId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    accessToken: 'ffffffffffffffffffffffffffffffff',
    lines: [{ name: '默认', url: 'http://192.168.1.20:8096', active: true }]
  }
]);

const norm = u => String(u || '').replace(/\/+$/, '').replace(/:80(\/|$)/, '$1').replace(/:443(\/|$)/, '$1');
// WWPlayer V1 has no provider/type field; it always reads back as Emby.
const core = (s, withType) => JSON.stringify({
  name: s.name, url: norm(s.url), username: s.username, password: s.password,
  userId: s.userId, accessToken: s.accessToken, type: withType ? s.type : '',
  lines: s.lines.map(l => norm(l.url)).sort()
});

let checked = 0;
for (const src of B.FORMATS) {
  const built = await B.build(servers, src);
  assert.equal(B.detect(built.text, built.filename), src, `detect ${src}`);
  const back = (await B.parse(built.text, src)).servers;
  assert.equal(back.length, servers.length, `count ${src}`);
  for (let i = 0; i < servers.length; i++) {
    if (src === 'afusekt') {
      // AfuseKt has no User ID / Access Token fields by design.
      assert.equal(back[i].name, servers[i].name, `afusekt name ${i}`);
      assert.equal(norm(back[i].url), norm(servers[i].url), `afusekt url ${i}`);
      assert.equal(back[i].username, servers[i].username, `afusekt user ${i}`);
    } else {
      const withType = src !== 'wwplayer';
      assert.equal(core(back[i], withType), core(servers[i], withType), `round-trip ${src} #${i}`);
    }
  }
  checked++;
}
for (const dst of B.FORMATS.concat(['bridge'])) {
  for (const src of B.FORMATS) {
    const one = (await B.parse((await B.build(servers, src)).text, src)).servers;
    await B.build(one, dst);
  }
}
const csv = B.toCsv(servers);
assert.equal(B.parseCsv(csv).length, 2, 'csv round-trip');
assert.equal(B.parseQuickText('名称 | https://x.example.com | u | p').length, 1, 'quick text');
console.log(`OK: ${checked} formats round-tripped, 7x8 cross-format builds, CSV and quick text passed.`);
