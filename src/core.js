/*
 * Emby Bridge - core format codecs
 * ------------------------------------------------------------------
 * Pure local format conversion for Emby/Jellyfin player configuration
 * backups. No network calls, no telemetry, no server login.
 *
 * The codecs handle the server-config interchange backups shared by
 * several media players. All crypto happens locally with Web Crypto
 * (or Node WebCrypto when running the self-test).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.EmbyBridge = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var subtle = (globalThis.crypto && globalThis.crypto.subtle) ||
    (typeof require === 'function' ? require('crypto').webcrypto.subtle : null);
  var random = globalThis.crypto || (typeof require === 'function' ? require('crypto').webcrypto : null);
  var enc = new TextEncoder();
  var dec = new TextDecoder();

  /* ------------------------------ primitives ------------------------------ */

  function utf8(s) { return enc.encode(s == null ? '' : String(s)); }
  function fromUtf8(b) { return dec.decode(b); }
  function bytesToB64(b) {
    var s = '';
    for (var i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function b64ToBytes(s) {
    s = String(s).replace(/\s/g, '');
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function hexToBytes(h) {
    var out = new Uint8Array(h.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
    return out;
  }
  function randomBytes(n) { var b = new Uint8Array(n); random.getRandomValues(b); return b; }
  function hexId(n) { var b = randomBytes(Math.ceil(n / 2)); return Array.from(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('').slice(0, n); }
  function uuid() {
    if (random.randomUUID) return random.randomUUID();
    var b = randomBytes(16); b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.from(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function nowSec() { return Math.floor(Date.now() / 1000); }
  function nowMs() { return Date.now(); }
  function stamp() { var d = new Date(); return d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2); }
  function p2(n) { return ('0' + n).slice(-2); }
  function dotNetNow() {
    var d = new Date(), off = -d.getTimezoneOffset(), sign = off >= 0 ? '+' : '-';
    var a = Math.abs(off);
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + 'T' +
      p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()) + '.' +
      p2(d.getMilliseconds()) + '0000' + sign + p2(Math.floor(a / 60)) + ':' + p2(a % 60);
  }

  function requireSubtle() {
    if (!subtle) throw new Error('当前环境不支持 Web Crypto。请用 HTTPS 页面、localhost，或新版 Chrome / Edge / Safari 打开本工具。');
  }
  async function sha256(data) { requireSubtle(); return new Uint8Array(await subtle.digest('SHA-256', data)); }
  async function pbkdf2(password, salt, iterations, bytes) {
    requireSubtle();
    var key = await subtle.importKey('raw', utf8(password), 'PBKDF2', false, ['deriveBits']);
    var bits = await subtle.deriveBits({ name: 'PBKDF2', salt: utf8(salt), iterations: iterations, hash: 'SHA-256' }, key, bytes * 8);
    return new Uint8Array(bits);
  }
  async function cbcKey(raw) { return subtle.importKey('raw', raw, { name: 'AES-CBC' }, false, ['encrypt', 'decrypt']); }
  async function cbcEncrypt(keyBytes, iv, plain) {
    requireSubtle();
    var k = await cbcKey(keyBytes);
    return new Uint8Array(await subtle.encrypt({ name: 'AES-CBC', iv: iv }, k, plain));
  }
  async function cbcDecrypt(keyBytes, iv, cipher) {
    requireSubtle();
    var k = await cbcKey(keyBytes);
    return new Uint8Array(await subtle.decrypt({ name: 'AES-CBC', iv: iv }, k, cipher));
  }
  async function gcmEncrypt(keyBytes, iv, plain) {
    requireSubtle();
    var k = await subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
    return new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: iv, tagLength: 128 }, k, plain));
  }
  async function gcmDecrypt(keyBytes, iv, cipherAndTag) {
    requireSubtle();
    var k = await subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
    return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: iv, tagLength: 128 }, k, cipherAndTag));
  }
  async function cbcEncryptJson(keyBytes, iv, obj) { return bytesToB64(await cbcEncrypt(keyBytes, iv, utf8(JSON.stringify(obj)))); }

  /* ------------------------------- constants ------------------------------ */

  var YAMBY_KEY = utf8('makeeverymediaplayergreatagain!!');       // 32 bytes
  var LIN_KEY = new Uint8Array(32);                                 // LinPlayer-common-config-key-v1!\0
  (function () { var s = utf8('LinPlayer-common-config-key-v1!'); LIN_KEY.set(s.subarray(0, 32)); })();
  var WW_KEY = utf8('WWPlayer portable config export v1');
  var WW_MAGIC = 'WWPLAYER_CONFIG_EXPORT_V1';
  var CAPY_PASSWORD = 'capyplayer_default_backup_key_2026';
  var CAPY_SALT = 'capyplayer_backup_v1';
  var HILLS_KEY = hexToBytes('9d2729bd3afe5536669610e25b3ef6b3a7fd1efe2a065187101b144951617bce');
  var HILLS_IV = hexToBytes('bc322377137f312c2bff7a920aad959e');
  var AI_IV = hexToBytes('5ae5916c2798047f905dd2c5272e0f41');

  var META = {
    afusekt: { label: 'AfuseKt', ext: 'json', note: '明文 JSON，直接可读' },
    yamby: { label: 'Yamby / Tsukimi', ext: 'json', note: '通用配置格式，AES-256-CBC' },
    linplayer: { label: 'LinPlayer', ext: 'lpbak', note: 'AES-256-CBC，密钥随文件附带' },
    wwplayer: { label: 'WWPlayer 电脑端', ext: 'wwpcfg', note: 'V1 便携配置，可逆混淆' },
    wwmobile: { label: 'WWPlayer 手机端', ext: 'json', note: 'schemaVersion 2 便携备份（无密码 / Token）' },
    capyplayer: { label: 'CapyPlayer', ext: 'json', note: 'PBKDF2 + AES-256-GCM' },
    hills: { label: 'Hills', ext: 'json', note: 'AES-256-CBC' },
    aiplayer: { label: 'AI Player', ext: 'json', note: 'V1 加密配置' },
    bridge: { label: '通用中间格式', ext: 'json', note: '明文，可跨设备长期保存 / 手工编辑' },
    csv: { label: 'CSV 表格', ext: 'csv', note: '明文，便于批量编辑（不含全部字段）' }
  };
  var FORMATS = ['afusekt', 'yamby', 'linplayer', 'wwplayer', 'wwmobile', 'capyplayer', 'hills', 'aiplayer'];

  var IMPORT_FORMATS = FORMATS.concat(['bridge', 'csv']);
  var FULL_FORMATS = ['yamby', 'linplayer', 'wwplayer', 'wwmobile', 'capyplayer', 'hills', 'aiplayer'];
  var MAX_IMPORT_BYTES = 20 * 1024 * 1024;
  var MAX_SERVERS = 5000;
  var MAX_LINES = 200;
  var CSV_FIELDS = { name: 'name', 名称: 'name', type: 'type', 类型: 'type', url: 'url', 地址: 'url', address: 'url', username: 'username', 用户名: 'username', account: 'username', password: 'password', 密码: 'password', userid: 'userId', user_id: 'userId', accesstoken: 'accessToken', access_token: 'accessToken', token: 'accessToken', icon: 'icon', 图标: 'icon', lines: 'lines', 线路: 'lines', servername: 'serverName', remark: 'remark', 备注: 'remark', activeline: 'activeLine' };

  function isRecord(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function record(o, label) {
    if (!isRecord(o)) throw new Error(label + '必须是 JSON 对象');
    return o;
  }
  function records(arr, label, limit) {
    if (!Array.isArray(arr)) throw new Error(label + '必须是数组');
    if (arr.length > (limit || MAX_SERVERS)) throw new Error(label + '超出数量上限（' + (limit || MAX_SERVERS) + '）');
    arr.forEach(function (o, i) { record(o, label + '第 ' + (i + 1) + ' 项'); });
    return arr;
  }
  function textValue(v, label) {
    if (v == null) return '';
    if (typeof v !== 'string') throw new Error(label + '必须是字符串');
    return v;
  }
  function copy(o) {
    var out = {};
    if (isRecord(o)) Object.keys(o).forEach(function (k) {
      if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype') out[k] = o[k];
    });
    return out;
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function formatRaw(o) {
    var raw = {};
    if (isRecord(o)) FORMATS.forEach(function (fmt) { if (isRecord(o[fmt])) raw[fmt] = copy(o[fmt]); });
    return raw;
  }
  function checkAbort(options) {
    if (options && options.signal && options.signal.aborted) {
      var e = new Error('操作已取消'); e.name = 'AbortError'; throw e;
    }
  }

  /* ---------------------------- unified model ----------------------------- */

  function emptyLine(l) {
    l = record(l || {}, '线路');
    return {
      id: typeof l.id === 'string' && l.id ? l.id : hexId(32),
      name: textValue(l.name, '线路名称'), url: textValue(l.url, '线路地址'),
      active: l.active === true, raw: formatRaw(l.raw)
    };
  }
  function emptyServer(o) {
    o = record(o || {}, '服务器');
    var x = {
      id: (typeof o.id === 'string' || typeof o.id === 'number') && String(o.id) ? String(o.id) : hexId(32),
      lines: o.lines == null ? [] : records(o.lines, '线路', MAX_LINES).map(emptyLine),
      primaryLineId: typeof o.primaryLineId === 'string' ? o.primaryLineId : '',
      activeLineId: typeof o.activeLineId === 'string' ? o.activeLineId : '',
      activeLine: Number.isInteger(o.activeLine) ? o.activeLine : -1,
      sortOrder: typeof o.sortOrder === 'number' && Number.isFinite(o.sortOrder) ? o.sortOrder : 0,
      _selected: o._selected, _open: o._open,
      _sources: Array.isArray(o._sources) ? o._sources.filter(function (s) { return typeof s === 'string'; }) : [],
      raw: formatRaw(o.raw)
    };
    ['name', 'serverName', 'type', 'url', 'username', 'password', 'userId', 'accessToken', 'icon', 'remark'].forEach(function (k) {
      x[k] = textValue(o[k], k);
    });
    x.type = x.type || 'emby';
    return x;
  }
  function setActiveLine(s, lineId) {
    var idx = (s.lines || []).findIndex(function (l) { return l.id === lineId; });
    if (idx < 0) idx = Math.max(0, (s.lines || []).findIndex(function (l) { return l.id === s.primaryLineId; }));
    s.activeLine = idx;
    s.activeLineId = s.lines[idx] ? s.lines[idx].id : '';
    s.lines.forEach(function (l, i) { l.active = i === idx; });
    return s;
  }
  function setPrimaryUrl(s, value) {
    var old = s.url;
    s.url = String(value == null ? '' : value);
    var main = s.lines.find(function (l) { return l.id === s.primaryLineId; }) || s.lines.find(function (l) { return l.url === old; });
    if (!main) { main = emptyLine({ name: '主线路', url: s.url }); s.lines.unshift(main); }
    main.url = s.url; s.primaryLineId = main.id;
    if (!s.activeLineId) setActiveLine(s, main.id);
    return s;
  }
  function setLineUrl(s, lineId, value) {
    var l = s.lines.find(function (l) { return l.id === lineId; });
    if (l) { l.url = String(value == null ? '' : value); if (l.id === s.primaryLineId) s.url = l.url; }
    return s;
  }
  function normalize(servers) {
    var ids = new Set();
    return records(servers || [], '服务器').map(function (s, i) {
      var x = emptyServer(s), lineIds = new Set();
      if (ids.has(x.id)) x.id = hexId(32);
      ids.add(x.id);
      x.url = x.url.trim();
      if (s.sortOrder == null) x.sortOrder = i;
      x.lines.forEach(function (l) {
        l.url = l.url.trim();
        if (lineIds.has(l.id)) l.id = hexId(32);
        lineIds.add(l.id);
      });
      // Resolve a legacy array index before moving/inserting the primary route.
      var active = x.lines.find(function (l) { return l.id === x.activeLineId; });
      if (!active && !x.activeLineId) active = x.lines.find(function (l) { return l.active; }) || x.lines[x.activeLine];
      var primary = x.lines.find(function (l) { return l.id === x.primaryLineId; });
      if (primary) primary.url = x.url;
      else primary = x.lines.find(function (l) { return x.url && l.url === x.url; });
      if (!primary && x.url) { primary = emptyLine({ name: '主线路', url: x.url }); x.lines.unshift(primary); }
      if (primary) {
        x.primaryLineId = primary.id;
        var pos = x.lines.indexOf(primary);
        if (pos > 0) { x.lines.splice(pos, 1); x.lines.unshift(primary); }
      } else x.primaryLineId = '';
      if (x.lines.length > MAX_LINES) throw new Error('服务器线路数量超过 ' + MAX_LINES + ' 条上限');
      // Inserting the primary route must never replace a selected backup route.
      setActiveLine(x, active ? active.id : x.primaryLineId);
      return x;
    });
  }
  function activeUrl(s) {
    var l = (s.lines || []).find(function (l) { return l.id === s.activeLineId; }) || (s.lines || [])[s.activeLine];
    return (l && l.url) || s.url;
  }
  function serverIdentity(s) {
    var address = String(s.url || '').trim();
    address = address.replace(/^(https?):\/\/([^/\?#]+)/i, function (_, scheme, authority) {
      // Userinfo is case-sensitive; only the host/port portion is folded.
      var at = authority.lastIndexOf('@');
      return scheme.toLowerCase() + '://' + (at >= 0 ? authority.slice(0, at + 1) : '') + authority.slice(at + 1).toLowerCase();
    });
    return JSON.stringify([s.type || 'emby', address, String(s.username || '')]);
  }
  function hasMergeIdentity(s) {
    var address = String(s.url || '').trim();
    if (!/^https?:\/\//i.test(address) || /[\\\u0000-\u0020\u007f]/.test(address)) return false;
    try { var url = new URL(address); return (url.protocol === 'http:' || url.protocol === 'https:') && !!url.hostname; }
    catch (e) { return false; }
  }
  function credentialsCompatible(a, b) {
    return ['password', 'userId', 'accessToken'].every(function (k) { return !a[k] || !b[k] || a[k] === b[k]; });
  }
  function mergeServerLists(existing, incoming) {
    // Work on copies so a failed/oversized import cannot partially alter the UI.
    var out = records(existing || [], '现有服务器').map(emptyServer), added = 0, merged = 0, buckets = new Map();
    records(incoming || [], '导入服务器');
    function index(s) {
      if (!hasMergeIdentity(s)) return;
      var key = serverIdentity(s);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(s);
    }
    out.forEach(index);
    incoming.forEach(function (s) {
      var candidates = (hasMergeIdentity(s) ? buckets.get(serverIdentity(s)) || [] : []).filter(function (a) { return credentialsCompatible(a, s); });
      // Indexing must not weaken the conservative conflict/ambiguity rule.
      if (candidates.length !== 1) {
        if (out.length >= MAX_SERVERS) throw new Error('合并后的服务器数量超过 ' + MAX_SERVERS + ' 台上限');
        var item = emptyServer(s); out.push(item); index(item); added++; return;
      }
      var a = candidates[0];
      ['name', 'serverName', 'username', 'password', 'userId', 'accessToken', 'icon', 'remark'].forEach(function (k) {
        if (!a[k] && s[k]) a[k] = s[k];
      });
      a.lines = a.lines || [];
      var routes = new Map(a.lines.map(function (l) { return [l.url, l]; }));
      (s.lines || []).forEach(function (l) {
        var old = routes.get(l.url);
        if (!old) { old = Object.assign({}, l, { active: false, raw: formatRaw(l.raw) }); a.lines.push(old); routes.set(l.url, old); }
        else {
          old.raw = formatRaw(old.raw);
          FORMATS.forEach(function (fmt) { if (!old.raw[fmt] && l.raw && l.raw[fmt]) old.raw[fmt] = copy(l.raw[fmt]); });
        }
      });
      a.raw = formatRaw(a.raw);
      FORMATS.forEach(function (fmt) { if (!a.raw[fmt] && s.raw && s.raw[fmt]) a.raw[fmt] = copy(s.raw[fmt]); });
      a._sources = Array.from(new Set((a._sources || []).concat(s._sources || [])));
      merged++;
    });
    return { servers: out, added: added, merged: merged };
  }
  function dedupe(servers) { return mergeServerLists([], servers).servers; }
  function splitUrl(u) {
    var path = /^(?:https?):\/\/[^/\?#]+(\/[^\?#]*)?$/i.exec(u);
    if (!path || /[\\\u0000-\u0020\u007f]/.test(u)) throw new Error('CapyPlayer 需要完整且不含空白 / 反斜杠的 HTTP / HTTPS 地址');
    var p = new URL(u), https = p.protocol === 'https:';
    if (p.port === '0') throw new Error('CapyPlayer 无法无损表达显式端口 0，请改用其它格式或人工调整地址');
    // Keep the original path text, including absence versus an explicit root /.
    return { https: https ? 1 : 0, host: p.hostname, port: p.port ? +p.port : (https ? 443 : 80), path: path[1] || '' };
  }
  function joinUrl(https, host, port, path) {
    if (!host) return '';
    host = textValue(host, 'CapyPlayer host'); path = textValue(path, 'CapyPlayer path');
    if (https != null && https !== true && https !== false && https !== 0 && https !== 1) throw new Error('CapyPlayer https 必须是布尔值或 0 / 1');
    if (port != null && port !== '' && (!Number.isInteger(Number(port)) || Number(port) < 0 || Number(port) > 65535)) throw new Error('CapyPlayer port 必须是 0–65535 的整数');
    if (host.indexOf(':') >= 0 && host.charAt(0) !== '[') host = '[' + host + ']';
    var s = (https ? 'https' : 'http') + '://' + host, p = port ? Number(port) : 0;
    if (p && !((https && p === 443) || (!https && p === 80))) s += ':' + p;
    if (path) s += (path.charAt(0) === '/' ? '' : '/') + path;
    return s;
  }
  function linesFromRaw(arr, map, fmt) {
    if (arr == null) return [];
    return records(arr, '原生线路', MAX_LINES).map(function (x) {
      var l = map(x); l.raw = {}; l.raw[fmt] = copy(x); return l;
    }).filter(function (l) { return l.url; });
  }
  function rawLine(s, line, fmt) {
    if (line.raw && isRecord(line.raw[fmt])) return copy(line.raw[fmt]);
    // Legacy in-memory models may have server.raw but no per-line raw. Match
    // a unique URL in that case; never reuse extension fields by array index.
    var o = (s.raw || {})[fmt] || {}, arr = o.lines || [];
    if (fmt === 'linplayer') arr = (o.linplayer || {}).lines || [];
    if (fmt === 'hills') arr = o.serverRoutingList || [];
    if (fmt === 'capyplayer') { try { arr = JSON.parse(o.backup_routes || '[]'); } catch (e) { arr = []; } }
    if (!Array.isArray(arr)) return {};
    var matches = arr.filter(function (r) {
      if (!isRecord(r)) return false;
      var u = fmt === 'capyplayer' ? joinUrl(r.https, r.host, r.port, r.path) : (r.url || r.serverUrl || r.address);
      return u === line.url;
    });
    return matches.length === 1 ? copy(matches[0]) : {};
  }

  /*
   * Hills CBC quirk: different exporters use a different IV tail (the first
   * 8 bytes are shared). In AES-CBC only plaintext block 0 depends on the IV,
   * so blocks 1..n still decrypt perfectly. When the head is garbled we
   * rebuild the fixed JSON prefix and parse the intact remainder.
   */
  function parseHillsJson(buf) {
    var whole = fromUtf8(buf);
    var tries = [whole, whole + '}', whole.replace(/\s+$/, '') + '}'];
    for (var i = 0; i < tries.length; i++) {
      try { return JSON.parse(tries[i]); } catch (e) { /* next */ }
    }
    var prefixes = ['{"data":[{"displ', '{"data":[{"displa', '{"data":[{', '{"data":['];
    var offsets = [16, 15, 17, 14, 18];
    var best = null, bestScore = -1;
    function score(obj) {
      var first = (obj.data || obj.servers || [])[0];
      if (!first || typeof first !== 'object') return 0;
      var n = 0;
      if ('displyName' in first || 'displayName' in first) n += 2;
      if ('serverUrl' in first) n += 1;
      if ('serverName' in first) n += 1;
      return n;
    }
    for (var p = 0; p < prefixes.length; p++) {
      for (var q = 0; q < offsets.length; q++) {
        var tail = fromUtf8(buf.subarray(offsets[q]));
        var candidate = prefixes[p] + tail;
        var variants = [candidate, candidate + '}', candidate.replace(/\s+$/, '') + '}'];
        for (var v = 0; v < variants.length; v++) {
          try {
            var obj = JSON.parse(variants[v]);
            if (!obj || (!Array.isArray(obj.data) && !Array.isArray(obj.servers))) continue;
            var sc = score(obj);
            if (sc === 4) return obj;
            if (sc > bestScore) { best = obj; bestScore = sc; }
          } catch (e) { /* next */ }
        }
      }
    }
    if (best) return best;
    throw new Error('Hills 备份内容无法解析（解密后的文档结构不符合预期）');
  }

  /* -------------------------------- detect -------------------------------- */

  function csvHeaderLooksValid(text) {
    try {
      // This examines only the header, not physical lines of the CSV payload.
      var first = delimitedRows(text.split(/\r\n|\n|\r/, 1)[0], ',', false, 'CSV')[0] || [];
      var known = first.map(function (h) {
        var key = h.trim().toLowerCase();
        return Object.prototype.hasOwnProperty.call(CSV_FIELDS, key) ? CSV_FIELDS[key] : null;
      }).filter(Boolean);
      return known.length >= 2 || (first.length === 1 && known[0] === 'url');
    } catch (e) { return false; }
  }
  function detect(text, filename) {
    var t = String(text || '').replace(/^\uFEFF/, '').trim();
    var o = null;
    var fn = String(filename || '').toLowerCase();
    if (fn.endsWith('.csv') || csvHeaderLooksValid(t)) return 'csv';
    try { o = JSON.parse(t); } catch (e) { return null; }
    if (Array.isArray(o) && o.length && isRecord(o[0]) && ('originalAddress' in o[0] || 'nowAddress' in o[0])) return 'afusekt';
    if (o && o.magic === WW_MAGIC) return 'wwplayer';
    // Mobile WWPlayer full backup: plain JSON, schemaVersion 2.
    if (o && Number(o.schemaVersion) >= 2 && Array.isArray(o.servers) && (o.preferences || o.playbackHistory || typeof o.exportedAtMs === 'number')) return 'wwmobile';
    if (o && o.encrypted_data) return 'capyplayer';
    if (o && o.format === 'emby-bridge') return 'bridge';
    if (o && Array.isArray(o.configs) && o._key !== undefined) return fn.endsWith('.lpbak') ? 'linplayer' : 'yamby';
    if (o && Array.isArray(o.configs)) return 'yamby';
    // Hills v2 and v3 (v3 adds encrypted settings / iconPacks / serversData).
    // Do not hard-code a single version number: official exports keep adding
    // fields, and the server list still lives in the same encrypted `data`.
    if (o && typeof o.data === 'string' && Number(o.version) >= 2 && ('iconPacks' in o || 'serversData' in o)) return 'hills';
    if (o && /hillsbackup/i.test(fn) && typeof o.data === 'string') return 'hills';
    if (o && typeof o.data === 'string' && Object.keys(o).length <= 2) return 'aiplayer';
    if (fn.endsWith('.lpbak')) return 'linplayer';
    if (fn.endsWith('.wwpcfg')) return 'wwplayer';
    return null;
  }

  /* --------------------------------- parse -------------------------------- */

  function jsonDocument(text, label) {
    try { return JSON.parse(text); }
    catch (e) { throw new Error((label || '备份') + '不是有效的 JSON，请检查括号、引号和编码'); }
  }
  function nonemptyString(value, label) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(label + '必须是非空字符串');
    return value;
  }
  function configList(o) {
    if (!Array.isArray(o.configs) || o.configs.length > MAX_SERVERS) throw new Error('configs 必须是数组且不超过 ' + MAX_SERVERS + ' 项');
    o.configs.forEach(function (s) { nonemptyString(s, 'configs 加密项'); });
    return o.configs;
  }
  async function parsePayload(text, format, options) {
    options = options || {}; checkAbort(options);
    text = String(text).replace(/^\uFEFF/, '');
    if (utf8(text).length > MAX_IMPORT_BYTES) throw new Error('备份超过 20 MiB 导入上限');
    if (format === 'csv') return { servers: parseCsv(text), meta: { format: format }, context: null };
    var o = jsonDocument(text.trim()), servers = [], inner = null, i, it;
    if (format !== 'afusekt') record(o, '备份文档');
    switch (format) {
      case 'afusekt':
        records(o, 'AfuseKt 服务器').forEach(function (a) {
          var routes = linesFromRaw(a.lines, function (x) { return { name: x.name, url: x.address, active: !!x.isNow }; }, 'afusekt');
          if (a.nowAddress) {
            var current = routes.find(function (l) { return l.url === a.nowAddress; });
            if (!current) { current = { name: '当前线路', url: a.nowAddress }; routes.push(current); }
            routes.forEach(function (l) { l.active = l === current; });
          }
          var s = emptyServer({ name: a.name, url: a.originalAddress || a.nowAddress, username: a.account,
            password: a.password, type: a.sourceType || 'emby', icon: a.icon, lines: routes });
          s.raw.afusekt = copy(a); servers.push(s);
        });
        break;
      case 'yamby':
        configList(o);
        for (i = 0; i < o.configs.length; i++) {
          checkAbort(options);
          it = record(jsonDocument(fromUtf8(await cbcDecrypt(YAMBY_KEY, YAMBY_KEY.subarray(0, 16), b64ToBytes(o.configs[i]))), '解密配置'), 'Yamby 配置');
          var auth = it.authorization == null ? {} : record(it.authorization, 'authorization');
          var ys = emptyServer({ name: it.name, url: it.url, username: auth.user_name, password: auth.password,
            userId: auth.user_id, accessToken: auth.access_token, icon: it.icon, type: it.type || 'emby', sortOrder: it.sort_order,
            lines: linesFromRaw(it.lines, function (x) { return { name: x.name, url: x.url, active: x.url === it.url }; }, 'yamby') });
          ys.raw.yamby = copy(it); servers.push(ys);
        }
        break;
      case 'linplayer':
        configList(o);
        var lk = o._key ? b64ToBytes(nonemptyString(o._key, '_key')) : LIN_KEY;
        if (lk.length !== 32) throw new Error('LinPlayer _key 必须解码为 32 字节');
        for (i = 0; i < o.configs.length; i++) {
          checkAbort(options);
          it = record(jsonDocument(fromUtf8(await cbcDecrypt(lk, lk.subarray(0, 16), b64ToBytes(o.configs[i]))), '解密配置'), 'LinPlayer 配置');
          var ext = it.linplayer == null ? {} : record(it.linplayer, 'linplayer');
          var ls = emptyServer({ name: ext.name || it.name, url: it.url, username: it.username,
            password: ext.password, userId: it.user_id, accessToken: it.access_token, icon: ext.icon_url,
            type: it.type || 'emby', remark: ext.remark, lines: linesFromRaw(ext.lines, function (x) {
              return { name: x.name, url: x.url, active: x === ext.lines[Number.isInteger(ext.active_line) ? ext.active_line : 0] };
            }, 'linplayer') });
          ls.raw.linplayer = copy(it); servers.push(ls);
        }
        break;
      case 'wwplayer':
        if (o.magic !== WW_MAGIC) throw new Error('WWPlayer 电脑端 magic / 版本不支持');
        nonemptyString(o.nonce, 'WWPlayer nonce'); nonemptyString(o.payload, 'WWPlayer payload');
        inner = record(jsonDocument(fromUtf8(wwTransform(b64ToBytes(o.payload), o.nonce)), '解码配置'), 'WWPlayer 配置');
        records(inner.servers, 'WWPlayer 服务器').forEach(function (w, idx) {
          var routes = linesFromRaw(w.lines, function (x) { return { name: x.name, url: x.url, active: x.id === w.activeLineId }; }, 'wwplayer');
          var ws = emptyServer({ id: w.id, name: w.name, url: (routes[0] || {}).url || (idx === 0 ? inner.embyServerUrl : ''),
            username: w.username, password: w.password, userId: w.userId, accessToken: w.accessToken,
            icon: typeof w.icon === 'string' && w.icon.length > 2 ? w.icon : '', lines: routes });
          ws.raw.wwplayer = copy(w); servers.push(ws);
        });
        break;
      case 'wwmobile':
        if (o.schemaVersion !== 2) throw new Error('仅支持 WWPlayer 手机端 schemaVersion 2，不会自动降级未知版本');
        if (!Number.isSafeInteger(o.exportedAtMs) || o.exportedAtMs < 0) throw new Error('手机端 exportedAtMs 必须是非负的毫秒时间戳整数');
        if (o.preferences !== undefined) record(o.preferences, '手机端 preferences');
        records(o.servers, '手机端服务器').forEach(function (m, idx) {
          var routes = linesFromRaw(m.lines, function (x) { return { name: x.name, url: x.serverUrl, active: x.lineId === m.activeLineId }; }, 'wwmobile');
          var ms = emptyServer({ id: m.serverId, name: m.displayName, serverName: m.displayName,
            url: (routes[0] || {}).url || m.serverUrl, username: m.userName,
            password: m.password, userId: m.userId, accessToken: m.accessToken,
            type: m.serverType || 'emby', remark: m.remark, sortOrder: idx, lines: routes });
          ms.raw.wwmobile = copy(m); servers.push(ms);
        });
        break;
      case 'capyplayer':
        if (o.version != null && String(o.version) !== '1.0' && String(o.version) !== '1') throw new Error('不支持的 CapyPlayer 备份版本');
        var parts = nonemptyString(o.encrypted_data, 'encrypted_data').split(':');
        if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error('CapyPlayer encrypted_data 应为 base64(iv):base64(密文)');
        var civ = b64ToBytes(parts[0]);
        if (civ.length !== 16) throw new Error('CapyPlayer IV 必须为 16 字节');
        var ckey = await pbkdf2(CAPY_PASSWORD, CAPY_SALT, 10000, 32);
        inner = record(jsonDocument(fromUtf8(await gcmDecrypt(ckey, civ, b64ToBytes(parts[1]))), 'CapyPlayer 解密文档'), 'CapyPlayer 解密文档');
        var tables = record(inner.tables, 'CapyPlayer tables');
        records(tables.media_server_resources, 'CapyPlayer 服务器').forEach(function (r, idx) {
          var routes = jsonDocument(r.backup_routes == null ? '[]' : textValue(r.backup_routes, 'backup_routes'), 'backup_routes');
          var cs = emptyServer({ id: r.id, name: r.name, url: joinUrl(r.https, r.host, r.port, r.path),
            username: r.username, password: r.password, userId: r.user_id, accessToken: r.token,
            icon: r.server_logo_image_url, type: r.type || 'emby', remark: r.remark, sortOrder: r.sort_order == null ? idx : r.sort_order,
            lines: linesFromRaw(routes, function (x) { return { name: x.name, url: joinUrl(x.https, x.host, x.port, x.path), active: !!x.isUse }; }, 'capyplayer') });
          cs.raw.capyplayer = copy(r); servers.push(cs);
        });
        break;
      case 'hills':
        if (o.version != null && o.version !== 2 && o.version !== 3) throw new Error('仅支持 Hills v2 / v3 备份');
        inner = record(parseHillsJson(await cbcDecrypt(HILLS_KEY, HILLS_IV, b64ToBytes(nonemptyString(o.data, 'Hills data')))), 'Hills 解密文档');
        records(inner.data || inner.servers, 'Hills 服务器').forEach(function (h, idx) {
          var auth = h.authenticateJson ? record(jsonDocument(textValue(h.authenticateJson, 'authenticateJson'), 'authenticateJson'), 'authenticateJson') : {};
          var user = auth.User == null ? {} : record(auth.User, 'authenticateJson.User');
          var mainUrl = h.serverUrl || h.url;
          var routes = linesFromRaw(h.serverRoutingList, function (x) { return { name: x.name, url: x.url, active: x.id === h.selectedServerRoutingId }; }, 'hills');
          if (mainUrl) {
            var mainRoute = routes.find(function (l) { return l.url === mainUrl; });
            if (!mainRoute) { mainRoute = { name: h.mainRoutingName || '主线路', url: mainUrl }; routes.unshift(mainRoute); }
            else if (h.mainRoutingName) mainRoute.name = h.mainRoutingName;
          }
          var hs = emptyServer({ name: h.displyName || h.displayName || h.displaayName || h.serverName,
            serverName: h.serverName, url: mainUrl, username: h.username, password: h.password,
            userId: user.Id, accessToken: auth.AccessToken, icon: h.iconUrl, remark: h.remark,
            type: h.isJellyfin ? 'jellyfin' : 'emby', sortOrder: h.orderIndex == null ? idx : h.orderIndex,
            lines: routes });
          hs.raw.hills = copy(h); servers.push(hs);
        });
        break;
      case 'aiplayer':
        var akey = await sha256(utf8('AIPlayer'));
        inner = record(jsonDocument(fromUtf8(await cbcDecrypt(akey, AI_IV, b64ToBytes(nonemptyString(o.data, 'AI Player data')))), 'AI Player 解密文档'), 'AI Player 解密文档');
        if (inner.version != null && inner.version !== 1) throw new Error('仅支持 AI Player V1 备份');
        records(inner.servers, 'AI Player 服务器').forEach(function (a, idx) {
          var routes = linesFromRaw(a.lines, function (x) { return { name: x.name, url: x.url, active: a.preferredLineUrl ? x.url === a.preferredLineUrl : !!x.isMain }; }, 'aiplayer');
          if (a.preferredLineUrl && !routes.some(function (l) { return l.url === a.preferredLineUrl; })) routes.push({ name: '当前线路', url: a.preferredLineUrl, active: true });
          var as = emptyServer({ id: a.id, name: a.name, serverName: a.serverName, url: (routes[0] || {}).url || a.preferredLineUrl,
            username: a.username, password: a.encryptedPassword, userId: a.lastKnownUserId, accessToken: a.encryptedToken,
            icon: a.iconUrl, type: a.provider || 'emby', sortOrder: a.sortOrder == null ? idx : a.sortOrder, lines: routes });
          as.raw.aiplayer = copy(a); servers.push(as);
        });
        break;
      case 'bridge':
        if (o.format !== 'emby-bridge' || (o.version != null && o.version !== 1 && o.version !== 2)) throw new Error('不支持的通用中间格式版本（支持 v1 / v2）');
        records(o.servers, '通用格式服务器').forEach(function (b) { servers.push(emptyServer(b)); });
        break;
      default: throw new Error('未知格式: ' + format);
    }
    checkAbort(options);
    servers = normalize(servers);
    // Native identifiers live in raw. Fresh UI identities avoid collisions
    // when two independent source files reuse the same native server ID.
    if (format !== 'bridge') servers.forEach(function (s) { s.id = hexId(32); });
    // Document scope is independent of server selection, order and existence.
    var context = { id: hexId(32), format: format, serverIds: servers.map(function (s) { return s.id; }), document: o };
    if (inner) context.inner = inner;
    servers.forEach(function (s) { s._sources = [context.id]; });
    return { servers: servers, meta: { format: format, source: o }, context: context };
  }

  async function parse(text, format, options) {
    try { return await parsePayload(text, format, options); }
    catch (e) {
      if (e && ['OperationError', 'DataError', 'InvalidCharacterError'].indexOf(e.name) >= 0) throw new Error('备份解码 / 解密失败，请检查格式、版本和文件是否完整');
      throw e;
    }
  }

  /* --------------------------------- build -------------------------------- */

  function lineUrl(s, fallback) { return activeUrl(s) || fallback || ''; }
  function baseRaw(s, fmt) { return copy(s.raw && s.raw[fmt]); }
  function sourceContext(options, fmt) {
    var c = options && options.context;
    return isRecord(c) && c.format === fmt && isRecord(c.document) ? c : null;
  }
  function documentFor(options, fmt, fallback) {
    var c = sourceContext(options, fmt);
    return options && options.mode === 'full' && c ? clone(c.document) : fallback;
  }
  function uniqueNativeId(preferred, fallback, used) {
    var id = preferred == null ? '' : String(preferred);
    if (!id || used.has(id)) id = fallback;
    if (used.has(id)) id = hexId(32);
    used.add(id); return id;
  }

  function buildAfusekt(servers) {
    return servers.map(function (s) {
      var o = baseRaw(s, 'afusekt');
      var u = lineUrl(s);
      Object.assign(o, {
        originalAddress: s.url || u, nowAddress: u, account: s.username || '', password: s.password || '',
        sourceType: s.type || 'emby', icon: s.icon || '', name: s.name || '',
        lines: s.lines.filter(function (l) { return l.url && l.id !== s.activeLineId; })
          .map(function (l) { return Object.assign(rawLine(s, l, 'afusekt'), { address: l.url, isNow: false, name: l.name || '线路' }); })
      });
      return o;
    });
  }

  async function buildYamby(servers, options) {
    var configs = [], ids = new Set();
    for (var i = 0; i < servers.length; i++) {
      checkAbort(options);
      var s = servers[i], o = baseRaw(s, 'yamby'), auth = copy(o.authorization);
      Object.assign(auth, { user_name: s.username, password: s.password, user_id: s.userId, access_token: s.accessToken });
      if (auth.data === undefined) auth.data = null;
      Object.assign(o, {
        type: s.type, id: uniqueNativeId(o.id, s.id, ids), name: s.name, url: lineUrl(s),
        authorization: auth, sort_order: s.sortOrder, create_time: o.create_time || nowSec(), last_update_time: nowSec(),
        last_play_time: o.last_play_time || null, last_open_time: o.last_open_time || null, icon: s.icon || null,
        lines: s.lines.filter(function (l) { return l.url; }).map(function (l) {
          var r = rawLine(s, l, 'yamby');
          if (r.additional_data === undefined) r.additional_data = null;
          return Object.assign(r, { url: l.url, name: l.name || '线路' });
        }), options: o.options || null
      });
      configs.push(await cbcEncryptJson(YAMBY_KEY, YAMBY_KEY.subarray(0, 16), o));
    }
    var doc = documentFor(options, 'yamby', { from: 'EmbyBridge', version: '1.0', icon_packages: {}, settings: {}, additional_data: {}, _key: null });
    doc.configs = configs; doc.export_time = nowSec(); return doc;
  }

  async function buildLinplayer(servers, options) {
    var configs = [], ids = new Set(), doc = documentFor(options, 'linplayer', { from: 'EmbyBridge', version: '1.0', linplayer_settings: null });
    var key = doc._key ? b64ToBytes(doc._key) : LIN_KEY;
    for (var i = 0; i < servers.length; i++) {
      checkAbort(options);
      var s = servers[i], o = baseRaw(s, 'linplayer'), ext = copy(o.linplayer), lineIds = new Set();
      ext.name = s.name; ext.remark = s.remark || null; ext.icon_url = s.icon || null; ext.password = s.password;
      var liveLines = s.lines.filter(function (l) { return l.url; });
      ext.lines = liveLines.map(function (l) {
        var r = rawLine(s, l, 'linplayer');
        if (r.remark === undefined) r.remark = null;
        return Object.assign(r, { id: uniqueNativeId(r.id, l.id, lineIds), name: l.name || '线路', url: l.url });
      });
      ext.active_line = Math.max(0, liveLines.findIndex(function (l) { return l.id === s.activeLineId; }));
      if (ext.allow_insecure_tls === undefined) ext.allow_insecure_tls = false;
      ext.source_kind = s.type;
      if (ext.source === undefined) ext.source = {};
      Object.assign(o, {
        type: s.type, id: uniqueNativeId(o.id, s.id, ids), name: s.username || s.name,
        url: s.url, username: s.username, user_id: s.userId, access_token: s.accessToken, linplayer: ext
      });
      configs.push(await cbcEncryptJson(key, key.subarray(0, 16), o));
    }
    doc.configs = configs; doc.export_time = nowSec(); doc._key = bytesToB64(key); return doc;
  }

  function wwTransform(bytes, nonceStr) {
    var n = utf8(nonceStr), out = new Uint8Array(bytes.length);
    for (var i = 0; i < bytes.length; i++) {
      var kb = WW_KEY[i % WW_KEY.length], r = i % 8;
      out[i] = bytes[i] ^ (((kb << r) | (kb >> (8 - r))) & 0xff) ^ n[i % n.length];
    }
    return out;
  }

  function buildWwplayer(servers, options) {
    var ids = new Set();
    var list = servers.map(function (s) {
      var o = baseRaw(s, 'wwplayer'), lineIds = new Set(), live = s.lines.filter(function (l) { return l.url; });
      var lines = live.map(function (l) {
        var r = rawLine(s, l, 'wwplayer');
        return Object.assign(r, { id: uniqueNativeId(r.id, l.id, lineIds), name: l.name || '线路', url: l.url });
      });
      var idx = Math.max(0, live.findIndex(function (l) { return l.id === s.activeLineId; }));
      Object.assign(o, {
        id: uniqueNativeId(o.id, s.id, ids), name: s.name, icon: s.icon || 'w',
        username: s.username, userId: s.userId, accessToken: s.accessToken, password: s.password,
        useSystemProxy: o.useSystemProxy !== undefined ? o.useSystemProxy : true,
        activeLineId: lines[idx].id, lines: lines
      });
      return o;
    });
    var c = sourceContext(options, 'wwplayer');
    var inner = options.mode === 'full' && c && c.inner ? clone(c.inner) : {};
    inner.servers = list;
    var idx = list.findIndex(function (s) { return s.id === inner.activeServerId; });
    if (idx < 0) idx = 0;
    var first = servers[idx];
    inner.activeServerId = list[idx].id;
    inner.embyServerUrl = lineUrl(first); inner.embyUsername = first.username;
    inner.embyUserId = first.userId; inner.embyAccessToken = first.accessToken;
    var nonce = uuid();
    var doc = documentFor(options, 'wwplayer', {});
    return Object.assign(doc, { magic: WW_MAGIC, nonce: nonce, payload: bytesToB64(wwTransform(utf8(JSON.stringify(inner)), nonce)) });
  }

  // Default schemaVersion 2 portable document. Keep a complete set of known
  // preference/collection defaults for compatibility, not as proof of runtime
  // import success. Android 0.4.9 (593) also validates IDs, names, route URLs and
  // sensitive-data flags; password/accessToken are not portable profile fields.
  var WW_MOBILE_TEMPLATE = {
  "schemaVersion": 2,
  "credentialsIncluded": false,
  "preferences": {
    "ignoreSslCertificateValidation": false,
    "themeMode": "System",
    "interfaceLanguage": "System",
    "accentColor": "Blue",
    "accountLandingPage": "statistics",
    "watchStatisticsCardOrder": [
      "month",
      "ranking",
      "today",
      "week",
      "feelings",
      "types"
    ],
    "badgePacks": [],
    "badgePackIgnoreUnmatchedLabels": false,
    "startupPage": "last",
    "navigationOrder": [
      "Home",
      "Favorites",
      "Tv",
      "Servers",
      "Settings"
    ],
    "hiddenNavigationItems": [],
    "minimizeDockOnScroll": false,
    "showDockLabels": false,
    "hiddenServerIds": [],
    "hiddenSourceOwners": {},
    "favoritePeople": [],
    "serverCardLayout": "grid",
    "autoRotateHero": true,
    "heroRotationSeconds": 8,
    "preferTextlessPoster": true,
    "detailAwardPreview": true,
    "detailAwardPreviewStyle": "laurel",
    "homeMode": "Combined",
    "homeHeroSource": "Server",
    "discoveryHeroSectionId": "tmdb-popular-movies",
    "showContinueWatching": true,
    "continueGrouping": "none",
    "autoRotatePlayer": true,
    "autoPlayNextEpisode": true,
    "preloadNextEpisode": true,
    "playerScaleMode": "fit",
    "androidPlaybackEngine": "Media3",
    "playbackDecoderMode": "Auto",
    "playbackBuffer": {
      "minSeconds": 50,
      "maxSeconds": 300,
      "startupMs": 500,
      "rebufferMs": 2000,
      "backSeconds": 15,
      "targetMiB": 0
    },
    "playbackHdrMode": "Auto",
    "playbackAudioMode": "Original",
    "playbackDigitalGainDb": 0,
    "playerVolumeLimitPercent": 100,
    "androidMpvConfig": "",
    "lastPlaybackSpeed": 1,
    "leftVerticalGesture": "Brightness",
    "rightVerticalGesture": "Volume",
    "leftDoubleTap": "Seek",
    "rightDoubleTap": "Seek",
    "simplePlayerControls": false,
    "showPlayerSeekButtons": true,
    "progressThumbnailEnabled": false,
    "preferTodbPreview": false,
    "hiddenPlayerTools": [],
    "seekStepSeconds": 10,
    "rememberPlayerBrightness": true,
    "playerBrightness": null,
    "longPressPlaybackSpeed": 2,
    "playbackSourceFilter": {
      "resolution": "",
      "videoRange": "",
      "audioLanguage": "",
      "frameRate": "",
      "bitrate": "Any"
    },
    "defaultSubtitleLanguage": "zh",
    "defaultAudioLanguage": "auto",
    "versionPreferences": {
      "serverId": "",
      "keywords": "",
      "resolution": "auto",
      "dynamicRange": "auto",
      "videoCodec": "auto",
      "frameRate": "auto",
      "bitrate": "auto",
      "preferSpecialSubtitles": false
    },
    "showResourceTags": true,
    "playerEntranceAnimationEnabled": true,
    "playerEpisodeEntranceAnimationEnabled": false,
    "subtitleScale": 1,
    "subtitleVerticalOffset": 0,
    "subtitleDelayMs": 0,
    "audioDelayMs": 0,
    "subtitleStylePreset": "custom",
    "subtitleStyleMode": "Default",
    "subtitleStyleColor": "#FF000000",
    "subtitleStyleOpacity": 0.7,
    "subtitleOutlineSize": 2,
    "subtitleShadowOffset": 1,
    "subtitleTextColor": "#FFFFFFFF",
    "subtitleBackgroundColor": "#00000000",
    "subtitleEdgeColor": "#FF000000",
    "subtitleEdgeStyle": "outline",
    "subtitleFontFamily": "sans",
    "subtitleLineHeight": 1,
    "subtitleOverrideEmbedded": false,
    "secondarySubtitleSettings": {
      "scale": 0.45,
      "delayMs": 0,
      "verticalPosition": 100,
      "placement": "below-main",
      "followPrimary": true,
      "gap": 8,
      "textColor": "#FFFFFFFF",
      "backgroundColor": "#00000000",
      "edgeColor": "#FF000000",
      "fontFamily": "sans-serif",
      "outlineSize": 2,
      "shadowOffset": 2,
      "overrideEmbedded": false,
      "styleMode": null
    },
    "anime4kPreset": "off",
    "playerOsd": {
      "enabled": false,
      "showNetworkSpeed": true,
      "showProgress": false,
      "showTime": true,
      "showClock": true,
      "fontScale": 1,
      "showBattery": true
    },
    "segmentSkipMode": "Prompt",
    "introSkipMode": null,
    "outroSkipMode": null,
    "playbackSegmentSource": "auto",
    "manualPlaybackSegments": [],
    "syncedPlaybackSegments": {},
    "alwaysStartFromBeginning": false,
    "automaticPictureInPicture": false,
    "danmakuEnabled": false,
    "danmakuApiUrl": "",
    "danmakuSources": [],
    "danmakuShowScroll": true,
    "danmakuShowTop": true,
    "danmakuShowBottom": true,
    "danmakuShowColored": true,
    "danmakuMergeDuplicates": false,
    "danmakuOffsetMs": 0,
    "danmakuDensity": 20,
    "danmakuHeatmapEnabled": false,
    "danmakuMatchMemories": [],
    "danmakuOpacity": 0.82,
    "danmakuFontFamily": "sans",
    "danmakuTextColor": "#FFFFFFFF",
    "danmakuForceColor": false,
    "danmakuStyleMode": "Default",
    "danmakuStyleColor": "#FF000000",
    "danmakuStyleOpacity": 0.7,
    "danmakuOutlineSize": 2,
    "danmakuShadowOffset": 1,
    "danmakuLineHeight": 1,
    "danmakuFontScale": 1,
    "danmakuSpeed": 1,
    "danmakuArea": 0.5,
    "danmakuBlockedKeywords": [],
    "reduceMotion": false,
    "reduceTransparency": false,
    "disableGlassEffects": false,
    "hapticFeedback": true,
    "automaticServerFailover": false,
    "aggregateSearchEnabled": true,
    "aggregateContinueWatchingEnabled": true,
    "aggregateFavoritesEnabled": true,
    "aggregatePlaybackSourcesEnabled": true,
    "homeLibraryPreferences": [],
    "videoCacheLimitMiB": 512,
    "fullPlaybackCacheEnabled": false,
    "retainedPlaybackCacheLimitMiB": 512,
    "cacheRetentionDays": 30,
    "localFilenameMetadataEnabled": true,
    "localSidecarArtworkEnabled": true,
    "localSidecarSubtitlesEnabled": true,
    "playbackTrackMemories": [],
    "browsePreferences": [],
    "discoveryCollectionViews": {
      "tmdb-popular-movies": "poster"
    },
    "collectionTabOrder": [
      "Calendar",
      "Watchlist",
      "Favorites",
      "Playlists"
    ],
    "homeContinueMode": "continue",
    "homeContinueModeLocked": false,
    "collectionDefaultViews": {
      "Calendar": "tracking",
      "Watchlist": "continue",
      "Favorites": "media",
      "Playlists": "list"
    },
    "collectionStartupTab": "Favorites"
  },
  "collections": {
    "watchlist": [],
    "playlists": []
  },
  "playbackHistory": {
    "resumeRecords": [],
    "dismissals": [],
    "continueRecords": [],
    "homeRecords": []
  },
  "contentSources": [],
  "discoveryHomes": {
    "schemaVersion": 2,
    "activeId": "default",
    "pages": [
      {
        "id": "default",
        "name": "首页",
        "document": {
          "schemaVersion": 1,
          "sections": [
            {
              "id": "tmdb-popular-movies",
              "title": "热门电影",
              "enabled": true,
              "source": {
                "kind": "tmdb",
                "sourceId": "tmdb-popular-movies",
                "mediaType": "Movie",
                "parameters": {},
                "parameterTypes": {},
                "sourceTitle": "",
                "serverId": "",
                "localLibraryId": "",
                "moduleId": "",
                "functionName": "",
                "platform": null,
                "needsBinding": false,
                "sortBy": null,
                "sortDirection": null,
                "randomSeed": null,
                "extension": {}
              },
              "layout": "Poster",
              "order": 0,
              "pageSize": 24,
              "optionalUnit": null,
              "cardDisplay": {
                "showTitle": true,
                "showYear": true,
                "showRating": true,
                "showOverview": false,
                "titleLines": 1,
                "fitArtwork": false,
                "icon": "none"
              },
              "extension": {},
              "titleLocked": null,
              "detailMode": null,
              "smallCategoryRows": null,
              "categoryUnits": null,
              "leaderboardUnits": null,
              "localFolderUnits": null,
              "unsupportedLayout": null,
              "hideTitle": false
            },
            {
              "id": "tmdb-popular-series",
              "title": "热门剧集",
              "enabled": true,
              "source": {
                "kind": "tmdb",
                "sourceId": "tmdb-popular-series",
                "mediaType": "Series",
                "parameters": {},
                "parameterTypes": {},
                "sourceTitle": "",
                "serverId": "",
                "localLibraryId": "",
                "moduleId": "",
                "functionName": "",
                "platform": null,
                "needsBinding": false,
                "sortBy": null,
                "sortDirection": null,
                "randomSeed": null,
                "extension": {}
              },
              "layout": "Poster",
              "order": 1,
              "pageSize": 24,
              "optionalUnit": null,
              "cardDisplay": {
                "showTitle": true,
                "showYear": true,
                "showRating": true,
                "showOverview": false,
                "titleLines": 1,
                "fitArtwork": false,
                "icon": "none"
              },
              "extension": {},
              "titleLocked": null,
              "detailMode": null,
              "smallCategoryRows": null,
              "categoryUnits": null,
              "leaderboardUnits": null,
              "localFolderUnits": null,
              "unsupportedLayout": null,
              "hideTitle": false
            },
            {
              "id": "tmdb-top-rated-movies",
              "title": "高分电影",
              "enabled": true,
              "source": {
                "kind": "tmdb",
                "sourceId": "tmdb-top-rated-movies",
                "mediaType": "Movie",
                "parameters": {},
                "parameterTypes": {},
                "sourceTitle": "",
                "serverId": "",
                "localLibraryId": "",
                "moduleId": "",
                "functionName": "",
                "platform": null,
                "needsBinding": false,
                "sortBy": null,
                "sortDirection": null,
                "randomSeed": null,
                "extension": {}
              },
              "layout": "Ranked",
              "order": 2,
              "pageSize": 24,
              "optionalUnit": null,
              "cardDisplay": {
                "showTitle": true,
                "showYear": true,
                "showRating": true,
                "showOverview": false,
                "titleLines": 1,
                "fitArtwork": false,
                "icon": "none"
              },
              "extension": {},
              "titleLocked": null,
              "detailMode": null,
              "smallCategoryRows": null,
              "categoryUnits": null,
              "leaderboardUnits": null,
              "localFolderUnits": null,
              "unsupportedLayout": null,
              "hideTitle": false
            },
            {
              "id": "tmdb-on-the-air",
              "title": "正在热播",
              "enabled": true,
              "source": {
                "kind": "tmdb",
                "sourceId": "tmdb-on-the-air",
                "mediaType": "Series",
                "parameters": {},
                "parameterTypes": {},
                "sourceTitle": "",
                "serverId": "",
                "localLibraryId": "",
                "moduleId": "",
                "functionName": "",
                "platform": null,
                "needsBinding": false,
                "sortBy": null,
                "sortDirection": null,
                "randomSeed": null,
                "extension": {}
              },
              "layout": "Landscape",
              "order": 3,
              "pageSize": 24,
              "optionalUnit": null,
              "cardDisplay": {
                "showTitle": true,
                "showYear": true,
                "showRating": true,
                "showOverview": false,
                "titleLines": 1,
                "fitArtwork": false,
                "icon": "none"
              },
              "extension": {},
              "titleLocked": null,
              "detailMode": null,
              "smallCategoryRows": null,
              "categoryUnits": null,
              "leaderboardUnits": null,
              "localFolderUnits": null,
              "unsupportedLayout": null,
              "hideTitle": false
            },
            {
              "id": "tmdb-animation",
              "title": "动画新番",
              "enabled": true,
              "source": {
                "kind": "tmdb",
                "sourceId": "tmdb-animation",
                "mediaType": "Series",
                "parameters": {
                  "genre": "16",
                  "language": "ja"
                },
                "parameterTypes": {},
                "sourceTitle": "",
                "serverId": "",
                "localLibraryId": "",
                "moduleId": "",
                "functionName": "",
                "platform": null,
                "needsBinding": false,
                "sortBy": null,
                "sortDirection": null,
                "randomSeed": null,
                "extension": {}
              },
              "layout": "Poster",
              "order": 4,
              "pageSize": 24,
              "optionalUnit": null,
              "cardDisplay": {
                "showTitle": true,
                "showYear": true,
                "showRating": true,
                "showOverview": false,
                "titleLines": 1,
                "fitArtwork": false,
                "icon": "none"
              },
              "extension": {},
              "titleLocked": null,
              "detailMode": null,
              "smallCategoryRows": null,
              "categoryUnits": null,
              "leaderboardUnits": null,
              "localFolderUnits": null,
              "unsupportedLayout": null,
              "hideTitle": false
            },
            {
              "id": "trakt-calendar",
              "title": "追剧日历",
              "enabled": true,
              "source": {
                "kind": "trakt",
                "sourceId": "trakt-calendar",
                "mediaType": "Episode",
                "parameters": {},
                "parameterTypes": {},
                "sourceTitle": "",
                "serverId": "",
                "localLibraryId": "",
                "moduleId": "",
                "functionName": "",
                "platform": null,
                "needsBinding": false,
                "sortBy": null,
                "sortDirection": null,
                "randomSeed": null,
                "extension": {}
              },
              "layout": "Calendar",
              "order": 5,
              "pageSize": 24,
              "optionalUnit": null,
              "cardDisplay": {
                "showTitle": true,
                "showYear": true,
                "showRating": true,
                "showOverview": false,
                "titleLines": 1,
                "fitArtwork": false,
                "icon": "none"
              },
              "extension": {},
              "titleLocked": null,
              "detailMode": null,
              "smallCategoryRows": null,
              "categoryUnits": null,
              "leaderboardUnits": null,
              "localFolderUnits": null,
              "unsupportedLayout": null,
              "hideTitle": false
            }
          ],
          "extension": {}
        },
        "iconUrl": "",
        "carousel": null,
        "disablePagination": true,
        "independentHistory": false,
        "extension": {},
        "hidden": false,
        "continueSource": null
      }
    ],
    "primaryId": "default",
    "enabled": true
  },
  "modules": [],
  "nexusState": {
    "imports": [],
    "bindings": [],
    "homePlaylists": [],
    "extension": {}
  }
};
  function wwMobileSkeleton() {
    return JSON.parse(JSON.stringify(WW_MOBILE_TEMPLATE));
  }

  function wwShortId() { return hexId(6) + '-' + hexId(16); }
  function validMobileId(id) { return typeof id === 'string' && /^[A-Za-z0-9._:-]{1,96}$/.test(id); }
  function mobileNativeId(preferred, used) {
    var id = validMobileId(preferred) && !used.has(preferred) ? preferred : wwShortId();
    while (used.has(id)) id = wwShortId();
    used.add(id); return id;
  }
  function mobileProfileRaw(s) {
    var raw = baseRaw(s, 'wwmobile'), out = {};
    // These are the 22 PortableServerProfile fields in Android 0.4.9 (593).
    // Unknown legacy fields, including credentials maps, are not portable.
    ['serverId', 'displayName', 'lines', 'activeLineId', 'remoteServerId', 'remark', 'serverType',
      'aggregateEnabled', 'aggregateSearchEnabled', 'aggregateContinueWatchingEnabled', 'aggregateFavoritesEnabled',
      'aggregatePlaybackSourcesEnabled', 'preloadNextEpisodeEnabled', 'strmEnabled', 'keepAliveDays',
      'keepAliveStartedAtMs', 'homePresentation', 'requiresAuthentication', 'useSystemProxy',
      'cropIconToCircle', 'userId', 'userName'].forEach(function (k) { if (raw[k] !== undefined) out[k] = raw[k]; });
    return out;
  }
  function mobileSensitiveQuery(url) {
    var found = false;
    // Conservative local preflight, not an assertion that every native version
    // uses this exact list. URLSearchParams decodes percent-encoded key names.
    url.searchParams.forEach(function (_, key) {
      key = key.replace(/[-_]/g, '').toLowerCase();
      if (/(?:token|password|passwd|credential|secret)/.test(key) ||
          /^(?:pwd|auth|authentication|authorization|apikey|username|userid|account)$/.test(key)) found = true;
    });
    return found;
  }

  // Defaults for optional mobile server settings. Required fields are assigned
  // explicitly by buildWwmobile; new profiles still require authentication.
  function mobileServerDefaults() {
    return {
      aggregateEnabled: true,
      aggregateSearchEnabled: true,
      aggregateContinueWatchingEnabled: true,
      aggregateFavoritesEnabled: true,
      aggregatePlaybackSourcesEnabled: true,
      preloadNextEpisodeEnabled: true,
      strmEnabled: false,
      keepAliveDays: 0,
      keepAliveStartedAtMs: 0,
      homePresentation: null,
      cropIconToCircle: false
    };
  }

  function buildWwmobile(servers, options) {
    var doc = documentFor(options, 'wwmobile', wwMobileSkeleton()), ids = new Set();
    doc.servers = servers.map(function (s) {
      var o = Object.assign(mobileServerDefaults(), mobileProfileRaw(s));
      // Android 0.4.9 rejects credentialsIncluded=true; false does not enable
      // hidden password fields. Never encode credentials into routes instead.
      var live = s.lines.filter(function (l) { return l.url; }), lineIds = new Set();
      var lines = live.map(function (l) {
        var r = rawLine(s, l, 'wwmobile');
        return {
          lineId: mobileNativeId(r.lineId, lineIds), serverUrl: l.url,
          name: l.name, source: typeof r.source === 'string' ? r.source : ''
        };
      });
      var idx = Math.max(0, live.findIndex(function (l) { return l.id === s.activeLineId; }));
      Object.assign(o, {
        serverId: mobileNativeId(o.serverId, ids), displayName: s.name,
        lines: lines, activeLineId: lines[idx].lineId, remoteServerId: o.remoteServerId || hexId(32),
        remark: s.remark, serverType: s.type, requiresAuthentication: true, userId: s.userId, userName: s.username
      });
      return o;
    });
    doc.schemaVersion = 2; doc.exportedAtMs = nowMs(); doc.credentialsIncluded = false;
    return doc;
  }

  async function buildCapyplayer(servers, options) {
    var c = sourceContext(options, 'capyplayer'), ids = new Set();
    var rows = servers.map(function (s) {
      var o = baseRaw(s, 'capyplayer'), u = splitUrl(s.url);
      var routes = s.lines.filter(function (l) { return l.url && l.id !== s.primaryLineId; }).map(function (l) {
        var p = splitUrl(l.url), r = rawLine(s, l, 'capyplayer');
        return Object.assign(r, {
          name: l.name || '线路', host: p.host, port: p.port, https: !!p.https, path: p.path,
          isUse: l.id === s.activeLineId, isProxy: r.isProxy === undefined ? false : r.isProxy
        });
      });
      var hadToken = Object.prototype.hasOwnProperty.call(o, 'token');
      Object.assign(o, {
        id: uniqueNativeId(o.id, uuid(), ids), name: s.name, type: s.type, resource_type: 'media_server',
        created_at: o.created_at || nowMs(), last_accessed: o.last_accessed || null,
        host: u.host, port: u.port, path: u.path, username: s.username, password: s.password,
        token: s.accessToken, https: u.https, user_id: s.userId, backup_routes: JSON.stringify(routes),
        server_logo_image_url: s.icon || null, sort_order: s.sortOrder, remark: s.remark || null,
        is_hidden: o.is_hidden || 0, show_carousel: o.show_carousel === undefined ? 1 : o.show_carousel,
        show_resource_aggregation: o.show_resource_aggregation || 0, disable_aggregation: o.disable_aggregation || 0,
        use_strm_direct_link: o.use_strm_direct_link || 0, section_order: o.section_order || null,
        section_configs: o.section_configs || null, carousel_excluded_genres: o.carousel_excluded_genres || null
      });
      // v22 native rows may not have a token column. Do not introduce an
      // unsupported database column when retaining that source schema.
      if (c && Number(c.document.database_version) === 22 && !hadToken) delete o.token;
      return o;
    });
    var inner;
    if (options.mode === 'full' && c && c.inner) inner = clone(c.inner);
    else {
      inner = { tables: { media_server_resources: [], media_item_settings: [], icon_packs: [], icon_items: [] }, preferences: {} };
      if (c && c.inner && isRecord(c.inner.tables)) Object.keys(c.inner.tables).forEach(function (k) {
        if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype' && Array.isArray(c.inner.tables[k])) inner.tables[k] = [];
      });
    }
    inner.tables = inner.tables || {}; inner.tables.media_server_resources = rows;
    checkAbort(options);
    var iv = randomBytes(16), key = await pbkdf2(CAPY_PASSWORD, CAPY_SALT, 10000, 32);
    var ct = await gcmEncrypt(key, iv, utf8(JSON.stringify(inner)));
    var envelope = options.mode === 'full' && c ? clone(c.document) : {
      version: '1.0', app_version: '1.0.0.0', database_version: 5, device_name: 'Emby Bridge'
    };
    if (c && options.mode !== 'full') ['version', 'app_version', 'database_version'].forEach(function (k) {
      if (c.document[k] !== undefined) envelope[k] = c.document[k];
    });
    envelope.created_at = nowMs(); envelope.encrypted_data = bytesToB64(iv) + ':' + bytesToB64(ct);
    return envelope;
  }

  async function buildHills(servers, options) {
    var data = servers.map(function (s, i) {
      var o = baseRaw(s, 'hills'), auth = {}, ids = new Set();
      delete o.displayName; delete o.displaayName;
      if (o.authenticateJson) auth = copy(jsonDocument(o.authenticateJson, 'authenticateJson'));
      auth.User = Object.assign(copy(auth.User), { Name: s.username, Id: s.userId });
      if (auth.User.PrimaryImageTag === undefined) auth.User.PrimaryImageTag = null;
      auth.AccessToken = s.accessToken;
      var live = s.lines.filter(function (l) { return l.url && l.id !== s.primaryLineId; });
      var routes = live.map(function (l) {
        var r = rawLine(s, l, 'hills');
        return Object.assign(r, { id: uniqueNativeId(r.id, l.id, ids), url: l.url, name: l.name || '线路' });
      });
      var active = live.findIndex(function (l) { return l.id === s.activeLineId; });
      var primary = s.lines.find(function (l) { return l.id === s.primaryLineId; });
      Object.assign(o, {
        displyName: s.name, serverName: s.serverName || s.name, serverUrl: s.url,
        username: s.username, password: s.password, authenticateJson: JSON.stringify(auth), orderIndex: s.sortOrder,
        hideUsername: o.hideUsername || false, iconUrl: s.icon, hideLibraryList: o.hideLibraryList || [], libraryOrderIndexList: o.libraryOrderIndexList || [],
        avatarTag: o.avatarTag || '', viewSortList: o.viewSortList || [], viewFilterList: o.viewFilterList || [],
        selectedServerRoutingId: active >= 0 ? routes[active].id : '', serverRoutingList: routes,
        hideFederated: o.hideFederated || false, isJellyfin: s.type === 'jellyfin', lastWatchedDate: o.lastWatchedDate || null,
        mainRoutingName: primary ? primary.name : (o.mainRoutingName || ''),
        isActive: options.mode === 'full' && typeof o.isActive === 'boolean' ? o.isActive : i === 0, isPrivate: o.isPrivate || false,
        remark: s.remark, viewCoverTypeList: o.viewCoverTypeList || [], strmDirectLinkPlay: o.strmDirectLinkPlay || false,
        enableFailover: o.enableFailover || false
      });
      return o;
    });
    var c = sourceContext(options, 'hills');
    var inner = options.mode === 'full' && c && c.inner ? clone(c.inner) : {};
    delete inner.servers; inner.data = data;
    // Preserve the existing Hills trailing-brace / IV compatibility contract.
    var innerText = JSON.stringify(inner).replace(/\}$/, '');
    var cipher = await cbcEncrypt(HILLS_KEY, HILLS_IV, utf8(innerText));
    var doc = documentFor(options, 'hills', { settings: null, mpvConf: null, iconPacks: null, customIcons: null });
    doc.version = 2; doc.data = bytesToB64(cipher); return doc;
  }

  async function buildAiplayer(servers, options) {
    var akey = await sha256(utf8('AIPlayer')), ids = new Set();
    var list = servers.map(function (s) {
      var o = baseRaw(s, 'aiplayer');
      var lines = s.lines.filter(function (l) { return l.url; }).map(function (l) {
        return Object.assign(rawLine(s, l, 'aiplayer'), { name: l.name || '线路', url: l.url, isMain: l.id === s.activeLineId });
      });
      Object.assign(o, {
        id: uniqueNativeId(o.id, s.id, ids), provider: s.type, name: s.name, username: s.username,
        lastKnownUserId: s.userId, serverName: s.serverName || null, encryptedToken: s.accessToken,
        rememberPassword: o.rememberPassword === undefined ? true : o.rememberPassword, encryptedPassword: s.password,
        lines: lines, preferredLineUrl: lineUrl(s), iconUrl: s.icon || null, sortOrder: s.sortOrder, useProxy: o.useProxy || false
      });
      return o;
    });
    var c = sourceContext(options, 'aiplayer');
    var inner = options.mode === 'full' && c && c.inner ? clone(c.inner) : {};
    inner.version = 1; inner.exportedAt = dotNetNow(); inner.servers = list;
    var cipher = await cbcEncrypt(akey, AI_IV, utf8(JSON.stringify(inner)));
    var doc = documentFor(options, 'aiplayer', {}); doc.data = bytesToB64(cipher); return doc;
  }

  function buildBridge(servers) {
    return {
      format: 'emby-bridge', version: 2, exportedAt: new Date().toISOString(),
      servers: servers.map(function (s) {
        var o = {};
        ['id', 'name', 'serverName', 'type', 'url', 'username', 'password', 'userId', 'accessToken', 'icon', 'activeLine', 'activeLineId', 'primaryLineId', 'remark', 'sortOrder'].forEach(function (k) { o[k] = s[k]; });
        o.lines = s.lines.map(function (l) { return { id: l.id, name: l.name, url: l.url, active: l.active, raw: formatRaw(l.raw) }; });
        // Per-server extensions are portable, but whole-document contexts and
        // selection/provenance state never travel in a migration file.
        o.raw = formatRaw(s.raw); return o;
      })
    };
  }

  function inspectExport(servers, format, options) {
    options = options || {};
    var mode = options.mode || 'servers', errors = [], warnings = [], list = [];
    if (IMPORT_FORMATS.indexOf(format) < 0) errors.push('未知导出格式');
    if (mode !== 'servers' && mode !== 'full') errors.push('导出范围必须为 servers 或 full');
    try {
      list = normalize(servers || []);
      if (options.selectedOnly) list = list.filter(function (s) { return s._selected !== false; });
    } catch (e) { errors.push(e.message); }
    if (!list.length) errors.push('请至少选择一台服务器');
    var mobileIds = new Set();
    list.forEach(function (s, i) {
      var label = '第 ' + (i + 1) + ' 台服务器';
      if (s.type !== 'emby' && s.type !== 'jellyfin') errors.push(label + '类型不支持（仅 Emby / Jellyfin）');
      if (!s.url) errors.push(label + '缺少主地址');
      if (format === 'wwmobile') {
        if (!s.name.trim()) errors.push(label + '缺少显示名称，WWPlayer Android 便携导入不接受空名称');
        var raw = s.raw.wwmobile, changedId = false, routeIds = new Set();
        if (raw) {
          changedId = !validMobileId(raw.serverId) || mobileIds.has(raw.serverId);
          if (validMobileId(raw.serverId)) mobileIds.add(raw.serverId);
        }
        s.lines.filter(function (l) { return l.url; }).forEach(function (l) {
          var route = l.raw.wwmobile;
          if (route) {
            if (!validMobileId(route.lineId) || routeIds.has(route.lineId)) changedId = true;
            if (validMobileId(route.lineId)) routeIds.add(route.lineId);
          }
        });
        if (changedId) {
          if (mode === 'full') errors.push(label + '的手机端原生标识无效或重复，完整备份不能安全更换引用；请改用仅服务器迁移');
          else warnings.push('部分手机端原生标识无效或重复，将生成新的兼容标识；仅服务器模式不携带旧历史引用。');
        }
      }
      var urls = [s.url].concat(s.lines.map(function (l) { return l.url; })).filter(Boolean);
      urls.forEach(function (url) {
        try {
          var p = new URL(url);
          if ((p.protocol !== 'http:' && p.protocol !== 'https:') || !p.hostname) throw new Error('unsupported');
          if (format === 'capyplayer') {
            if (/[?#]/.test(url) || /^(?:https?):\/\/[^/]*@/i.test(url)) {
              errors.push(label + '的 URL 含查询参数、片段或内嵌凭据，CapyPlayer 无法无损表达；请改用其它格式或手动调整地址');
            } else {
              try {
                var parts = splitUrl(url);
                if (joinUrl(parts.https, parts.host, parts.port, parts.path) !== url) warnings.push('CapyPlayer 将规范化协议 / 主机写法及默认端口；路径保持原值，请确认地址文本差异。');
              } catch (e) { errors.push(label + '：' + e.message); }
            }
          }
          if (format === 'wwmobile') {
            if (!/^https?:\/\//i.test(url) || /[\\\u0000-\u0020]/.test(url)) errors.push(label + '的手机端线路需要完整且不含空白 / 反斜杠的 HTTP / HTTPS 地址');
            if (/#/.test(url) || /^(?:https?):\/\/[^/]*@/i.test(url) || mobileSensitiveQuery(p)) {
              errors.push(label + '的线路含 URL 内嵌账号、片段或疑似认证查询参数，可能触发手机端敏感数据校验；请人工调整或改用其它格式，不会自动删改');
            }
          }
        } catch (e) { errors.push(label + '含无效的 HTTP / HTTPS 地址'); }
      });
    });
    var c = sourceContext(options, format);
    if (mode === 'full') {
      if (FULL_FORMATS.indexOf(format) < 0) errors.push('此格式仅支持服务器迁移，不支持完整原生备份');
      if (!c || !Array.isArray(c.serverIds)) errors.push('完整备份需要提供同格式的单一来源文档');
      else {
        var selected = new Set(list.map(function (s) { return s.id; })), expected = new Set(c.serverIds);
        if (selected.size !== expected.size || list.length !== c.serverIds.length || !c.serverIds.every(function (id) { return selected.has(id); })) {
          errors.push('完整备份必须保留来源中的全部服务器，不允许子集、删除、去重或新增；请改用仅服务器迁移');
        }
        if (list.some(function (s) { return s._sources.length !== 1 || s._sources[0] !== c.id; })) errors.push('完整备份不能混合多个来源；请选择一份原生备份的全部服务器');
        if (format === 'hills' && c.document.version === 3) errors.push('Hills v3 的其它加密段尚不能安全重建；仅支持服务器迁移为 v2');
        if (['wwplayer', 'capyplayer', 'hills', 'aiplayer'].indexOf(format) >= 0 && !isRecord(c.inner)) errors.push('来源缺少完整的解密文档上下文');
      }
      warnings.push('完整原生备份会包含来源的应用设置、历史或其它附属数据，请确认需要一并导出。');
    } else warnings.push('仅迁移所选服务器；应用级设置、历史记录和其它附表不会随文件带出。');
    if (format === 'wwmobile') {
      warnings.push('已核对的 WWPlayer Android 0.4.9 便携格式仅迁移用户名 / User ID，不支持密码 / Token；导入后需要重新认证。credentialsIncluded=true 不是启用开关，会被原生导入器拒绝。');
      if (mode === 'full' && c && (c.document.preferences || {}).ignoreSslCertificateValidation === true) warnings.push('来源关闭了 TLS 证书校验；完整备份将尊重该设置，存在连接安全风险。');
    } else if (list.some(function (s) { return s.password || s.accessToken; })) warnings.push('备份含密码、令牌或可逆凭据，请勿公开分享；既有格式加密不等于安全保管。');
    if (format === 'afusekt' && list.some(function (s) { return s.userId || s.accessToken; })) warnings.push('AfuseKt 不保存 User ID / Access Token，这两项将丢失。');
    if (format === 'wwplayer' && list.some(function (s) { return s.type === 'jellyfin'; })) warnings.push('WWPlayer 电脑端 V1 无服务器类型字段，读回会标记为 Emby。');
    if (format === 'linplayer' && list.some(function (s) { return ((s.raw.linplayer || {}).linplayer || {}).allow_insecure_tls === true; })) warnings.push('部分 LinPlayer 原生服务器允许不安全 TLS；该服务器开关会保留，请确认风险。');
    if (format === 'hills' && mode !== 'full') warnings.push('Hills 输出为 v2，不包含 v3 的额外设置 / 图标加密段。');
    if (format === 'capyplayer') {
      if (!c && list.some(function (s) { return s.raw.capyplayer; })) warnings.push('未提供 CapyPlayer 来源版本，将使用 v5 兼容骨架；建议携带 parse() 返回的 context。');
      if (c && Number(c.document.database_version) === 22 && list.some(function (s) { return s.accessToken && !Object.prototype.hasOwnProperty.call(s.raw.capyplayer || {}, 'token'); })) warnings.push('来源 CapyPlayer v22 不含 token 列，访问令牌不会写入该列。');
      if (c && c.document.database_version != null && [5, 22].indexOf(Number(c.document.database_version)) < 0) warnings.push('此 CapyPlayer 数据库版本未在现有样本中验证；保留其版本号，不自动降级。');
    }
    if (format === 'csv') {
      warnings.push('CSV 不保留播放器原生扩展字段；线路列使用 JSON，凭据和多行内容保持原值。');
      if (list.some(function (s) { return ['name', 'url', 'username', 'password', 'userId', 'accessToken', 'icon', 'serverName', 'remark'].some(function (k) { return /^\s*[=+\-@]/.test(s[k]); }); })) warnings.push('部分单元格可能被表格软件识别为公式。导入表格时请将列设为文本；本工具不会加前缀改写密码。');
    }
    return { ok: errors.length === 0, errors: Array.from(new Set(errors)).slice(0, 12), warnings: Array.from(new Set(warnings)), selectedCount: list.length, mode: mode };
  }
  async function build(servers, format, options) {
    options = Object.assign({ mode: 'servers' }, options || {}); checkAbort(options);
    var inspection = inspectExport(servers, format, options);
    if (!inspection.ok) throw new Error(inspection.errors.join('；'));
    var list = normalize(servers || []);
    if (options.selectedOnly) list = list.filter(function (s) { return s._selected !== false; });
    var obj;
    switch (format) {
      case 'afusekt': obj = buildAfusekt(list); break;
      case 'yamby': obj = await buildYamby(list, options); break;
      case 'linplayer': obj = await buildLinplayer(list, options); break;
      case 'wwplayer': obj = buildWwplayer(list, options); break;
      case 'wwmobile': obj = buildWwmobile(list, options); break;
      case 'capyplayer': obj = await buildCapyplayer(list, options); break;
      case 'hills': obj = await buildHills(list, options); break;
      case 'aiplayer': obj = await buildAiplayer(list, options); break;
      case 'bridge': obj = buildBridge(list); break;
      case 'csv': return { text: toCsv(list), filename: 'emby-servers-' + stamp() + '.csv', mime: 'text/csv;charset=utf-8', warnings: inspection.warnings, mode: options.mode };
    }
    checkAbort(options);
    var pretty = format === 'wwplayer' || format === 'bridge' ? JSON.stringify(obj, null, 2) : JSON.stringify(obj);
    return { text: pretty, filename: 'emby-bridge-' + format + '-' + stamp() + '.' + META[format].ext,
      mime: 'application/json;charset=utf-8', warnings: inspection.warnings, mode: options.mode };
  }

  /* ---------------------------------- CSV --------------------------------- */

  function csvCell(v) {
    v = v == null ? '' : String(v);
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function toCsv(servers) {
    var head = ['name', 'type', 'url', 'username', 'password', 'userId', 'accessToken', 'icon', 'lines', 'serverName', 'remark', 'activeLine'];
    var rows = [head.join(',')];
    normalize(servers || []).forEach(function (s) {
      var values = copy(s);
      values.lines = JSON.stringify(s.lines.map(function (l) { return { id: l.id, name: l.name, url: l.url, active: l.active }; }));
      rows.push(head.map(function (k) { return csvCell(values[k]); }).join(','));
    });
    return '\uFEFF' + rows.join('\r\n');
  }
  function delimitedRows(text, separator, trimOuter, label) {
    var rows = [], row = [], cur = '', phase = 'start', quoted = false, line = 1;
    function cell() { row.push(trimOuter && !quoted ? cur.trim() : cur); cur = ''; phase = 'start'; quoted = false; }
    function endRow() {
      cell();
      if (!(row.length === 1 && !row[0].trim())) rows.push(row);
      row = [];
      if (rows.length > MAX_SERVERS + 1) throw new Error('记录数量超过 ' + MAX_SERVERS + ' 项');
    }
    function fail(msg) { throw new Error(label + '第 ' + line + ' 行：' + msg); }
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (phase === 'quoted') {
        if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') phase = 'after';
        else { cur += ch; if (ch === '\n') line++; }
        continue;
      }
      if (ch === separator) { cell(); continue; }
      if (ch === '\n' || ch === '\r') { endRow(); if (ch === '\r' && text[i + 1] === '\n') i++; line++; continue; }
      if (phase === 'after') {
        if (ch === ' ' || ch === '\t') continue;
        fail('闭合引号后只能有分隔符或换行');
      }
      if (ch === '"') {
        if (phase !== 'start') fail('字段内的双引号必须整体引用，并用两个双引号转义');
        quoted = true; phase = 'quoted'; continue;
      }
      if (trimOuter && phase === 'start' && (ch === ' ' || ch === '\t')) continue;
      cur += ch; phase = 'plain';
    }
    if (phase === 'quoted') fail('引号未闭合；多行字段请使用完整的 CSV 引用');
    if (cur || row.length || phase === 'after') endRow();
    return rows;
  }
  function csvLines(value) {
    if (!value) return [];
    if (/^[\s]*[\[{]/.test(value)) {
      return records(jsonDocument(value, 'CSV 线路列'), 'CSV 线路列', MAX_LINES).map(function (l) {
        return emptyLine({ id: l.id, name: l.name, url: l.url, active: l.active });
      });
    }
    // Read the old syntax for compatibility. Ambiguous separators are rejected
    // rather than silently truncating credentials or route URLs.
    return value.split('|').filter(Boolean).map(function (part) {
      var pos = part.indexOf('='), name = pos > 0 ? part.slice(0, pos) : '线路', url = pos > 0 ? part.slice(pos + 1) : part;
      if (!/^https?:\/\//i.test(url)) throw new Error('CSV 旧线路列存在分隔符歧义，请改用 JSON 数组');
      return emptyLine({ name: name, url: url });
    });
  }
  function parseCsv(text) {
    text = String(text).replace(/^\uFEFF/, '');
    if (utf8(text).length > MAX_IMPORT_BYTES) throw new Error('CSV 超过 20 MiB 导入上限');
    var rows = delimitedRows(text, ',', false, 'CSV');
    if (!rows.length) return [];
    var map = CSV_FIELDS;
    var head = rows[0].map(function (h) { return Object.prototype.hasOwnProperty.call(map, h.trim().toLowerCase()) ? map[h.trim().toLowerCase()] : null; });
    if (!head.some(Boolean)) throw new Error('CSV 缺少可识别的表头（例如 name,url,username,password）');
    if (new Set(head.filter(Boolean)).size !== head.filter(Boolean).length) throw new Error('CSV 表头含重复字段');
    var servers = rows.slice(1).map(function (cells, index) {
      if (cells.length !== head.length) throw new Error('CSV 第 ' + (index + 2) + ' 条记录的列数与表头不一致；含逗号或换行的字段请用双引号包围');
      var s = {};
      cells.forEach(function (value, i) {
        var key = head[i]; if (!key) return;
        if (key === 'lines') s.lines = csvLines(value);
        else if (key === 'activeLine') {
          if (value && !/^\d+$/.test(value)) throw new Error('CSV activeLine 必须是非负整数');
          if (value) s.activeLine = Number(value);
        } else s[key] = value;
      });
      return emptyServer(s);
    }).filter(function (s) { return s.url || s.name || s.username; });
    return normalize(servers);
  }
  function quickSeparator(line) {
    var quoted = false, seen = new Set();
    for (var i = 0; i < line.length; i++) {
      if (line[i] === '"') { if (quoted && line[i + 1] === '"') i++; else quoted = !quoted; }
      else if (!quoted && '|,;\t'.indexOf(line[i]) >= 0) seen.add(line[i]);
    }
    return ['|', '\t', ',', ';'].find(function (s) { return seen.has(s); }) || '|';
  }
  function parseQuickText(text) {
    text = String(text || '').replace(/^\uFEFF/, '');
    if (utf8(text).length > MAX_IMPORT_BYTES) throw new Error('文本超过 20 MiB 导入上限');
    var out = [];
    text.split(/\r\n|\n|\r/).forEach(function (line, index) {
      line = line.trim(); if (!line || line.charAt(0) === '#') return;
      var parts;
      if (/^https?:\/\/\S+$/i.test(line)) parts = [line];
      else parts = (delimitedRows(line, quickSeparator(line), true, '文本') || [])[0] || [];
      if (!parts.length || parts.length > 4) throw new Error('文本第 ' + (index + 1) + ' 行字段数不正确；含分隔符的密码或地址请用双引号包围');
      var url = parts.length === 1 ? parts[0] : parts[1];
      try { var p = new URL(url); if (p.protocol !== 'http:' && p.protocol !== 'https:') throw new Error('unsupported'); }
      catch (e) { throw new Error('文本第 ' + (index + 1) + ' 行需要 HTTP / HTTPS 地址；格式为 名称 | 地址 | 用户名 | 密码'); }
      out.push(emptyServer({ url: url, name: parts.length === 1 ? '' : parts[0], username: parts[2] || '', password: parts[3] || '', lines: [{ name: '主线路', url: url, active: true }] }));
      if (out.length > MAX_SERVERS) throw new Error('服务器数量超过 ' + MAX_SERVERS + ' 项');
    });
    return normalize(out);
  }

  return {
    META: META, FORMATS: FORMATS, IMPORT_FORMATS: IMPORT_FORMATS, FULL_FORMATS: FULL_FORMATS,
    MAX_IMPORT_BYTES: MAX_IMPORT_BYTES, MAX_SERVERS: MAX_SERVERS,
    detect: detect, parse: parse, build: build, inspectExport: inspectExport,
    normalize: normalize, dedupe: dedupe, mergeServerLists: mergeServerLists, emptyServer: emptyServer,
    setPrimaryUrl: setPrimaryUrl, setLineUrl: setLineUrl, setActiveLine: setActiveLine,
    toCsv: toCsv, parseCsv: parseCsv, parseQuickText: parseQuickText,
    _internal: { cbcEncrypt: cbcEncrypt, cbcDecrypt: cbcDecrypt, gcmEncrypt: gcmEncrypt, gcmDecrypt: gcmDecrypt, pbkdf2: pbkdf2, sha256: sha256, bytesToB64: bytesToB64, b64ToBytes: b64ToBytes }
  };
});

