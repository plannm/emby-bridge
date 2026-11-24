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
    name: '测试服务器 B', type: 'jellyfin', url: 'http://emby-b.example.com:8096',
    username: 'bob', password: 'pw-456', userId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    accessToken: 'ffffffffffffffffffffffffffffffff',
    lines: [{ name: '默认', url: 'http://emby-b.example.com:8096', active: true }]
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
    } else if (src === 'wwmobile') {
      // Android 0.4.9 portable profiles have no password/accessToken fields.
      // credentialsIncluded=true is rejected; unknown keys with false are ignored.
      assert.equal(back[i].name, servers[i].name, `wwmobile name ${i}`);
      assert.equal(norm(back[i].url), norm(servers[i].url), `wwmobile url ${i}`);
      assert.equal(back[i].username, servers[i].username, `wwmobile user ${i}`);
      assert.equal(back[i].userId, servers[i].userId, `wwmobile userId ${i}`);
      assert.equal(back[i].password, '', `wwmobile password stripped ${i}`);
      assert.equal(back[i].accessToken, '', `wwmobile token stripped ${i}`);
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

// Regression: detect a mobile WWPlayer full backup and preserve its document.
{
  const mobile = {
    schemaVersion: 2, exportedAtMs: 1700000000000, credentialsIncluded: false,
    preferences: { themeMode: 'System' },
    servers: [{
      serverId: 'abc123-0123456789abcdef', displayName: '虚构手机端',
      lines: [{ lineId: 'line1-0123456789abcdef', serverUrl: 'https://mobile.example.com', name: '默认', source: '' }],
      activeLineId: 'line1-0123456789abcdef', remoteServerId: '0123456789abcdef0123456789abcdef',
      remark: '', serverType: 'emby', requiresAuthentication: true,
      userId: 'uid-mobile', userName: 'demo'
    }],
    collections: { watchlist: [], playlists: [] },
    playbackHistory: { resumeRecords: [], dismissals: [], continueRecords: [], homeRecords: [] },
    contentSources: [], discoveryHomes: { schemaVersion: 1, activeId: '', pages: [], primaryId: '', enabled: false },
    modules: [], nexusState: { imports: [], bindings: [], homePlaylists: [], extension: {} }
  };
  const text = JSON.stringify(mobile);
  assert.equal(B.detect(text, 'wwplayer-backup.json'), 'wwmobile', 'detect mobile backup');
  const parsed = await B.parse(text, 'wwmobile');
  const got = parsed.servers;
  assert.equal(got.length, 1, 'mobile server count');
  assert.equal(got[0].url, 'https://mobile.example.com', 'mobile url');
  assert.equal(got[0].username, 'demo', 'mobile username');
  const outDoc = JSON.parse((await B.build(got, 'wwmobile', { mode: 'full', context: parsed.context })).text);
  assert.equal(outDoc.preferences.themeMode, 'System', 'mobile preferences preserved');
  assert.equal(outDoc.servers[0].displayName, '虚构手机端', 'mobile server rebuilt');
}

// wwmobile must never emit credential fields, even when the source has them.
{
  const cred = [{ name: 'Secret', url: 'https://secret.example.com', username: 'u', password: 'p', userId: 'id1', accessToken: 'tok', lines: [{ name: 'a', url: 'https://secret.example.com', active: true }] }];
  const doc = JSON.parse((await B.build(cred, 'wwmobile')).text);
  assert.equal(doc.credentialsIncluded, false, 'wwmobile credentialsIncluded must be false');
  assert.equal(doc.preferences.ignoreSslCertificateValidation, false, '手机端新骨架默认验证 TLS 证书');
  assert.ok(!doc.servers.some(s => 'password' in s || 'accessToken' in s), 'wwmobile must not carry password/accessToken');
  assert.equal(doc.servers[0].userId, 'id1', 'wwmobile keeps identity userId');
  // Keep known optional defaults for compatibility. Static inspection found
  // only serverId/displayName/lines/activeLineId required in this profile.
  const reqFields = ['aggregateEnabled', 'aggregateSearchEnabled', 'aggregateContinueWatchingEnabled', 'aggregateFavoritesEnabled', 'aggregatePlaybackSourcesEnabled', 'preloadNextEpisodeEnabled', 'strmEnabled', 'keepAliveDays', 'keepAliveStartedAtMs', 'homePresentation', 'cropIconToCircle', 'serverId', 'displayName', 'lines', 'activeLineId', 'remoteServerId', 'remark', 'serverType', 'requiresAuthentication', 'userId', 'userName'];
  assert.ok(reqFields.every(k => k in doc.servers[0]), 'wwmobile server must have full mobile schema fields');
}

console.log(`OK: ${checked} formats round-tripped, ${B.FORMATS.length}x${B.FORMATS.length + 1} cross-format builds, CSV / quick text / official-style Hills v2+v3 / mobile WWPlayer passed.`);


// Regressions: selected LinPlayer route and conservative merge identity.
{
  const source = B.normalize([{ name: 'Routes', url: 'https://demo.example.com/main', username: 'Demo', password: 'p',
    lines: [{ name: 'Main', url: 'https://demo.example.com/main', active: false }, { name: 'Backup', url: 'https://demo.example.com/backup', active: true }] }]);
  const back = (await B.parse((await B.build(source, 'linplayer')).text, 'linplayer')).servers;
  assert.equal(back[0].activeLine, 1, 'LinPlayer preserves selected backup route');
  const item = (url, username = 'Demo', password = 'p') => B.emptyServer({url, username, password});
  for (const pair of [
    [item('https://demo.example.com/A'), item('https://demo.example.com/a')],
    [item('https://demo.example.com'), item('https://demo.example.com', 'demo')],
    [item('https://demo.example.com'), item('https://demo.example.com', 'Demo', 'different')],
    [item('https://demo.example.com/?key=A'), item('https://demo.example.com/?key=a')]
  ]) {
    assert.equal(B.dedupe(pair).length, 2, 'dedupe preserves distinct configurations');
    assert.equal(B.mergeServerLists([pair[0]], [pair[1]]).servers.length, 2, 'import preserves distinct configurations');
  }
  const a = item('HTTPS://DEMO.EXAMPLE.COM/A'), b = item('https://demo.example.com/A');
  a.accessToken = ''; b.accessToken = 'fictional-token';
  b.lines = [{name:'backup',url:'https://backup.example.com',active:true}];
  const merged = B.mergeServerLists([a], [b]);
  assert.equal(merged.servers.length, 1, 'host and scheme case normalize');
  assert.equal(merged.servers[0].accessToken, 'fictional-token', 'missing credentials filled');
  assert.equal(merged.servers[0].lines.length, 1, 'extra routes preserved');
  for (const key of ['userId', 'accessToken']) {
    const first = item('https://demo.example.com'), second = item('https://demo.example.com');
    first[key] = 'first'; second[key] = 'second';
    assert.equal(B.dedupe([first, second]).length, 2, 'conflicting identity/token preserved');
  }
  const ambiguous = B.mergeServerLists([item('https://demo.example.com', 'Demo', 'one'), item('https://demo.example.com', 'Demo', 'two')], [item('https://demo.example.com', 'Demo', '')]);
  assert.equal(ambiguous.servers.length, 3, 'ambiguous credential-less import stays separate');
}
console.log('OK: LinPlayer selected route and safe import/deduplication regressions passed.');

// 下列 fixture 全部虚构，编码与加密只在本机内存中进行。
const cloneFixture = value => JSON.parse(JSON.stringify(value));
const fixtureBytes = value => new TextEncoder().encode(JSON.stringify(value));
const fixtureBase64 = value => Buffer.from(value).toString('base64');
const fixtureIv = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
const fixtureHillsKey = Buffer.from('9d2729bd3afe5536669610e25b3ef6b3a7fd1efe2a065187101b144951617bce', 'hex');
const fixtureHillsIv = Buffer.from('bc322377137f312c2bff7a920aad959e', 'hex');

async function packConfigs(format, configs, outer = {}) {
  const key = format === 'yamby'
    ? new TextEncoder().encode('makeeverymediaplayergreatagain!!')
    : new Uint8Array(32);
  if (format === 'linplayer') key.set(new TextEncoder().encode('LinPlayer-common-config-key-v1!'));
  const encrypted = [];
  for (const config of configs) {
    encrypted.push(fixtureBase64(await B._internal.cbcEncrypt(key, key.subarray(0, 16), fixtureBytes(config))));
  }
  return JSON.stringify({
    from: '虚构离线测试', version: '1.0', export_time: 1700000000,
    configs: encrypted, _key: format === 'linplayer' ? fixtureBase64(key) : null,
    ...outer
  });
}

function packWw(inner, outer = {}) {
  const key = new TextEncoder().encode('WWPlayer portable config export v1');
  const nonce = 'fictional-offline-nonce';
  const nonceBytes = new TextEncoder().encode(nonce);
  const payload = fixtureBytes(inner).map((byte, index) => {
    const k = key[index % key.length], shift = index % 8;
    return byte ^ (((k << shift) | (k >> (8 - shift))) & 255) ^ nonceBytes[index % nonceBytes.length];
  });
  return JSON.stringify({ magic: 'WWPLAYER_CONFIG_EXPORT_V1', nonce, payload: fixtureBase64(payload), ...outer });
}

async function packCapy(inner, outer = {}) {
  const key = await B._internal.pbkdf2('capyplayer_default_backup_key_2026', 'capyplayer_backup_v1', 10000, 32);
  const encrypted = await B._internal.gcmEncrypt(key, fixtureIv, fixtureBytes(inner));
  return JSON.stringify({
    version: '1.0', app_version: 'fictional-22', database_version: 22,
    device_name: '虚构离线设备', created_at: 1700000000000,
    encrypted_data: fixtureBase64(fixtureIv) + ':' + fixtureBase64(encrypted), ...outer
  });
}

async function packHills(inner, outer = {}) {
  const encrypted = await B._internal.cbcEncrypt(fixtureHillsKey, fixtureHillsIv, fixtureBytes(inner));
  return JSON.stringify({
    version: 2, data: fixtureBase64(encrypted), settings: null,
    mpvConf: null, iconPacks: null, customIcons: null, ...outer
  });
}

async function packAi(inner) {
  const key = await B._internal.sha256(new TextEncoder().encode('AIPlayer'));
  const iv = Buffer.from('5ae5916c2798047f905dd2c5272e0f41', 'hex');
  return JSON.stringify({ data: fixtureBase64(await B._internal.cbcEncrypt(key, iv, fixtureBytes(inner))) });
}

function friendlyError(pattern) {
  return error => {
    assert.ok(error instanceof Error, '拒绝时返回可读 Error');
    assert.notEqual(error.name, 'TypeError', '不能泄漏底层类型崩溃');
    assert.notEqual(error.name, 'OperationError', '不能直接暴露底层加密失败');
    assert.doesNotMatch(error.message, /Cannot read properties|Cannot use 'in'|not iterable|\.map is not a function/i, '错误面向导入用户');
    assert.match(error.message, pattern);
    return true;
  };
}

function checkExport(list, format, options = {}, ok = true) {
  const report = B.inspectExport(list, format, options);
  assert.equal(report.ok, ok, `${format} 导出预检结果`);
  assert.equal(report.mode, options.mode || 'servers', `${format} 导出预检模式`);
  assert.equal(report.selectedCount, options.selectedOnly ? list.filter(s => s._selected !== false).length : list.length, `${format} 严格选择数量`);
  for (const key of ['errors', 'warnings']) {
    assert.ok(Array.isArray(report[key]) && report[key].every(value => typeof value === 'string'), `${format} ${key} 是字符串数组`);
  }
  if (ok) assert.deepEqual(report.errors, [], `${format} 预检没有错误`);
  else assert.ok(report.errors.length > 0, `${format} 预检明确给出拒绝原因`);
  return report;
}

async function rejectExport(list, format, options, pattern) {
  checkExport(list, format, options, false);
  await assert.rejects(() => B.build(list, format, options), friendlyError(pattern));
}

function checkContext(parsed, format, document, inner) {
  assert.equal(parsed.meta.format, format, `${format} 返回格式元数据`);
  assert.equal(parsed.context.format, format, `${format} context 格式`);
  assert.ok(typeof parsed.context.id === 'string' && parsed.context.id.length > 0, `${format} context 有独立标识`);
  assert.deepEqual(parsed.context.serverIds, parsed.servers.map(s => s.id), `${format} context 使用统一模型 ID`);
  assert.deepEqual(parsed.context.document, document, `${format} context 保留原外层文档`);
  if (inner !== undefined) assert.deepEqual(parsed.context.inner, inner, `${format} context 保留解密文档`);
  for (const s of parsed.servers) assert.deepEqual(s._sources, [parsed.context.id], `${format} 每台服务器只绑定此来源`);
}

function checkActive(server) {
  const active = server.lines.filter(line => line.active);
  assert.equal(active.length, 1, '每台有线路的服务器只有一个活动线路');
  assert.equal(active[0].id, server.activeLineId, '活动标识与 active 布尔值一致');
  assert.equal(server.lines[server.activeLine].id, server.activeLineId, '兼容活动下标与标识一致');
  assert.equal(server.lines.find(line => line.id === server.primaryLineId).url, server.url, '主地址与主线路同步');
}

const serverValueKeys = ['name', 'serverName', 'type', 'url', 'username', 'password', 'userId', 'accessToken', 'icon', 'remark'];
const serverValues = s => Object.fromEntries(serverValueKeys.map(key => [key, s[key]]));
const lineValues = line => ({ id: line.id, name: line.name, url: line.url, active: line.active });

// Independent review regressions: incomplete identities, legacy route indices,
// pasted CSV aliases, strict Capy splitting, and Hills native scope fidelity.
{
  for (const url of ['', 'not-a-url', 'https:/incomplete.example.com/emby']) {
    const source = B.normalize([{ name: '不完整甲', url, remark: '甲备注' }, { name: '不完整乙', url, remark: '乙备注' }]);
    assert.deepEqual(B.dedupe(source).map(s => [s.name, s.remark]), source.map(s => [s.name, s.remark]), '空 / 无效地址不能成为确定合并身份');
    assert.equal(B.mergeServerLists([source[0]], [source[1]]).servers.length, 2, '导入不合并未完成服务器');
  }
  const legacy = { name: 'legacy-index', url: 'https://legacy-primary.example.com/emby', activeLine: 0, lines: [{ id: 'legacy-backup', name: '备用', url: 'https://legacy-backup.example.com/emby' }, { id: 'legacy-primary', name: '主线', url: 'https://legacy-primary.example.com/emby' }] };
  const normalized = B.normalize([B.emptyServer(legacy)])[0];
  assert.equal(normalized.activeLineId, 'legacy-backup', 'legacy activeLine:0 在主线重排前映射为稳定备用 ID');
  assert.equal(normalized.lines[normalized.activeLine].url, legacy.lines[0].url, 'legacy 指向原数组地址，而非重排后的下标');
  const oldBridge = await B.parse(JSON.stringify({ format: 'emby-bridge', version: 1, servers: [legacy] }), 'bridge');
  assert.equal(oldBridge.servers[0].activeLineId, 'legacy-backup', 'Bridge v1 入口同样保留显式 legacy index');
  const implicit = B.normalize([{ ...legacy, activeLine: undefined }])[0];
  assert.equal(implicit.activeLineId, implicit.primaryLineId, '未提供 legacy index 时默认选主线，不伪造显式0');
  const inserted = B.normalize([{ ...legacy, lines: [legacy.lines[0]] }])[0];
  assert.equal(inserted.activeLineId, 'legacy-backup', '补插主线不抢占 legacy 已选备用');
  for (const text of [
    'type,url,password\nemby,https://csv-header.example.com/emby,fictional-password',
    '"password","url"\n"fictional-password","https://csv-header.example.com/emby"',
    'access_token,地址\nfictional-token,https://csv-header.example.com/emby',
    'url\nhttps://csv-header.example.com/emby'
  ]) {
    assert.equal(B.detect(text, '粘贴内容'), 'csv', 'CSV 任意支持表头 / 别名不落入快捷文本解析');
    const parsed = await B.parse(text, 'csv');
    assert.equal(parsed.servers[0].url, 'https://csv-header.example.com/emby', 'CSV 表头识别与解析共享字段映射');
  }
  for (const url of ['https:/capy-strict.example.com/Emby', 'https://capy-strict.example.com\\Emby', 'https://capy-strict.example.com/Emby\nPart', 'https://capy-strict.example.com:0/Emby']) {
    await rejectExport([{ name: '虚构 Capy 严格', url }], 'capyplayer', {}, /Capy|完整|空白|反斜杠|端口|HTTP/i);
    await rejectExport([{ name: '虚构 Capy 严格', url: 'https://capy-strict.example.com/', lines: [{ name: '备用', url }] }], 'capyplayer', {}, /Capy|完整|空白|反斜杠|端口|HTTP/i);
  }
  for (const url of ['https://capy-path.example.com', 'https://capy-path.example.com/', 'https://capy-path.example.com/a/../B/%2F/', 'https://[2001:db8::1]:8920/Emby/']) {
    const built = await B.build([{ name: '虚构 Capy 路径', url }], 'capyplayer');
    const parsed = await B.parse(built.text, 'capyplayer');
    assert.equal(parsed.servers[0].url, url, 'Capy 精确保留根路径 / 缺省路径、dot segment、转义路径与 IPv6');
  }
  const canonicalWarning = B.inspectExport([{ name: '主机规范化', url: 'HTTPS://CAPY-PATH.EXAMPLE.COM:443/Emby/' }], 'capyplayer');
  assert.equal(canonicalWarning.ok, true, '等价主机 / 默认端口写法可以转换');
  assert.match(canonicalWarning.warnings.join('\n'), /规范化|默认端口/i, '原生地址文本规范化不静默发生');
  const hillsRows = [{ displyName: '虚构 Hills 甲', serverName: 'hills-review-A', serverUrl: 'https://hills-review-a.example.com/emby/', mainRoutingName: '原生自定义主线路甲', isActive: false, serverRoutingList: [] }, { displyName: '虚构 Hills 乙', serverName: 'hills-review-B', serverUrl: 'https://hills-review-b.example.com/emby/', mainRoutingName: '原生自定义主线路乙', isActive: true, serverRoutingList: [] }];
  const hills = await B.parse(await packHills({ data: hillsRows }), 'hills');
  assert.deepEqual(hills.servers.map(s => s.lines.find(l => l.id === s.primaryLineId).name), hillsRows.map(s => s.mainRoutingName), 'Hills 导入将原生主线路名映射到模型');
  const options = { mode: 'full', context: hills.context };
  const full = await B.parse((await B.build(hills.servers, 'hills', options)).text, 'hills');
  assert.deepEqual(full.servers.map(s => [s.raw.hills.mainRoutingName, s.raw.hills.isActive]), hillsRows.map(s => [s.mainRoutingName, s.isActive]), 'Hills full 保留主线路名及非首台活动标志');
  const reversed = await B.parse((await B.build([...hills.servers].reverse(), 'hills', options)).text, 'hills');
  assert.deepEqual(reversed.servers.map(s => [s.raw.hills.serverName, s.raw.hills.isActive]), [...hillsRows].reverse().map(s => [s.serverName, s.isActive]), 'Hills full 重排不改变原生活动服务器');
}

// URL 比较只折叠 scheme/host，不能删尾斜杠、折叠 userinfo 或更改 query。
{
  const item = (url, overrides = {}) => B.emptyServer({ name: '保守合并', url, username: 'User', password: 'Password', ...overrides });
  const distinct = [
    [item('https://identity.example.com/path'), item('https://identity.example.com/path/')],
    [item('https://identity.example.com/?tail=/'), item('https://identity.example.com/?tail=')],
    [item('https://User:Pass@identity.example.com/Path'), item('https://user:Pass@identity.example.com/Path')],
    [item('https://User:Pass@identity.example.com/Path'), item('https://User:pass@identity.example.com/Path')],
    [item('https://identity.example.com/Path'), item('https://identity.example.com/path')],
    [item('https://identity.example.com/?Token=A'), item('https://identity.example.com/?token=A')],
    [item('https://identity.example.com/?token=A'), item('https://identity.example.com/?token=a')],
    [item('https://identity.example.com'), item('https://identity.example.com', { username: 'user' })],
    [item('https://identity.example.com'), item('https://identity.example.com', { password: 'password' })],
    [item('https://identity.example.com', { accessToken: 'Token-A' }), item('https://identity.example.com', { accessToken: 'token-a' })],
    [item('https://identity.example.com', { userId: 'User-ID' }), item('https://identity.example.com', { userId: 'user-id' })]
  ];
  for (const pair of distinct) {
    const expected = pair.map(serverValues);
    const deduped = B.dedupe(cloneFixture(pair));
    const merged = B.mergeServerLists([cloneFixture(pair[0])], [cloneFixture(pair[1])]).servers;
    assert.deepEqual(deduped.map(serverValues), expected, '去重完整保留有意义的差异');
    assert.deepEqual(merged.map(serverValues), expected, '导入完整保留有意义的差异');
  }
  const uppercase = item('HTTPS://CaseUser:CasePass@IDENTITY.EXAMPLE.COM/Path/?key=A/');
  const lowercase = item('https://CaseUser:CasePass@identity.example.com/Path/?key=A/');
  const merged = B.mergeServerLists([uppercase], [lowercase]);
  assert.equal(merged.servers.length, 1, '相同 userinfo 下 scheme/host 大小写仍合并');
  assert.equal(merged.servers[0].url, uppercase.url, '合并不改原路径、query、userinfo 或尾斜杠');
  assert.equal(merged.servers[0].password, 'Password', '合并不改密码大小写');
}

// 所有编辑都通过稳定线路 ID，主地址更新后不得复活旧 URL。
{
  const original = 'https://edit.example.com/Original/';
  const [server] = B.normalize([{
    id: 'stable-server', name: '主线路编辑', url: original, username: 'u', password: 'fictional-password',
    primaryLineId: 'stable-main', activeLineId: 'stable-backup',
    lines: [
      { id: 'stable-main', name: '主线', url: original, active: true },
      { id: 'stable-backup', name: '备用', url: 'https://edit-backup.example.com/Old/', active: true }
    ]
  }]);
  checkActive(server);
  const ids = server.lines.map(line => line.id);
  B.setPrimaryUrl(server, 'https://edit.example.com/Updated/');
  assert.equal(server.url, 'https://edit.example.com/Updated/', 'setPrimaryUrl 精确保留新地址');
  assert.equal(server.lines.find(line => line.id === 'stable-main').url, server.url, 'setPrimaryUrl 同步主线路');
  assert.equal(server.activeLineId, 'stable-backup', '更新主地址不覆盖已选备用');
  B.setLineUrl(server, 'stable-main', 'https://edit.example.com/Final/');
  assert.equal(server.url, 'https://edit.example.com/Final/', 'setLineUrl 编辑主线同步 server.url');
  B.setLineUrl(server, 'stable-backup', 'https://edit-backup.example.com/Final/');
  assert.equal(server.url, 'https://edit.example.com/Final/', '编辑备用不篡改主地址');
  B.setActiveLine(server, 'stable-main');
  checkActive(server);
  const [normalized] = B.normalize([server]);
  assert.equal(normalized.id, 'stable-server', '再次 normalize 保留服务器 ID');
  assert.deepEqual(normalized.lines.map(line => line.id), ids, '再次 normalize 保留线路 ID');
  assert.equal(normalized.primaryLineId, 'stable-main', '主线路标识稳定');
  assert.ok(!normalized.lines.some(line => line.url === original), '旧主地址不被 normalize 复活');
  for (const format of B.FORMATS) {
    const [back] = (await B.parse((await B.build([normalized], format)).text, format)).servers;
    assert.equal(back.url, normalized.url, `${format} 导出不复活旧主 URL`);
    assert.deepEqual(back.lines.map(line => line.url).sort(), normalized.lines.map(line => line.url).sort(), `${format} 导出保留编辑后的线路集合`);
    assert.equal(back.lines[back.activeLine].url, normalized.url, `${format} 活动主线与编辑后主地址一致`);
    checkActive(back);
  }
  const repaired = B.normalize([
    { id: 'duplicate-server', name: '甲', url: 'https://duplicate-a.example.com', lines: [{ id: 'duplicate-line', url: 'https://duplicate-a.example.com' }, { id: 'duplicate-line', url: 'https://duplicate-backup.example.com' }] },
    { id: 'duplicate-server', name: '乙', url: 'https://duplicate-b.example.com' }
  ]);
  assert.equal(new Set(repaired.map(s => s.id)).size, 2, '重复输入服务器 ID 修复为唯一');
  assert.equal(new Set(repaired[0].lines.map(line => line.id)).size, 2, '重复输入线路 ID 修复为唯一');
  const repeated = B.normalize(repaired);
  assert.deepEqual(repeated.map(s => s.id), repaired.map(s => s.id), '修复后的服务器 ID 不反复重建');
  assert.deepEqual(repeated[0].lines.map(line => line.id), repaired[0].lines.map(line => line.id), '修复后的线路 ID 不反复重建');
}

// CSV 的引号状态跨整份文档；多行凭据和 JSON 线路必须逐字段精确往返。
{
  const main = 'https://csv.example.com/Path/?query=a,b|c&tail=/';
  const backup = 'https://csv-backup.example.com/Base/?query=x,y|z&token=A=Z/';
  const source = B.normalize([
    {
      id: 'csv-server', name: 'CSV,\n"名称"\r\n尾行', serverName: '原服务\r\n名字,="值"',
      type: 'jellyfin', url: main, username: 'user,\r\n"name"', password: 'p\nq\r\n"r",s|t',
      userId: 'fictional-csv-user', accessToken: 'fictional-csv-token',
      icon: 'https://example.com/csv-icon.png', remark: '备注=值|路径,\n"下行"\r\n末行',
      primaryLineId: 'csv-main', activeLineId: 'csv-backup',
      lines: [
        { id: 'csv-main', name: '主线=名|原样', url: main, active: false },
        { id: 'csv-backup', name: '线路=名|逗号,"引号"\nLF\r\nCRLF', url: backup, active: true, raw: { linplayer: { id: 'native-not-in-csv', remark: 'CSV不得携带此raw' } } }
      ]
    },
    { name: '=1+1', serverName: '无害文字', remark: '不执行公式', url: 'https://formula.example.com/', username: 'u', password: 'fictional' }
  ]);
  const text = B.toCsv(source);
  const header = text.replace(/^\uFEFF/, '').split('\r\n')[0].split(',');
  for (const column of ['serverName', 'remark', 'activeLine', 'lines']) assert.ok(header.includes(column), `CSV 有 ${column} 列`);
  const expectedLinesJson = JSON.stringify(source[0].lines.map(lineValues));
  const expectedCell = '"' + expectedLinesJson.replace(/"/g, '""') + '"';
  assert.ok(text.includes(expectedCell), 'lines 列为无 raw 的 JSON 数组，而非名称=URL|...');
  assert.ok(!text.includes('CSV不得携带此raw'), 'CSV 不导出线路 raw');
  const back = B.parseCsv(text);
  assert.deepEqual(back.map(serverValues), source.map(serverValues), 'CSV 精确保留 LF/CRLF、逗号、引号、query、serverName 与 remark');
  assert.deepEqual(back.map(s => s.lines.map(lineValues)), source.map(s => s.lines.map(lineValues)), 'CSV JSON 线路精确保留 ID、名称、URL、active');
  assert.deepEqual(back.map(s => s.activeLine), source.map(s => s.activeLine), 'CSV 活动线路下标精确往返');
  back.forEach(checkActive);
  assert.equal(back[1].name, '=1+1', '无害公式形状原文不加前缀或执行');
  const report = checkExport(source, 'csv');
  assert.match(report.warnings.join('\n'), /CSV|公式|表格|formula/i, 'CSV 明确警告潜在公式解释');
  const built = await B.build(source, 'csv');
  assert.equal(built.text, text, 'build(csv) 与直接 CSV 输出相同');
  assert.ok(Array.isArray(built.warnings) && built.warnings.every(w => typeof w === 'string'), 'CSV build 返回字符串 warnings');
  assert.match(built.warnings.join('\n'), /CSV|公式|表格|formula/i, 'CSV build 不丢预检警告');
  assert.match(built.mime, /text\/csv/i, 'CSV MIME 正确');

  const manual = 'name,url,password\r\n"甲\n乙",https://manual.example.com/a,"p\r\nq"\r\n"丙""丁",https://manual.example.com/b,"x,y"\r\n';
  const manualBack = B.parseCsv(manual);
  assert.deepEqual(manualBack.map(s => [s.name, s.url, s.password]), [
    ['甲\n乙', 'https://manual.example.com/a', 'p\r\nq'],
    ['丙"丁', 'https://manual.example.com/b', 'x,y']
  ], '独立手写 CSV 检验多行、CRLF 和双引号，而非只依赖编码器');
  for (const invalid of [
    'name,url,password\r\n"未闭合,https://bad.example.com,p',
    'name,url\r\n坏"引号,https://bad.example.com',
    'name,url\r\n"名称"尾字,https://bad.example.com'
  ]) assert.throws(() => B.parseCsv(invalid), friendlyError(/CSV|引号|quote/i));
  for (const invalid of [
    'name,url,password\r\n短行,https://bad.example.com',
    'name,url\r\n长行,https://bad.example.com,p'
  ]) assert.throws(() => B.parseCsv(invalid), friendlyError(/CSV|列|字段|column/i));
  assert.throws(() => B.parseCsv('name,url,lines\r\n坏线路,https://bad.example.com,[null]'), friendlyError(/线路|lines|对象/i));
  const legacy = 'name,type,url,username,password,userId,accessToken,icon,lines\r\n旧CSV,emby,https://legacy.example.com/main,demo,p,old-id,old-token,,主线=https://legacy.example.com/main|备用=https://legacy.example.com/backup';
  const [legacyBack] = B.normalize(B.parseCsv(legacy));
  assert.deepEqual([legacyBack.name, legacyBack.url, legacyBack.username, legacyBack.password, legacyBack.userId, legacyBack.accessToken], ['旧CSV', 'https://legacy.example.com/main', 'demo', 'p', 'old-id', 'old-token'], '旧 CSV 核心字段仍可读');
  assert.deepEqual(legacyBack.lines.map(line => [line.name, line.url]), [['主线', 'https://legacy.example.com/main'], ['备用', 'https://legacy.example.com/backup']], '旧名称=URL|... 线路仍可读');
  const parsedCsv = await B.parse(text, 'csv');
  assert.deepEqual(parsedCsv.servers.map(serverValues), source.map(serverValues), 'parse(csv) 入口不截断多行字段');
  assert.equal(parsedCsv.context, null, 'CSV 不伪造原生整份文档 context');
}

// 快速文本不把 URL query 中的分隔符拆开，也不静默截断密码。
{
  const queryUrl = 'https://quick.example.com/Path/?q=a,b|c;d&tail=/#fragment';
  for (const text of [queryUrl, '"' + queryUrl + '"']) {
    const [back] = B.parseQuickText(text);
    assert.equal(back.url, queryUrl, '单 URL 精确保留逗号、竖线、query 与 fragment');
    assert.equal(back.username, '', '单 URL 不凭空推断用户名');
    assert.equal(back.password, '', '单 URL 不凭空推断密码');
  }
  const [quoted] = B.parseQuickText('"名称,|""引号""" | "' + queryUrl + '" | "user|name" | "p|q"');
  assert.deepEqual([quoted.name, quoted.url, quoted.username, quoted.password], ['名称,|"引号"', queryUrl, 'user|name', 'p|q'], '四字段双引号精确保护 query 和完整密码');
  const [two] = B.parseQuickText('两字段 | "' + queryUrl + '"');
  assert.deepEqual([two.name, two.url, two.username, two.password], ['两字段', queryUrl, '', ''], '两字段可用');
  const [three] = B.parseQuickText('三字段 | https://quick.example.com/plain | demo');
  assert.deepEqual([three.name, three.url, three.username, three.password], ['三字段', 'https://quick.example.com/plain', 'demo', ''], '三字段可用');
  for (const invalid of [
    '名称 | https://quick.example.com | demo | p | q',
    '名称 | https://quick.example.com | demo | p | q | r'
  ]) assert.throws(() => B.parseQuickText(invalid), friendlyError(/4|四|字段|列/i));
  for (const invalid of [
    '名称 | https://quick.example.com | demo | "p|q',
    '名称 | https://quick.example.com | demo | p"q',
    '名称 | https://quick.example.com | demo | "p"尾字'
  ]) assert.throws(() => B.parseQuickText(invalid), friendlyError(/引号|quote|快速|文本/i));
}

// Bridge v2 保存服务器 raw 和稳定原生线路字段，不保存文档 context 或来源状态。
{
  const url = 'https://CaseUser:CasePass@bridge.example.com/Path/?query=a,b|c&tail=/';
  const config = {
    id: 'native-bridge-lin-server', type: 'emby', name: 'BridgeUser', url, username: 'BridgeUser',
    user_id: 'fictional-bridge-user', access_token: 'fictional-bridge-token',
    linplayer: {
      name: 'Bridge 换行凭据', password: 'p\nq\r\n"r"|s', remark: '原生备注', active_line: 1,
      source: { kind: 'fictional' },
      lines: [
        { id: 'native-bridge-A', name: 'A', url, remark: 'A 备注', source: 'source-A', fixtureExtension: { owner: 'A' } },
        { id: 'native-bridge-C', name: 'C=名|备用', url: 'https://bridge-backup.example.com/C/?tail=/', remark: 'C 备注', source: 'source-C', fixtureExtension: { owner: 'C' } }
      ]
    }
  };
  const source = await B.parse(await packConfigs('linplayer', [config], { linplayer_settings: { marker: 'bridge-context-must-not-export' } }), 'linplayer');
  const [server] = source.servers;
  server._open = true;
  server._selected = true;
  const exported = await B.build(source.servers, 'bridge');
  const document = JSON.parse(exported.text);
  assert.equal(B.detect(exported.text, 'fictional-bridge.json'), 'bridge', '页面所用 detect 可以识别 bridge');
  assert.equal(document.format, 'emby-bridge', 'bridge 标识');
  assert.equal(document.version, 2, 'bridge 使用 v2');
  assert.deepEqual(document.servers[0].raw, server.raw, 'bridge 保留服务器格式 raw');
  assert.deepEqual(document.servers[0].lines.map(line => line.raw), server.lines.map(line => line.raw), 'bridge 保留线路原生 ID 与扩展');
  for (const key of ['context', 'meta', '_sources']) assert.ok(!(key in document), `bridge 外层不含 ${key}`);
  for (const key of ['_sources', '_selected', '_open', 'context']) assert.ok(!(key in document.servers[0]), `bridge 服务器不含 ${key}`);
  assert.ok(!exported.text.includes('bridge-context-must-not-export'), 'bridge 不携带原文档设置');
  assert.ok(!exported.text.includes(source.context.id), 'bridge 不携带原来源 context ID');
  assert.ok(!exported.text.includes('"_sources"'), 'bridge 不嵌入来源状态');
  const parsed = await B.parse(exported.text, 'bridge');
  const [back] = parsed.servers;
  assert.deepEqual(serverValues(back), serverValues(server), 'bridge 精确往返换行密码、userinfo 和 query');
  assert.deepEqual([back.id, back.primaryLineId, back.activeLineId, back.activeLine], [server.id, server.primaryLineId, server.activeLineId, server.activeLine], 'bridge 稳定服务器与活动线路 ID');
  assert.deepEqual(back.lines.map(lineValues), server.lines.map(lineValues), 'bridge 稳定统一模型线路 ID');
  assert.deepEqual(back.raw, server.raw, 'bridge 读回服务器 raw');
  assert.deepEqual(back.lines.map(line => line.raw), server.lines.map(line => line.raw), 'bridge 读回线路 raw');
  checkActive(back);
  const [nativeBack] = (await B.parse((await B.build(parsed.servers, 'linplayer')).text, 'linplayer')).servers;
  assert.equal(nativeBack.password, config.linplayer.password, 'bridge 再导出不截断密码换行');
  assert.equal(nativeBack.url, url, 'bridge 再导出不改变 userinfo/query');
  assert.deepEqual(nativeBack.raw.linplayer.linplayer.lines, config.linplayer.lines, 'bridge 再导出保留原生线路 ID、source、remark 和扩展');
  const legacy = {
    format: 'emby-bridge', version: 1,
    servers: [{
      name: '旧 Bridge', type: 'emby', url, username: 'BridgeUser', password: 'old\npassword',
      activeLine: 1, lines: [{ name: '主线', url, active: false }, { name: '备用', url: 'https://legacy-bridge.example.com/backup', active: true }]
    }]
  };
  assert.equal(B.detect(JSON.stringify(legacy), 'legacy-bridge.json'), 'bridge', '旧 bridge v1 可识别');
  const [legacyBack] = (await B.parse(JSON.stringify(legacy), 'bridge')).servers;
  assert.deepEqual([legacyBack.name, legacyBack.url, legacyBack.username, legacyBack.password], ['旧 Bridge', url, 'BridgeUser', 'old\npassword'], '旧 bridge v1 核心字段完整可读');
  assert.equal(legacyBack.lines[legacyBack.activeLine].url, 'https://legacy-bridge.example.com/backup', '旧 bridge v1 活动线路保留');
  checkActive(legacyBack);
}

const mobileDocument = {
  schemaVersion: 2, exportedAtMs: 1700000000000, credentialsIncluded: true,
  preferences: { themeMode: 'Dark', ignoreSslCertificateValidation: true, fixturePreference: 'private-mobile-preference' },
  servers: [
    {
      serverId: 'mobile-server-A', displayName: '虚构手机 A', remoteServerId: 'fictional-mobile-remote-A',
      userName: 'mobile-user-A', userId: 'fictional-mobile-user-A', password: 'fictional-mobile-password-A\nline', accessToken: 'fictional-mobile-token-A',
      remark: '手机 A 备注', serverType: 'emby', requiresAuthentication: true, activeLineId: 'mobile-line-C',
      fixtureServerExtension: { owner: 'A' },
      lines: [
        { lineId: 'mobile-line-A', name: 'A', serverUrl: 'https://mobile-a.example.com/A/', source: 'source-A', remark: 'remark-A', fixtureExtension: { owner: 'A' } },
        { lineId: 'mobile-line-B', name: 'B', serverUrl: 'https://mobile-backup.example.com/B/', source: 'source-B', remark: 'remark-B', fixtureExtension: { owner: 'B' } },
        { lineId: 'mobile-line-C', name: 'C', serverUrl: 'https://mobile-backup.example.com/C/', source: 'source-C', remark: 'remark-C', fixtureExtension: { owner: 'C' } }
      ]
    },
    {
      serverId: 'mobile-server-B', displayName: '虚构手机 B', remoteServerId: 'fictional-mobile-remote-B',
      userName: 'mobile-user-B', userId: 'fictional-mobile-user-B', password: 'fictional-mobile-password-B', accessToken: 'fictional-mobile-token-B',
      remark: '手机 B 备注', serverType: 'jellyfin', requiresAuthentication: true, activeLineId: 'mobile-second-A',
      lines: [{ lineId: 'mobile-second-A', name: '默认', serverUrl: 'https://mobile-b.example.com/B/', source: 'source-second-A' }]
    }
  ],
  collections: { watchlist: [{ marker: 'private-mobile-watchlist' }], playlists: [{ marker: 'private-mobile-playlist' }] },
  playbackHistory: {
    resumeRecords: [{ marker: 'private-mobile-resume', serverId: 'mobile-server-A' }],
    dismissals: [{ marker: 'private-mobile-dismissal' }],
    continueRecords: [{ marker: 'private-mobile-continue', serverId: 'mobile-server-B' }],
    homeRecords: [{ marker: 'private-mobile-home' }]
  },
  contentSources: [{ id: 'private-mobile-content', url: 'https://content.example.com/feed' }],
  discoveryHomes: { schemaVersion: 1, activeId: 'private-mobile-page', pages: [{ id: 'private-mobile-page' }], primaryId: 'private-mobile-page', enabled: true },
  modules: [{ id: 'private-mobile-module' }],
  nexusState: {
    imports: [{ marker: 'private-mobile-import' }], bindings: [{ marker: 'private-mobile-binding' }],
    homePlaylists: [{ marker: 'private-mobile-home-playlist' }], extension: { marker: 'private-mobile-extension' }
  },
  fixtureDocumentExtension: { marker: 'private-mobile-document' }
};

const capyInner = {
  tables: {
    media_server_resources: [
      {
        id: 'capy-server-A', name: '虚构 Capy A', type: 'emby', resource_type: 'media_server',
        host: 'capy-a.example.com', https: 1, port: 8920, path: '/A/', username: 'capy-user-A',
        password: 'fictional-capy-password-A', token: 'fictional-capy-token-A', user_id: 'fictional-capy-user-A',
        remark: 'Capy A 备注', sort_order: 0, fixtureServerExtension: { owner: 'A' },
        backup_routes: JSON.stringify([
          { id: 'capy-route-B', name: 'B', host: 'capy-backup.example.com', https: true, port: 443, path: '/B/', isUse: false, isProxy: true, fixtureExtension: { owner: 'B' } },
          { id: 'capy-route-C', name: 'C', host: 'capy-backup.example.com', https: true, port: 443, path: '/C/', isUse: true, isProxy: false, fixtureExtension: { owner: 'C' } }
        ])
      },
      {
        id: 'capy-server-B', name: '虚构 Capy B', type: 'jellyfin', resource_type: 'media_server',
        host: 'capy-b.example.com', https: 1, port: 443, path: '/B/', username: 'capy-user-B',
        password: 'fictional-capy-password-B', token: 'fictional-capy-token-B', user_id: 'fictional-capy-user-B',
        remark: 'Capy B 备注', sort_order: 1, backup_routes: '[]'
      }
    ],
    media_item_settings: [{ marker: 'private-capy-item', server_id: 'capy-server-A' }],
    icon_packs: [{ marker: 'private-capy-icon-pack' }],
    icon_items: [{ marker: 'private-capy-icon-item' }],
    fixture_history: [{ marker: 'private-capy-side-table', server_id: 'capy-server-B' }]
  },
  preferences: { theme: 'Dark', marker: 'private-capy-preference' },
  playbackHistory: [{ marker: 'private-capy-playback', server_id: 'capy-server-A' }],
  fixtureDocumentExtension: { marker: 'private-capy-document' }
};

// 删除中间 B 并修改 C，WW 电脑/手机与 Lin 的 ID、source、remark 不能错配。
{
  const pcLines = ['A', 'B', 'C'].map(name => ({
    id: 'pc-line-' + name, name, url: 'https://pc-lines.example.com/' + name + '/',
    source: 'source-' + name, remark: 'remark-' + name, fixtureExtension: { owner: name }
  }));
  const linLines = ['A', 'B', 'C'].map(name => ({
    id: 'lin-line-' + name, name, url: 'https://lin-lines.example.com/' + name + '/',
    source: 'source-' + name, remark: 'remark-' + name, fixtureExtension: { owner: name }
  }));
  const pcServer = {
    id: 'pc-server', name: '虚构电脑线路', username: 'pc-user', password: 'fictional-pc-password',
    userId: 'fictional-pc-user', accessToken: 'fictional-pc-token', lines: pcLines, activeLineId: 'pc-line-C',
    fixtureServerExtension: { owner: 'pc' }
  };
  const linConfig = {
    id: 'lin-server', type: 'emby', name: 'lin-user', url: linLines[0].url, username: 'lin-user',
    user_id: 'fictional-lin-user', access_token: 'fictional-lin-token', fixtureServerExtension: { owner: 'lin' },
    linplayer: { name: '虚构 Lin 线路', password: 'fictional-lin-password', remark: 'Lin 原备注', active_line: 2, lines: linLines, source: { kind: 'fixture-source' } }
  };
  const cases = [
    { format: 'wwplayer', text: packWw({ activeServerId: pcServer.id, servers: [pcServer] }), lines: pcLines, idKey: 'id', urlKey: 'url' },
    { format: 'wwmobile', text: JSON.stringify(mobileDocument), lines: mobileDocument.servers[0].lines, idKey: 'lineId', urlKey: 'serverUrl' },
    { format: 'linplayer', text: await packConfigs('linplayer', [linConfig]), lines: linLines, idKey: 'id', urlKey: 'url' }
  ];
  for (const entry of cases) {
    const parsed = await B.parse(entry.text, entry.format);
    const [server] = B.normalize([parsed.servers[0]]);
    const nativeC = entry.lines[2], nativeB = entry.lines[1];
    const lineC = server.lines.find(line => line.url === nativeC[entry.urlKey]);
    assert.deepEqual(lineC.raw[entry.format], nativeC, `${entry.format} 导入保存完整 C 线路 raw`);
    const originalServerId = server.id, originalMainId = server.primaryLineId, originalCId = lineC.id;
    server.lines = server.lines.filter(line => line.url !== nativeB[entry.urlKey]);
    const updatedUrl = 'https://edited-lines.example.com/' + entry.format + '/C/';
    B.setLineUrl(server, lineC.id, updatedUrl);
    B.setActiveLine(server, lineC.id);
    const [normalized] = B.normalize([server]);
    assert.equal(normalized.id, originalServerId, `${entry.format} 编辑后服务器 ID 稳定`);
    assert.equal(normalized.primaryLineId, originalMainId, `${entry.format} 删除中间线路不改变主标识`);
    assert.equal(normalized.activeLineId, originalCId, `${entry.format} 删除中间线路不改变活动 C 标识`);
    checkActive(normalized);
    const [back] = (await B.parse((await B.build([normalized], entry.format)).text, entry.format)).servers;
    const raw = back.raw[entry.format];
    const nativeLines = entry.format === 'linplayer' ? raw.linplayer.lines : raw.lines;
    const expectedC = { ...cloneFixture(nativeC), [entry.urlKey]: updatedUrl };
    const portableLine = line => Object.fromEntries(['lineId', 'serverUrl', 'name', 'source'].map(key => [key, line[key]]));
    const expectedLines = entry.format === 'wwmobile' ? [entry.lines[0], expectedC].map(portableLine) : [entry.lines[0], expectedC];
    assert.deepEqual(nativeLines, expectedLines, `${entry.format} A/C 精确保留目标支持的原生 ID 与字段，B 不复活`);
    const nativeActive = entry.format === 'linplayer'
      ? nativeLines[raw.linplayer.active_line][entry.idKey]
      : raw.activeLineId;
    assert.equal(nativeActive, nativeC[entry.idKey], `${entry.format} 活动指向 C 原生 ID，而非旧 B ID`);
    assert.equal(back.lines[back.activeLine].url, updatedUrl, `${entry.format} 活动 C URL 与编辑一致`);
    if (entry.format === 'wwmobile') {
      assert.equal(raw.fixtureServerExtension, undefined, '手机端只输出已核对的 PortableServerProfile 字段，未知服务器扩展不迁移');
      assert.ok(nativeLines.every(line => Object.keys(line).sort().join(',') === ['lineId', 'name', 'serverUrl', 'source'].sort().join(',')), '手机端线路只含四个原生可移植字段');
    } else assert.deepEqual(raw.fixtureServerExtension, parsed.servers[0].raw[entry.format].fixtureServerExtension, `${entry.format} 服务器原生扩展保留`);
    checkActive(back);
    const [twice] = (await B.parse((await B.build([back], entry.format)).text, entry.format)).servers;
    const twiceRaw = twice.raw[entry.format];
    assert.deepEqual(entry.format === 'linplayer' ? twiceRaw.linplayer.lines : twiceRaw.lines, nativeLines, `${entry.format} 再次导出不重建原生线路 ID`);
  }
  const sameUrl = B.normalize([
    { name: '账号 A', url: 'https://lin-accounts.example.com/emby', username: 'AccountA', password: 'fictional-A' },
    { name: '账号 B', url: 'https://lin-accounts.example.com/emby', username: 'AccountB', password: 'fictional-B' }
  ]);
  const first = (await B.parse((await B.build(sameUrl, 'linplayer')).text, 'linplayer')).servers;
  const ids = first.map(s => s.raw.linplayer.id);
  assert.ok(ids.every(id => typeof id === 'string' && id), 'Lin 不同账号的原生服务器 ID 非空');
  assert.equal(new Set(ids).size, 2, 'Lin 相同 URL 不同账号的导出 ID 唯一');
  assert.deepEqual(first.map(s => [s.url, s.username, s.password]), sameUrl.map(s => [s.url, s.username, s.password]), 'Lin 相同 URL 不同账号都完整导出');
  const repeated = (await B.parse((await B.build(sameUrl, 'linplayer')).text, 'linplayer')).servers;
  assert.deepEqual(repeated.map(s => s.raw.linplayer.id), ids, 'Lin 原生服务器 ID 不因重复 build 改变');
}

// Capy 备用活动态与代理值按线路保留；删除所有备用必须写 []。
{
  const parsed = await B.parse(await packCapy(capyInner), 'capyplayer');
  const [server] = B.normalize([parsed.servers[0]]);
  const originalRoutes = JSON.parse(capyInner.tables.media_server_resources[0].backup_routes);
  const c = server.lines.find(line => line.url === 'https://capy-backup.example.com/C/');
  assert.equal(server.activeLineId, c.id, 'Capy isUse=true 选中 C');
  assert.deepEqual(c.raw.capyplayer, originalRoutes[1], 'Capy 保存 C 的原生 isUse/isProxy/扩展');
  checkActive(server);
  const [back] = (await B.parse((await B.build([server], 'capyplayer')).text, 'capyplayer')).servers;
  assert.deepEqual(JSON.parse(back.raw.capyplayer.backup_routes), originalRoutes, 'Capy 不重置备用 isUse/isProxy 或丢原生扩展');
  assert.equal(back.lines[back.activeLine].url, c.url, 'Capy 活动备用往返');
  checkActive(back);
  const b = server.lines.find(line => line.url === 'https://capy-backup.example.com/B/');
  B.setActiveLine(server, b.id);
  const [switched] = (await B.parse((await B.build([server], 'capyplayer')).text, 'capyplayer')).servers;
  const switchedRoutes = JSON.parse(switched.raw.capyplayer.backup_routes);
  assert.deepEqual(switchedRoutes.map(route => [route.id, route.isUse, route.isProxy]), [['capy-route-B', true, true], ['capy-route-C', false, false]], 'Capy 切换备用只更新 isUse，不篡改各自 isProxy');
  server.lines = server.lines.filter(line => line.id === server.primaryLineId);
  B.setActiveLine(server, server.primaryLineId);
  const built = await B.build([server], 'capyplayer');
  const [withoutBackups] = (await B.parse(built.text, 'capyplayer')).servers;
  assert.equal(withoutBackups.raw.capyplayer.backup_routes, '[]', 'Capy 删除所有备用后明确写空 JSON 数组');
  assert.deepEqual(withoutBackups.lines.map(line => line.url), [server.url], 'Capy 删除备用后不复活旧 raw 线路');
  checkActive(withoutBackups);

  for (const url of [
    'https://capy-loss.example.com/Path/?key=1/',
    'https://capy-loss.example.com/Path/#fragment',
    'https://CaseUser:CasePass@capy-loss.example.com/Path/'
  ]) {
    for (const target of ['primary', 'backup']) {
      const [unsupported] = B.normalize([{ name: 'Capy 不可表达', url: 'https://capy-loss.example.com/Path/', lines: [{ name: '主线', url: 'https://capy-loss.example.com/Path/', active: true }] }]);
      if (target === 'primary') B.setPrimaryUrl(unsupported, url);
      else unsupported.lines.push({ id: 'unsupported-backup', name: '不可表达备用', url, active: false, raw: {} });
      await rejectExport([unsupported], 'capyplayer', {}, /Capy|query|fragment|userinfo|查询|片段|用户信息|参数|不支持|无损|URL/i);
    }
  }
}

// Hills 选中 ID 必须真实存在并指向活动路由；删 B / 改 C 不重建 C ID。
{
  const routes = [
    { id: 'hills-route-B', name: 'B', url: 'https://hills-routes.example.com/B/', remark: 'B备注', fixtureExtension: { owner: 'B' } },
    { id: 'hills-route-C', name: 'C', url: 'https://hills-routes.example.com/C/', remark: 'C备注', fixtureExtension: { owner: 'C' } }
  ];
  const inner = { data: [{
    displyName: '虚构 Hills 活动线路', serverName: 'Hills 原名', serverUrl: 'https://hills-primary.example.com/Main/',
    username: 'hills-user', password: 'fictional-hills-password',
    authenticateJson: JSON.stringify({ User: { Id: 'fictional-hills-user' }, AccessToken: 'fictional-hills-token' }),
    selectedServerRoutingId: 'hills-route-C', serverRoutingList: routes
  }] };
  const parsed = await B.parse(await packHills(inner), 'hills');
  const [server] = parsed.servers;
  const c = server.lines.find(line => line.url === routes[1].url);
  assert.equal(server.activeLineId, c.id, 'Hills 按 selectedServerRoutingId 选中 C');
  assert.deepEqual(c.raw.hills, routes[1], 'Hills 导入保留原生 C ID 与扩展');
  server.lines = server.lines.filter(line => line.url !== routes[0].url);
  B.setLineUrl(server, c.id, 'https://hills-routes.example.com/Edited-C/');
  B.setActiveLine(server, c.id);
  const normalized = B.normalize([server]);
  assert.equal(normalized[0].activeLineId, c.id, 'Hills 删除 B 后统一活动 C 标识稳定');
  checkExport(normalized, 'hills', { mode: 'full', context: parsed.context });
  const [back] = (await B.parse((await B.build(normalized, 'hills', { mode: 'full', context: parsed.context })).text, 'hills')).servers;
  const native = back.raw.hills;
  assert.deepEqual(native.serverRoutingList, [{ ...routes[1], url: 'https://hills-routes.example.com/Edited-C/' }], 'Hills 删除 B 并编辑 C 精确保留 C 原生 ID');
  assert.equal(native.selectedServerRoutingId, 'hills-route-C', 'Hills selectedServerRoutingId 使用活动 C 原生 ID');
  assert.equal(native.serverRoutingList.find(route => route.id === native.selectedServerRoutingId).url, back.lines[back.activeLine].url, 'Hills 选中原生 ID 确实存在且指向活动 URL');
  checkActive(back);
  B.setActiveLine(back, back.primaryLineId);
  const [primary] = (await B.parse((await B.build([back], 'hills')).text, 'hills')).servers;
  assert.equal(primary.raw.hills.selectedServerRoutingId, '', 'Hills 切回 primary 清空备用选择');
  assert.equal(primary.raw.hills.serverRoutingList[0].id, 'hills-route-C', 'Hills 切回 primary 不重建保留路由 ID');
  assert.equal(primary.lines[primary.activeLine].url, primary.url, 'Hills primary 选择精确恢复');
  checkActive(primary);
}

// 默认仅迁移被选服务器；显式 full 只能使用完整、单一、匹配格式的 context。
{
  const mobileText = JSON.stringify(mobileDocument);
  const capyText = await packCapy(capyInner, { fixtureEnvelopeMetadata: { marker: 'capy-envelope-metadata' } });
  for (const entry of [
    { format: 'wwmobile', text: mobileText, document: mobileDocument },
    { format: 'capyplayer', text: capyText, document: JSON.parse(capyText), inner: capyInner }
  ]) {
    const parsed = await B.parse(entry.text, entry.format);
    checkContext(parsed, entry.format, entry.document, entry.inner);
    const snapshot = cloneFixture(parsed.context);
    const selected = B.normalize(parsed.servers);
    selected[0]._selected = false;
    selected[1]._selected = true;
    const options = { context: parsed.context, selectedOnly: true };
    checkExport(selected, entry.format, options);
    const built = await B.build(selected, entry.format, options);
    assert.ok(Array.isArray(built.warnings) && built.warnings.every(w => typeof w === 'string'), `${entry.format} build 返回字符串 warnings`);
    const safe = await B.parse(built.text, entry.format);
    assert.deepEqual(safe.servers.map(s => s.name), [parsed.servers[1].name], `${entry.format} 取消第一台只导出被选第二台`);
    const nativeIdKey = entry.format === 'wwmobile' ? 'serverId' : 'id';
    const nativeId = s => s.raw[entry.format][nativeIdKey];
    assert.deepEqual(safe.servers.map(nativeId), [nativeId(parsed.servers[1])], `${entry.format} 选择保留第二台原生 ID 而非下标串台`);
    assert.deepEqual(safe.servers.map(s => [s.url, s.username, s.userId]), [[parsed.servers[1].url, parsed.servers[1].username, parsed.servers[1].userId]], `${entry.format} 选中服务器地址与身份精确对应`);
    assert.notEqual(safe.servers[0].id, parsed.servers[1].id, `${entry.format} 独立解析使用新的页面身份，避免跨来源碰撞`);
    if (entry.format === 'wwmobile') {
      const doc = safe.context.document;
      assert.equal(doc.preferences.ignoreSslCertificateValidation, false, '手机 servers 模式使用安全 TLS 默认值，不继承原 true');
      assert.equal(doc.preferences.fixturePreference, undefined, '手机 servers 模式不携带私人偏好');
      assert.deepEqual(doc.collections, { watchlist: [], playlists: [] }, '手机 servers 模式收藏与播放列表清空');
      assert.deepEqual(doc.playbackHistory, { resumeRecords: [], dismissals: [], continueRecords: [], homeRecords: [] }, '手机 servers 模式播放历史全部清空');
      assert.deepEqual(doc.contentSources, [], '手机 servers 模式内容源清空');
      assert.deepEqual(doc.modules, [], '手机 servers 模式模块清空');
      assert.deepEqual(doc.nexusState, { imports: [], bindings: [], homePlaylists: [], extension: {} }, '手机 servers 模式 nexus 副数据清空');
      assert.ok(!built.text.includes('private-mobile-'), '手机 servers 模式不偷带文档私有历史或扩展');
    } else {
      assert.equal(safe.context.document.database_version, 22, 'Capy servers 模式传 context 保留 database_version=22');
      for (const key of ['version', 'app_version', 'database_version']) {
        assert.equal(safe.context.document[key], entry.document[key], `Capy servers 模式保留版本层 ${key}`);
      }
      assert.equal(safe.context.document.device_name, 'Emby Bridge', 'Capy servers 模式不夹带来源设备名称');
      assert.deepEqual(safe.context.inner.preferences, {}, 'Capy servers 模式不携带私人偏好');
      for (const [table, rows] of Object.entries(safe.context.inner.tables)) {
        if (table !== 'media_server_resources') assert.deepEqual(rows, [], `Capy servers 模式 ${table} 副表清空`);
      }
      assert.ok(!JSON.stringify(safe.context.inner).includes('private-capy-'), 'Capy servers 模式无私人历史、副表或文档扩展');
    }
    const fullOptions = { mode: 'full', context: parsed.context, selectedOnly: true };
    await rejectExport(selected, entry.format, fullOptions, /完整|全部|全量|选择|服务器|subset|context|来源/i);
    await rejectExport([parsed.servers[1]], entry.format, { mode: 'full', context: parsed.context }, /完整|全部|全量|选择|服务器|context|来源/i);
    await rejectExport(parsed.servers, entry.format, { mode: 'full' }, /context|来源|原始|文档|完整/i);
    const wrongContext = { ...parsed.context, format: entry.format === 'wwmobile' ? 'capyplayer' : 'wwmobile' };
    await rejectExport(parsed.servers, entry.format, { mode: 'full', context: wrongContext }, /格式|匹配|来源|context/i);
    const added = B.normalize([...parsed.servers, { name: '新增虚构服务器', url: 'https://added.example.com/new', username: 'new-user' }]);
    await rejectExport(added, entry.format, { mode: 'full', context: parsed.context }, /完整|全部|全量|新增|服务器|context|来源/i);
    const missingSource = B.normalize(parsed.servers);
    missingSource[1]._sources = [];
    await rejectExport(missingSource, entry.format, { mode: 'full', context: parsed.context }, /来源|context|混合|完整|原始/i);

    const another = await B.parse(entry.text, entry.format);
    assert.notEqual(another.context.id, parsed.context.id, `${entry.format} 两次导入拥有不同来源 context`);
    assert.ok(another.servers.every(s => !parsed.context.serverIds.includes(s.id)), `${entry.format} 原生来源拥有独立页面 ID`);
    // Deliberately align UI IDs to prove full also checks provenance, not just IDs.
    const mixed = [parsed.servers[0], { ...another.servers[1], id: parsed.servers[1].id }];
    assert.deepEqual(mixed.map(s => s.id), parsed.context.serverIds, `${entry.format} 混合 fixture 故意模拟同一页面 ID 集合`);
    await rejectExport(mixed, entry.format, { mode: 'full', context: parsed.context }, /来源|context|混合|完整|原始/i);
    const merged = B.mergeServerLists(B.normalize(parsed.servers), B.normalize(another.servers)).servers;
    assert.deepEqual(merged.map(s => s.id), parsed.context.serverIds, `${entry.format} 合并不改变服务器 ID 集合`);
    merged.forEach(s => assert.deepEqual(new Set(s._sources), new Set([parsed.context.id, another.context.id]), `${entry.format} 合并记录两个来源`));
    await rejectExport(merged, entry.format, { mode: 'full', context: parsed.context }, /来源|context|混合|完整|原始/i);

    const complete = B.normalize(parsed.servers).reverse();
    complete.forEach(s => { s._selected = true; });
    const report = checkExport(complete, entry.format, fullOptions);
    const full = await B.build(complete, entry.format, fullOptions);
    const restored = await B.parse(full.text, entry.format);
    assert.deepEqual(new Set(restored.servers.map(nativeId)), new Set(parsed.servers.map(nativeId)), `${entry.format} full 重排保留完整原生服务器 ID 集合`);
    assert.deepEqual(restored.servers.map(s => [s.name, s.url, s.username, s.userId]), complete.map(s => [s.name, s.url, s.username, s.userId]), `${entry.format} full 重排后服务器地址与身份一一对应`);
    if (entry.format === 'wwmobile') {
      assert.match(report.warnings.join('\n'), /SSL|TLS|证书|certificate/i, '手机 full 原 SSL 绕过=true 明确预检警告');
      assert.match(full.warnings.join('\n'), /SSL|TLS|证书|certificate/i, '手机 full build 保留 SSL 警告');
      const doc = restored.context.document;
      assert.deepEqual(doc.preferences, mobileDocument.preferences, '手机 full 尊重原偏好与 ignoreSslCertificateValidation=true');
      for (const key of ['collections', 'playbackHistory', 'contentSources', 'discoveryHomes', 'modules', 'nexusState', 'fixtureDocumentExtension']) {
        assert.deepEqual(doc[key], mobileDocument[key], `手机 full 保留原 ${key}`);
      }
      assert.equal(doc.credentialsIncluded, false, '手机 full 仍声明剔除凭据');
      for (const native of doc.servers) {
        assert.ok(!('password' in native) && !('accessToken' in native), '手机 full 仍剔除密码和 Token');
        const original = mobileDocument.servers.find(s => s.serverId === native.serverId);
        assert.deepEqual([native.userId, native.userName], [original.userId, original.userName], '手机 full 不丢用户身份');
      }
    } else {
      assert.equal(restored.context.document.database_version, 22, 'Capy full 保留数据库版本 22');
      assert.deepEqual(restored.context.document.fixtureEnvelopeMetadata, entry.document.fixtureEnvelopeMetadata, 'Capy full 保留 envelope metadata');
      for (const key of ['preferences', 'playbackHistory', 'fixtureDocumentExtension']) assert.deepEqual(restored.context.inner[key], capyInner[key], `Capy full 保留 ${key}`);
      for (const [table, rows] of Object.entries(capyInner.tables)) {
        if (table !== 'media_server_resources') assert.deepEqual(restored.context.inner.tables[table], rows, `Capy full 保留 ${table} 副表`);
      }
    }
    assert.deepEqual(parsed.context, snapshot, `${entry.format} 预检和各模式 build 不原地修改来源 context`);
  }

  const emptyMobileDocument = { ...cloneFixture(mobileDocument), servers: [] };
  const emptyMobile = await B.parse(JSON.stringify(emptyMobileDocument), 'wwmobile');
  assert.deepEqual(emptyMobile.servers, [], '空手机源可读');
  checkContext(emptyMobile, 'wwmobile', emptyMobileDocument);
  assert.deepEqual(emptyMobile.context.document.preferences, mobileDocument.preferences, '空手机来源仍独立保留偏好，无需第一台服务器');
  const emptyCapyInner = cloneFixture(capyInner);
  emptyCapyInner.tables.media_server_resources = [];
  const emptyCapyText = await packCapy(emptyCapyInner);
  const emptyCapy = await B.parse(emptyCapyText, 'capyplayer');
  assert.deepEqual(emptyCapy.servers, [], '空 Capy 源可读');
  checkContext(emptyCapy, 'capyplayer', JSON.parse(emptyCapyText), emptyCapyInner);
  assert.equal(emptyCapy.context.document.database_version, 22, '空 Capy 来源仍独立保留数据库版本');
  assert.deepEqual(emptyCapy.context.inner.preferences, capyInner.preferences, '空 Capy 来源仍独立保留偏好');
}

// 其余原生 full 格式同样恢复非服务器偏好/历史，而默认模式不能偷带它们。
{
  const marker = { marker: 'private-native-full-preference', nested: { value: '原值' } };
  const history = [{ marker: 'private-native-full-history', position: 123 }];
  const url = 'https://native-full.example.com/emby/';
  const yambyConfig = { name: '虚构 Yamby full', type: 'emby', url, authorization: { user_name: 'demo', password: 'fictional-yamby', user_id: 'fictional-yamby-user', access_token: 'fictional-yamby-token' }, lines: [{ name: '主线', url }] };
  const linConfig = { id: 'full-lin-server', name: 'demo', type: 'emby', url, username: 'demo', user_id: 'fictional-lin-user', access_token: 'fictional-lin-token', linplayer: { name: '虚构 Lin full', password: 'fictional-lin', active_line: 0, lines: [{ id: 'full-lin-line', name: '主线', url, remark: '原线路备注' }] } };
  const pcInner = { activeServerId: 'full-pc-server', servers: [{ id: 'full-pc-server', name: '虚构电脑 full', username: 'demo', password: 'fictional-pc', userId: 'fictional-pc-user', accessToken: 'fictional-pc-token', activeLineId: 'full-pc-line', lines: [{ id: 'full-pc-line', name: '主线', url }] }], preferences: marker, playbackHistory: history };
  const hillsInner = { data: [{ displyName: '虚构 Hills full', serverName: 'Hills 原名', serverUrl: url, username: 'demo', password: 'fictional-hills', serverRoutingList: [], selectedServerRoutingId: '' }], preferences: marker, playbackHistory: history };
  const aiInner = { version: 1, exportedAt: '2020-01-01T00:00:00Z', servers: [{ id: 'full-ai-server', name: '虚构 AI full', serverName: 'AI 原名', provider: 'emby', username: 'demo', encryptedPassword: 'fictional-ai', encryptedToken: 'fictional-ai-token', lastKnownUserId: 'fictional-ai-user', lines: [{ name: '主线', url, isMain: true }], preferredLineUrl: url }], preferences: marker, playbackHistory: history };
  const cases = [
    { format: 'yamby', text: await packConfigs('yamby', [yambyConfig], { settings: marker, additional_data: { playbackHistory: history }, icon_packages: { fixture: 'private-native-full-icon' } }), outerExpected: { settings: marker, additional_data: { playbackHistory: history }, icon_packages: { fixture: 'private-native-full-icon' } } },
    { format: 'linplayer', text: await packConfigs('linplayer', [linConfig], { linplayer_settings: marker, playbackHistory: history }), outerExpected: { linplayer_settings: marker, playbackHistory: history } },
    { format: 'wwplayer', text: packWw(pcInner, { fixtureMetadata: { marker: 'private-native-full-envelope' } }), inner: pcInner, outerExpected: { fixtureMetadata: { marker: 'private-native-full-envelope' } } },
    { format: 'hills', text: await packHills(hillsInner, { settings: 'opaque-fixture-hills-settings', mpvConf: 'opaque-fixture-hills-mpv', iconPacks: 'opaque-fixture-hills-icons' }), inner: hillsInner, outerExpected: { settings: 'opaque-fixture-hills-settings', mpvConf: 'opaque-fixture-hills-mpv', iconPacks: 'opaque-fixture-hills-icons' } },
    { format: 'aiplayer', text: await packAi(aiInner), inner: aiInner, outerExpected: {} }
  ];
  for (const entry of cases) {
    const parsed = await B.parse(entry.text, entry.format);
    checkContext(parsed, entry.format, JSON.parse(entry.text), entry.inner);
    const contextSnapshot = cloneFixture(parsed.context);
    const options = { mode: 'full', context: parsed.context, selectedOnly: true };
    checkExport(parsed.servers, entry.format, options);
    const full = await B.build(parsed.servers, entry.format, options);
    assert.ok(Array.isArray(full.warnings) && full.warnings.every(w => typeof w === 'string'), `${entry.format} full 输出 warnings`);
    const restored = await B.parse(full.text, entry.format);
    assert.deepEqual(restored.servers.map(s => [s.name, s.url, s.username, s.password]), parsed.servers.map(s => [s.name, s.url, s.username, s.password]), `${entry.format} full 服务器核心字段精确恢复`);
    for (const [key, value] of Object.entries(entry.outerExpected)) assert.deepEqual(restored.context.document[key], value, `${entry.format} full 保留外层 ${key}`);
    if (entry.inner !== undefined) {
      assert.deepEqual(restored.context.inner.preferences, marker, `${entry.format} full 保留解密偏好`);
      assert.deepEqual(restored.context.inner.playbackHistory, history, `${entry.format} full 保留解密历史`);
    }
    const safe = await B.build(parsed.servers, entry.format, { context: parsed.context });
    const safeParsed = await B.parse(safe.text, entry.format);
    assert.ok(!JSON.stringify(safeParsed.context).includes('private-native-full-'), `${entry.format} 默认 servers 模式不携带文档偏好/历史`);
    for (const key of ['settings', 'mpvConf', 'iconPacks']) {
      if (entry.format === 'hills') assert.notEqual(safeParsed.context.document[key], entry.outerExpected[key], `Hills servers 模式不复用加密 ${key} 段`);
    }
    assert.deepEqual(parsed.context, contextSnapshot, `${entry.format} 两种导出不原地修改 context`);
  }

  const hillsV3Text = await packHills(hillsInner, { version: 3, settings: 'AAAA', iconPacks: 'BBBB', serversData: 'CCCC', enableImpeller: null });
  const hillsV3 = await B.parse(hillsV3Text, 'hills');
  await rejectExport(hillsV3.servers, 'hills', { mode: 'full', context: hillsV3.context }, /Hills|v3|3|版本/i);
  const v3ServersOnly = await B.build(hillsV3.servers, 'hills');
  const v3SafeDocument = JSON.parse(v3ServersOnly.text);
  assert.equal(v3SafeDocument.version, 2, 'Hills v3 可安全迁移服务器为 v2，不假装完整恢复 v3');
  assert.ok(!('serversData' in v3SafeDocument) && !('enableImpeller' in v3SafeDocument), 'Hills servers 模式不迁移未知 v3 段');
  const [v3SafeServer] = (await B.parse(v3ServersOnly.text, 'hills')).servers;
  assert.deepEqual([v3SafeServer.name, v3SafeServer.url, v3SafeServer.username, v3SafeServer.password], [hillsV3.servers[0].name, hillsV3.servers[0].url, hillsV3.servers[0].username, hillsV3.servers[0].password], 'Hills v3 servers 模式保持服务器核心字段');

  for (const format of ['afusekt', 'bridge', 'csv']) {
    const built = await B.build(servers, format);
    const parsed = await B.parse(built.text, format);
    await rejectExport(parsed.servers, format, { mode: 'full', context: parsed.context }, /格式|full|完整|整份|支持|context|来源/i);
  }
}

// Android 0.4.9 portable contract: no credential toggle; reject sensitive routes,
// keep native IDs when valid, and repair invalid IDs only without history scope.
{
  const base = { name: '虚构 Android 便携', url: 'https://mobile-contract.example.com/emby/', username: 'fictional-user', password: 'fictional-password', accessToken: 'fictional-token', userId: 'fictional-user-id' };
  const allowedFields = ['serverId', 'displayName', 'lines', 'activeLineId', 'remoteServerId', 'remark', 'serverType', 'aggregateEnabled', 'aggregateSearchEnabled', 'aggregateContinueWatchingEnabled', 'aggregateFavoritesEnabled', 'aggregatePlaybackSourcesEnabled', 'preloadNextEpisodeEnabled', 'strmEnabled', 'keepAliveDays', 'keepAliveStartedAtMs', 'homePresentation', 'requiresAuthentication', 'useSystemProxy', 'cropIconToCircle', 'userId', 'userName'];
  const source = B.normalize([{ ...base, raw: { wwmobile: { serverId: 'native-valid-server', credentials: { password: 'fictional-nonportable' }, password: 'fictional-old-password', accessToken: 'fictional-old-token', customField: 'unsupported' } } }]);
  const out = JSON.parse((await B.build(source, 'wwmobile')).text);
  assert.equal(out.credentialsIncluded, false, '手机便携输出始终不含登录凭据');
  assert.equal(out.servers[0].requiresAuthentication, true, '便携档导入后必须重新认证');
  assert.equal(out.servers[0].serverId, 'native-valid-server', '有效原生服务器 ID 不重建');
  assert.ok(Object.keys(out.servers[0]).every(key => allowedFields.includes(key)), '手机端输出仅包含已核对的 22 类原生字段');
  assert.ok(!JSON.stringify(out).includes('fictional-nonportable'), '未知 credentials 映射不混入手机文件');
  assert.equal(out.servers[0].userName, base.username, '便携档保留用户名');
  assert.equal(out.servers[0].userId, base.userId, '便携档保留 User ID');
  assert.ok(/^[A-Za-z0-9._:-]{1,96}$/.test(out.servers[0].lines[0].lineId), '新手机线路 ID 符合原生约束');
  assert.equal(out.servers[0].activeLineId, out.servers[0].lines[0].lineId, '活动 ID 指向实际输出线路');
  const minimal = { schemaVersion: 2, exportedAtMs: Date.now(), servers: [{ serverId: 'minimal-server', displayName: '最小虚构便携档', lines: [{ lineId: 'minimal-line', serverUrl: base.url }], activeLineId: 'minimal-line' }] };
  assert.equal(B.detect(JSON.stringify(minimal), 'minimal-mobile.json'), 'wwmobile', '省略默认偏好字段的便携档也可识别');
  const minimalParsed = await B.parse(JSON.stringify(minimal), 'wwmobile');
  assert.equal(minimalParsed.servers[0].url, base.url, '最小必需字段可读取，无需伪造整套偏好');
  await B.build(minimalParsed.servers, 'wwmobile');
  for (const exportedAtMs of [undefined, '123', -1, 1.5]) {
    await assert.rejects(() => B.parse(JSON.stringify({ ...minimal, exportedAtMs }), 'wwmobile'), friendlyError(/exportedAtMs|时间戳/i));
  }
  await rejectExport([{ ...base, name: ' ' }], 'wwmobile', {}, /名称|name/i);
  for (const url of [
    'https://fictional-user:fictional-password@mobile-contract.example.com/emby/',
    'https://mobile-contract.example.com/emby/#fragment',
    'https://mobile-contract.example.com/emby/?%74oKen=fictional',
    'https://mobile-contract.example.com/emby/?api_key=fictional',
    'https://mobile-contract.example.com/emby/?Authorization=fictional'
  ]) {
    await rejectExport([{ ...base, url }], 'wwmobile', {}, /敏感|认证|内嵌|片段|参数/i);
    await rejectExport([{ ...base, lines: [{ id: 'unsafe-mobile-route', name: '备用', url, active: true }] }], 'wwmobile', {}, /敏感|认证|内嵌|片段|参数/i);
  }
  const harmless = 'https://mobile-contract.example.com/emby/?lang=zh&quality=high';
  const harmlessOut = JSON.parse((await B.build([{ ...base, url: harmless }], 'wwmobile')).text);
  assert.equal(harmlessOut.servers[0].lines[0].serverUrl, harmless, '非敏感查询参数不静默丢弃');
  const badIds = cloneFixture(mobileDocument);
  badIds.servers[0].serverId = 'invalid server id';
  badIds.servers[0].lines[1].lineId = badIds.servers[0].lines[0].lineId;
  const parsedBadIds = await B.parse(JSON.stringify(badIds), 'wwmobile');
  const warning = checkExport(parsedBadIds.servers, 'wwmobile');
  assert.match(warning.warnings.join('\n'), /标识|ID/i, '仅服务器模式预告标识修复');
  const repaired = JSON.parse((await B.build(parsedBadIds.servers, 'wwmobile')).text);
  assert.ok(repaired.servers.every(s => /^[A-Za-z0-9._:-]{1,96}$/.test(s.serverId)), '无效手机服务器标识安全修复');
  for (const s of repaired.servers) {
    assert.equal(new Set(s.lines.map(l => l.lineId)).size, s.lines.length, '重复原生线路标识修复为唯一');
    assert.ok(s.lines.some(l => l.lineId === s.activeLineId), '修复后的活动引用仍存在');
  }
  await rejectExport(parsedBadIds.servers, 'wwmobile', { mode: 'full', context: parsedBadIds.context }, /标识|重复|引用/i);
  const duplicateServers = cloneFixture(mobileDocument);
  duplicateServers.servers[1].serverId = duplicateServers.servers[0].serverId;
  const parsedDuplicates = await B.parse(JSON.stringify(duplicateServers), 'wwmobile');
  const unique = JSON.parse((await B.build(parsedDuplicates.servers, 'wwmobile')).text);
  assert.equal(new Set(unique.servers.map(s => s.serverId)).size, 2, '重复手机原生服务器标识不能覆盖记录');
  await rejectExport(parsedDuplicates.servers, 'wwmobile', { mode: 'full', context: parsedDuplicates.context }, /标识|重复|引用/i);
}

// 结构错误与未来版本应给可读错误，不泄漏 in/null/map/加密底层异常。
{
  for (const text of ['[1]', '[null]', 'null']) {
    assert.equal(B.detect(text, 'fictional.json'), null, '非对象备份检测返回无法识别而非崩溃');
    assert.equal(B.detect(text, 'HillsBackup-fictional.json'), null, 'Hills 文件名不能让 null/原始数组检测崩溃');
  }
  for (const value of [[1], [null]]) {
    await assert.rejects(() => B.parse(JSON.stringify(value), 'afusekt'), friendlyError(/AfuseKt|对象|服务器/i));
    await assert.rejects(() => B.parse(JSON.stringify({ format: 'emby-bridge', version: 2, servers: value }), 'bridge'), friendlyError(/对象|服务器|通用/i));
    assert.throws(() => B.normalize(value), friendlyError(/对象|服务器/i));
  }
  await assert.rejects(() => B.parse('null', 'hills'), friendlyError(/备份|对象|Hills/i));
  await assert.rejects(() => B.parse('{"format":"emby-bridge","version":2,"servers":', 'bridge'), friendlyError(/JSON|引号|括号/i));
  for (const format of ['yamby', 'linplayer']) {
    for (const configs of [{}, [null], [1], [{}]]) {
      await assert.rejects(() => B.parse(JSON.stringify({ configs, _key: null }), format), friendlyError(/configs|配置|数组|字符串|加密项/i));
    }
    const nullConfigText = await packConfigs(format, [null]);
    await assert.rejects(() => B.parse(nullConfigText, format), friendlyError(/配置|对象|JSON/i));
  }
  await assert.rejects(() => B.parse(JSON.stringify({ configs: [], _key: 'AA==' }), 'linplayer'), friendlyError(/_key|32|字节|密钥/i));
  const invalidYambyRoutes = await packConfigs('yamby', [{ name: '坏线路', url: 'https://malformed.example.com', authorization: {}, lines: [null] }]);
  await assert.rejects(() => B.parse(invalidYambyRoutes, 'yamby'), friendlyError(/线路|对象|数组/i));
  const invalidLinRoutes = await packConfigs('linplayer', [{ url: 'https://malformed.example.com', linplayer: { lines: {} } }]);
  await assert.rejects(() => B.parse(invalidLinRoutes, 'linplayer'), friendlyError(/线路|对象|数组/i));
  for (const nonce of [null, '', 1, {}]) {
    await assert.rejects(() => B.parse(JSON.stringify({ magic: 'WWPLAYER_CONFIG_EXPORT_V1', nonce, payload: 'AAAA' }), 'wwplayer'), friendlyError(/nonce|WWPlayer|字符串/i));
  }
  await assert.rejects(() => B.parse(JSON.stringify({ magic: 'WWPLAYER_CONFIG_EXPORT_V1', nonce: 'fictional-nonce', payload: null }), 'wwplayer'), friendlyError(/payload|WWPlayer|字符串/i));
  await assert.rejects(() => B.parse(packWw({ servers: [{ id: 'bad-pc', lines: [1] }] }), 'wwplayer'), friendlyError(/线路|对象|数组/i));
  for (const encrypted_data of [[], 'AA==', 'AA==:AA==']) {
    await assert.rejects(() => B.parse(JSON.stringify({ version: '1.0', encrypted_data }), 'capyplayer'), friendlyError(/Capy|encrypted_data|IV|字符串|字节/i));
  }
  await assert.rejects(() => B.parse(JSON.stringify({ version: '1.0', encrypted_data: fixtureBase64(fixtureIv) + ':AA==' }), 'capyplayer'), friendlyError(/Capy|解密|备份|完整|密文/i));
  for (const backup_routes of ['[', '{}', '[null]', '[1]']) {
    const badText = await packCapy({ tables: { media_server_resources: [{ id: 'bad-capy', name: '坏 Capy 路由', host: 'malformed.example.com', https: 1, port: 443, path: '/emby', backup_routes }] }, preferences: {} });
    await assert.rejects(() => B.parse(badText, 'capyplayer'), friendlyError(/backup_routes|JSON|线路|对象|数组/i));
  }
  const hillsNull = await packHills({ data: [null] });
  await assert.rejects(() => B.parse(hillsNull, 'hills'), friendlyError(/Hills|服务器|对象/i));
  const hillsBadRoutes = await packHills({ data: [{ serverUrl: 'https://malformed.example.com', serverRoutingList: [null] }] });
  await assert.rejects(() => B.parse(hillsBadRoutes, 'hills'), friendlyError(/线路|对象|数组/i));
  const badMobile = cloneFixture(mobileDocument);
  badMobile.servers = [{ ...badMobile.servers[0], lines: [null] }];
  await assert.rejects(() => B.parse(JSON.stringify(badMobile), 'wwmobile'), friendlyError(/线路|对象|数组/i));
  const futureMobile = { ...cloneFixture(mobileDocument), schemaVersion: 3 };
  assert.equal(B.detect(JSON.stringify(futureMobile), 'future-mobile.json'), 'wwmobile', '未来 mobile 可识别格式但必须拒绝未知版本');
  await assert.rejects(() => B.parse(JSON.stringify(futureMobile), 'wwmobile'), friendlyError(/schemaVersion|版本|2|未知/i));
  const futureBridge = { format: 'emby-bridge', version: 99, servers: [] };
  assert.equal(B.detect(JSON.stringify(futureBridge), 'future-bridge.json'), 'bridge', '未来 bridge 可识别格式但必须拒绝未知版本');
  await assert.rejects(() => B.parse(JSON.stringify(futureBridge), 'bridge'), friendlyError(/版本|v1|v2|支持/i));
}

// 导入限额使用 UTF-8 字节数；边界 5000 台可读，5001 台拒绝。
{
  assert.equal(B.MAX_IMPORT_BYTES, 20 * 1024 * 1024, '导入大小上限公开为 20 MiB');
  assert.equal(B.MAX_SERVERS, 5000, '服务器数量上限公开为 5000');
  const tooLarge = JSON.stringify({ format: 'emby-bridge', version: 2, servers: [], fixturePadding: '界'.repeat(Math.floor(B.MAX_IMPORT_BYTES / 3) + 1) });
  assert.ok(Buffer.byteLength(tooLarge, 'utf8') > B.MAX_IMPORT_BYTES, '多字节 fixture 的 UTF-8 实际超限');
  assert.ok(tooLarge.length < B.MAX_IMPORT_BYTES, '多字节 fixture 的字符数未超限，防止只按字符串长度计算');
  await assert.rejects(() => B.parse(tooLarge, 'bridge'), friendlyError(/20|MiB|大小|上限|超过/i));
  const boundary = Array.from({ length: B.MAX_SERVERS }, (_, index) => {
    const url = 'https://limit.example.com/server-' + index;
    return { id: 'limit-server-' + index, name: '虚构限额 ' + index, url, lines: [{ id: 'limit-line-' + index, name: '默认', url, active: true }] };
  });
  const boundaryParsed = await B.parse(JSON.stringify({ format: 'emby-bridge', version: 2, servers: boundary }), 'bridge');
  assert.deepEqual(boundaryParsed.context.serverIds, boundary.map(s => s.id), '5000 台边界保留全部稳定 ID 与顺序');
  assert.deepEqual(boundaryParsed.servers.map(s => [s.name, s.url, s.lines[0].id]), boundary.map(s => [s.name, s.url, s.lines[0].id]), '5000 台边界逐项完整读取，而非只比记录数');
  const overLimit = [...boundary, { id: 'limit-overflow', name: '超限虚构服务器', url: 'https://limit.example.com/overflow' }];
  assert.throws(() => B.normalize(overLimit), friendlyError(/5000|上限|数量|超过/i));
  await assert.rejects(() => B.parse(JSON.stringify({ format: 'emby-bridge', version: 2, servers: overLimit }), 'bridge'), friendlyError(/5000|上限|数量|超过/i));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => B.parse('{"format":"emby-bridge","version":2,"servers":[]}', 'bridge', { signal: controller.signal }), error => {
    assert.equal(error.name, 'AbortError', 'parse 识别显式 signal 取消');
    assert.match(error.message, /取消|abort/i, '取消原因可读');
    return true;
  });
}

console.log('OK: 严格回归通过：安全 servers/full 范围、Bridge v2/v1、CSV/quick 精确字段、稳定原生线路、保守 URL 合并、Android 便携限制、TLS 警告、可读错误与导入限额。');
