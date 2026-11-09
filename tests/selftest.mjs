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
// Regression: official Hills exports use a different CBC IV tail, so only the
// first 16-byte plaintext block is garbled while every later block is intact.
// The parser must rebuild the JSON head instead of throwing.
{
  const hillsKey = Buffer.from('9d2729bd3afe5536669610e25b3ef6b3a7fd1efe2a065187101b144951617bce', 'hex');
  const altIv = Buffer.from('bc322377137f312c35f13c9f10ae8993', 'hex');
  const inner = { data: [{
    displyName: '虚构 Hills', serverName: '虚构 Hills', serverUrl: 'https://hills.example.com:8920',
    username: 'demo', password: 'demo-pw',
    authenticateJson: JSON.stringify({ User: { Id: 'uid-123', Name: 'demo' }, AccessToken: 'tok-456' }),
    orderIndex: 0,
    serverRoutingList: [{ id: 'r1', name: '反代', url: 'https://proxy.example.com' }]
  }] };
  const innerText = JSON.stringify(inner).replace(/\}$/, '');
  const cipher = await B._internal.cbcEncrypt(hillsKey, altIv, new TextEncoder().encode(innerText));
  const fake = JSON.stringify({
    version: 2, data: Buffer.from(cipher).toString('base64'),
    settings: null, mpvConf: null, iconPacks: null, customIcons: null
  });
  assert.equal(B.detect(fake, 'HillsBackup-test.json'), 'hills', 'detect official-style hills');
  const got = (await B.parse(fake, 'hills')).servers;
  assert.equal(got.length, 1, 'official-style hills server count');
  assert.equal(norm(got[0].url), norm('https://hills.example.com:8920'), 'official hills url');
  assert.equal(got[0].username, 'demo', 'official hills username');
  assert.equal(got[0].password, 'demo-pw', 'official hills password');
  assert.equal(got[0].accessToken, 'tok-456', 'official hills token');
  assert.ok(got[0].lines.some(l => l.url === 'https://proxy.example.com'), 'official hills route');
}

// Regression: Hills v3 envelope (version 3 plus extra encrypted segments).
// The server list still lives in `data`; detect must not hard-code version 2.
{
  const hillsKey = Buffer.from('9d2729bd3afe5536669610e25b3ef6b3a7fd1efe2a065187101b144951617bce', 'hex');
  const iv = Buffer.from('bc322377137f312c2bff7a920aad959e', 'hex');
  const inner = { data: [{
    displyName: '虚构 v3', serverName: '虚构 v3', serverUrl: 'https://v3.example.com',
    username: 'demo', password: 'pw',
    authenticateJson: JSON.stringify({ User: { Id: 'uid-v3' }, AccessToken: 'tok-v3' }),
    serverRoutingList: [{ id: 'r', name: '反代', url: 'https://route.example.com' }]
  }] };
  const cipher = await B._internal.cbcEncrypt(hillsKey, iv, new TextEncoder().encode(JSON.stringify(inner).replace(/\}$/, '')));
  const v3 = JSON.stringify({
    version: 3, data: Buffer.from(cipher).toString('base64'),
    settings: 'AAAA', mpvConf: null, iconPacks: 'BBBB', customIcons: null,
    enableImpeller: null, serversData: 'CCCC'
  });
  assert.equal(B.detect(v3, 'HillsBackup-261109_1523.json'), 'hills', 'detect hills v3');
  const got = (await B.parse(v3, 'hills')).servers;
  assert.equal(got.length, 1, 'hills v3 server count');
  assert.equal(got[0].accessToken, 'tok-v3', 'hills v3 token');
  assert.equal(got[0].url, 'https://v3.example.com', 'hills v3 url');
}

console.log(`OK: ${checked} formats round-tripped, 7x8 cross-format builds, CSV / quick text / official-style Hills v2+v3 passed.`);
