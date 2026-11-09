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
    wwmobile: { label: 'WWPlayer 手机端', ext: 'json', note: 'schemaVersion 2 完整备份（明文）' },
    capyplayer: { label: 'CapyPlayer', ext: 'json', note: 'PBKDF2 + AES-256-GCM' },
    hills: { label: 'Hills', ext: 'json', note: 'AES-256-CBC' },
    aiplayer: { label: 'AI Player', ext: 'json', note: 'V1 加密配置' },
    bridge: { label: '通用中间格式', ext: 'json', note: '明文，可跨设备长期保存 / 手工编辑' },
    csv: { label: 'CSV 表格', ext: 'csv', note: '明文，便于批量编辑（不含全部字段）' }
  };
  var FORMATS = ['afusekt', 'yamby', 'linplayer', 'wwplayer', 'wwmobile', 'capyplayer', 'hills', 'aiplayer'];

  /* ---------------------------- unified model ----------------------------- */

  function emptyServer(o) {
    o = o || {};
    return {
      id: o.id || hexId(32),
      name: o.name || '',
      serverName: o.serverName || '',
      type: o.type || 'emby',
      url: o.url || '',
      username: o.username || '',
      password: o.password || '',
      userId: o.userId || '',
      accessToken: o.accessToken || '',
      icon: o.icon || '',
      lines: Array.isArray(o.lines) ? o.lines.map(function (l) {
        l = l && typeof l === 'object' ? l : {};
        return { name: l.name || '', url: l.url || '', active: !!l.active };
      }) : [],
      activeLine: typeof o.activeLine === 'number' ? o.activeLine : 0,
      remark: o.remark || '',
      sortOrder: typeof o.sortOrder === 'number' ? o.sortOrder : 0,
      _selected: o._selected,
      _open: o._open,
      raw: o.raw || {}
    };
  }
  function normalize(servers) {
    return (servers || []).map(function (s, i) {
      var x = emptyServer(s);
      x.url = String(x.url || '').trim().replace(/\/+$/, '');
      if (x.sortOrder === 0) x.sortOrder = i;
      // Always keep the primary address as the first line, so round-trips
      // through LinPlayer / WWPlayer / Hills do not lose it.
      if (x.url) {
        var has = x.lines.some(function (l) { return l.url && l.url.replace(/\/+$/, '') === x.url; });
        if (!has) x.lines.unshift({ name: '默认', url: x.url, active: true });
      }
      if (!x.lines.some(function (l) { return l.active; }) && x.lines.length) x.lines[0].active = true;
      x.activeLine = Math.max(0, x.lines.findIndex(function (l) { return l.active; }));
      return x;
    });
  }
  function activeUrl(s) { return (s.lines[s.activeLine] && s.lines[s.activeLine].url) || s.url; }
  function serverIdentity(s) {
    var address = String(s.url || '').trim();
    // Only scheme and host are case-insensitive. Preserve path/query/user case.
    address = address.replace(/^(https?):\/\/([^/\?#]+)/i, function (_, scheme, authority) {
      return scheme.toLowerCase() + '://' + authority.toLowerCase();
    });
    return JSON.stringify([s.type || 'emby', address, String(s.username || '')]);
  }
  function credentialsCompatible(a, b) {
    return ['password', 'userId', 'accessToken'].every(function (k) {
      return !a[k] || !b[k] || a[k] === b[k];
    });
  }
  function mergeServerLists(existing, incoming) {
    var out = existing.slice(), added = 0, merged = 0;
    incoming.forEach(function (s) {
      var identity = serverIdentity(s);
      var candidates = out.filter(function (a) {
        return serverIdentity(a) === identity && credentialsCompatible(a, s);
      });
      // Ambiguous matches and conflicting credentials stay as separate entries.
      if (candidates.length !== 1) { out.push(s); added++; return; }
      var a = candidates[0];
      ['name', 'serverName', 'username', 'password', 'userId', 'accessToken', 'icon', 'remark'].forEach(function (k) {
        if (!a[k] && s[k]) a[k] = s[k];
      });
      a.lines = a.lines || [];
      (s.lines || []).forEach(function (l) {
        if (!a.lines.some(function (old) { return old.url === l.url; })) a.lines.push(Object.assign({}, l, { active: false }));
      });
      a.raw = a.raw || {};
      Object.keys(s.raw || {}).forEach(function (k) { if (!a.raw[k]) a.raw[k] = s.raw[k]; });
      merged++;
    });
    return { servers: out, added: added, merged: merged };
  }
  function dedupe(servers) { return mergeServerLists([], servers).servers; }
  function splitUrl(u) {
    var o = { https: 0, host: '', port: 0, path: null };
    try {
      var p = new URL(u);
      o.https = p.protocol === 'https:' ? 1 : 0;
      o.host = p.hostname;
      o.port = p.port ? parseInt(p.port, 10) : (o.https ? 443 : 80);
      o.path = p.pathname && p.pathname !== '/' ? p.pathname : null;
    } catch (e) {
      var m = /^(https?):\/\/([^/:]+)(?::(\d+))?(\/.*)?$/.exec(u || '');
      if (m) { o.https = m[1] === 'https' ? 1 : 0; o.host = m[2]; o.port = m[3] ? +m[3] : (o.https ? 443 : 80); o.path = m[4] && m[4] !== '/' ? m[4] : null; }
    }
    return o;
  }
  function joinUrl(https, host, port, path) {
    if (!host) return '';
    var s = (https ? 'https' : 'http') + '://' + host;
    var p = port ? Number(port) : 0;
    if (p && !((https && p === 443) || (!https && p === 80))) s += ':' + p;
    if (path && path !== '/') s += (path.charAt(0) === '/' ? '' : '/') + path;
    return s;
  }
  function linesFromRaw(arr, map) {
    return (Array.isArray(arr) ? arr : []).map(function (x) {
      return x && typeof x === 'object' ? map(x) : null;
    }).filter(function (l) { return l && l.url; });
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

  function detect(text, filename) {
    var t = String(text || '').replace(/^\uFEFF/, '').trim();
    var o = null;
    try { o = JSON.parse(t); } catch (e) { return null; }
    var fn = (filename || '').toLowerCase();
    if (Array.isArray(o) && o.length && ('originalAddress' in o[0] || 'nowAddress' in o[0])) return 'afusekt';
    if (o && o.magic === WW_MAGIC) return 'wwplayer';
    // Mobile WWPlayer full backup: plain JSON, schemaVersion 2.
    if (o && Number(o.schemaVersion) >= 2 && Array.isArray(o.servers) && (o.preferences || o.playbackHistory)) return 'wwmobile';
    if (o && o.encrypted_data) return 'capyplayer';
    if (o && o.format === 'emby-bridge') return 'bridge';
    if (o && Array.isArray(o.configs) && o._key !== undefined) return fn.endsWith('.lpbak') ? 'linplayer' : 'yamby';
    if (o && Array.isArray(o.configs)) return 'yamby';
    // Hills v2 and v3 (v3 adds encrypted settings / iconPacks / serversData).
    // Do not hard-code a single version number: official exports keep adding
    // fields, and the server list still lives in the same encrypted `data`.
    if (o && typeof o.data === 'string' && Number(o.version) >= 2 && ('iconPacks' in o || 'serversData' in o)) return 'hills';
    if (/hillsbackup/i.test(fn) && typeof o.data === 'string') return 'hills';
    if (o && typeof o.data === 'string' && Object.keys(o).length <= 2) return 'aiplayer';
    if (fn.endsWith('.lpbak')) return 'linplayer';
    if (fn.endsWith('.wwpcfg')) return 'wwplayer';
    return null;
  }

  /* --------------------------------- parse -------------------------------- */

  async function parse(text, format) {
    var o = JSON.parse(String(text).replace(/^\uFEFF/, '').trim());
    var servers = [];
    var i, it, l, extra;
    switch (format) {
      case 'afusekt':
        (Array.isArray(o) ? o : []).forEach(function (a) {
          var s = emptyServer({
            name: a.name, url: a.nowAddress || a.originalAddress, username: a.account,
            password: a.password, type: a.sourceType || 'emby', icon: a.icon,
            lines: linesFromRaw(a.lines, function (x) { return { name: x.name, url: x.address, active: !!x.isNow }; })
          });
          s.raw.afusekt = a; servers.push(s);
        });
        break;

      case 'yamby':
        for (i = 0; i < (o.configs || []).length; i++) {
          it = JSON.parse(fromUtf8(await cbcDecrypt(YAMBY_KEY, YAMBY_KEY.subarray(0, 16), b64ToBytes(o.configs[i]))));
          var auth = it.authorization || {};
          servers.push(emptyServer({
            name: it.name, url: it.url, username: auth.user_name, password: auth.password,
            userId: auth.user_id, accessToken: auth.access_token, icon: it.icon, type: it.type || 'emby',
            sortOrder: it.sort_order || 0,
            lines: linesFromRaw(it.lines, function (x) { return { name: x.name, url: x.url }; })
          }));
          servers[servers.length - 1].raw.yamby = it;
        }
        break;

      case 'linplayer':
        var lk = o._key ? b64ToBytes(o._key) : LIN_KEY;
        for (i = 0; i < (o.configs || []).length; i++) {
          it = JSON.parse(fromUtf8(await cbcDecrypt(lk, lk.subarray(0, 16), b64ToBytes(o.configs[i]))));
          var ext = it.linplayer || {};
          servers.push(emptyServer({
            name: ext.name || it.name, url: it.url, username: it.username,
            password: ext.password, userId: it.user_id, accessToken: it.access_token,
            icon: ext.icon_url, type: it.type || 'emby', remark: ext.remark || '',
            lines: linesFromRaw(ext.lines, function (x) { return { name: x.name, url: x.url, active: x === ext.lines[Number.isInteger(ext.active_line) ? ext.active_line : 0] }; })
          }));
          servers[servers.length - 1].raw.linplayer = it;
        }
        break;

      case 'wwplayer':
        var ct = b64ToBytes(o.payload), nonceB = utf8(o.nonce), out = new Uint8Array(ct.length);
        for (i = 0; i < ct.length; i++) {
          var kb = WW_KEY[i % WW_KEY.length], n = i % 8;
          var rot = ((kb << n) | (kb >> (8 - n))) & 0xff;
          out[i] = ct[i] ^ rot ^ nonceB[i % nonceB.length];
        }
        var inner = JSON.parse(fromUtf8(out));
        (inner.servers || []).forEach(function (w, idx) {
          var main = (w.lines || []).find(function (x) { return x.id === w.activeLineId; }) || (w.lines || [])[0] || {};
          servers.push(emptyServer({
            id: w.id, name: w.name, url: main.url || (idx === 0 ? inner.embyServerUrl : ''),
            username: w.username, password: w.password, userId: w.userId,
            accessToken: w.accessToken, icon: typeof w.icon === 'string' && w.icon.length > 2 ? w.icon : '',
            lines: linesFromRaw(w.lines, function (x) { return { name: x.name, url: x.url, active: x.id === w.activeLineId }; })
          }));
          servers[servers.length - 1].raw.wwplayer = w;
        });
        break;

      case 'wwmobile':
        (o.servers || []).forEach(function (m, idx) {
          if (!m || typeof m !== 'object') return;
          var mlines = linesFromRaw(m.lines, function (x) {
            return { name: x.name, url: x.serverUrl, active: x.lineId === m.activeLineId };
          });
          var main = mlines.find(function (l) { return l.active; }) || mlines[0] || {};
          servers.push(emptyServer({
            id: m.serverId, name: m.displayName || '', serverName: m.displayName || '',
            url: main.url || m.serverUrl || '', username: m.userName || '',
            password: m.password || '', userId: m.userId || '', accessToken: m.accessToken || '',
            type: m.serverType || 'emby', remark: m.remark || '', sortOrder: idx, lines: mlines
          }));
          servers[servers.length - 1].raw.wwmobile = m;
        });
        // Keep the full document: mobile backups carry preferences, playback
        // history, collections etc. Preserve them on a same-format round-trip.
        if (servers.length) servers[0].raw._wwMobileBackup = o;
        break;

      case 'capyplayer':
        var parts = String(o.encrypted_data).split(':');
        var civ = b64ToBytes(parts[0]);
        var ckey = await pbkdf2(CAPY_PASSWORD, CAPY_SALT, 10000, 32);
        var cplain = JSON.parse(fromUtf8(await gcmDecrypt(ckey, civ, b64ToBytes(parts[1]))));
        ((cplain.tables || {}).media_server_resources || []).forEach(function (r, idx) {
          var routes = [];
          try { routes = JSON.parse(r.backup_routes || '[]'); } catch (e) { /* ignore */ }
          servers.push(emptyServer({
            id: r.id, name: r.name, url: joinUrl(r.https, r.host, r.port, r.path),
            username: r.username, password: r.password, userId: r.user_id,
            accessToken: r.token, icon: r.server_logo_image_url, type: r.type || 'emby',
            remark: r.remark || '', sortOrder: typeof r.sort_order === 'number' ? r.sort_order : idx,
            lines: linesFromRaw(routes, function (x) { return { name: x.name, url: joinUrl(x.https, x.host, x.port, x.path), active: !!x.isUse }; })
          }));
          servers[servers.length - 1].raw.capyplayer = r;
        });
        // Keep the whole decrypted document so a CapyPlayer -> CapyPlayer
        // round-trip also preserves preferences, watch stats, badge packs and
        // the database_version of the source app (v22 files differ a lot).
        if (servers.length) servers[0].raw._capyBackup = { inner: cplain, envelope: o };
        break;

      case 'hills':
        var hjson = parseHillsJson(await cbcDecrypt(HILLS_KEY, HILLS_IV, b64ToBytes(o.data)));
        (hjson.data || hjson.servers || []).forEach(function (h, idx) {
          if (!h || typeof h !== 'object') return;
          var auth = {};
          try { auth = JSON.parse(h.authenticateJson || '{}') || {}; } catch (e) { /* ignore */ }
          if (!auth || typeof auth !== 'object') auth = {};
          servers.push(emptyServer({
            name: h.displyName || h.displayName || h.displaayName || h.serverName || '',
            serverName: h.serverName || '', url: h.serverUrl || h.url || '',
            username: h.username || '', password: h.password || '',
            userId: (auth.User || {}).Id || '', accessToken: auth.AccessToken || '',
            icon: h.iconUrl || '', remark: h.remark || '',
            type: h.isJellyfin ? 'jellyfin' : 'emby', sortOrder: h.orderIndex || idx,
            lines: linesFromRaw(h.serverRoutingList, function (x) { return { name: x.name, url: x.url }; })
          }));
          servers[servers.length - 1].raw.hills = h;
        });
        break;

      case 'aiplayer':
        var akey = await sha256(utf8('AIPlayer'));
        var aplain = JSON.parse(fromUtf8(await cbcDecrypt(akey, AI_IV, b64ToBytes(o.data))));
        (aplain.servers || []).forEach(function (a, idx) {
          servers.push(emptyServer({
            id: a.id, name: a.name, serverName: a.serverName, url: a.preferredLineUrl || ((a.lines || [])[0] || {}).url,
            username: a.username, password: a.encryptedPassword, userId: a.lastKnownUserId,
            accessToken: a.encryptedToken, icon: a.iconUrl, type: a.provider || 'emby',
            sortOrder: typeof a.sortOrder === 'number' ? a.sortOrder : idx,
            lines: linesFromRaw(a.lines, function (x) { return { name: x.name, url: x.url, active: !!x.isMain }; })
          }));
          servers[servers.length - 1].raw.aiplayer = a;
        });
        break;

      case 'bridge':
        (o.servers || []).forEach(function (b) { servers.push(emptyServer(b)); });
        break;

      default: throw new Error('未知格式: ' + format);
    }
    return { servers: normalize(servers), meta: { format: format, source: o } };
  }

  /* --------------------------------- build -------------------------------- */

  function lineUrl(s, fallback) { return activeUrl(s) || fallback || ''; }
  function baseRaw(s, fmt) { return Object.assign({}, s.raw && s.raw[fmt] ? s.raw[fmt] : {}); }

  function buildAfusekt(servers) {
    return servers.map(function (s) {
      var o = baseRaw(s, 'afusekt');
      var u = lineUrl(s);
      Object.assign(o, {
        originalAddress: s.url || u, nowAddress: u, account: s.username || '', password: s.password || '',
        sourceType: s.type || 'emby', icon: s.icon || '', name: s.name || '',
        lines: s.lines.filter(function (l) { return l.url && l.url !== u; })
          .map(function (l) { return { address: l.url, isNow: false, name: l.name || '线路' }; })
      });
      return o;
    });
  }

  async function buildYamby(servers) {
    var configs = [];
    for (var i = 0; i < servers.length; i++) {
      var s = servers[i], o = baseRaw(s, 'yamby');
      var auth = Object.assign({}, o.authorization || {});
      Object.assign(auth, { user_name: s.username || '', password: s.password || '', user_id: s.userId || '', access_token: s.accessToken || '', data: null });
      Object.assign(o, {
        type: s.type || 'emby', id: o.id || hexId(32), name: s.name || '', url: s.url || lineUrl(s),
        authorization: auth, sort_order: typeof s.sortOrder === 'number' ? s.sortOrder : i,
        create_time: o.create_time || nowSec(), last_update_time: nowSec(),
        last_play_time: o.last_play_time || null, last_open_time: o.last_open_time || null,
        icon: s.icon || null,
        lines: s.lines.filter(function (l) { return l.url; }).map(function (l) { return { url: l.url, name: l.name || '线路', additional_data: null }; }),
        options: o.options || null
      });
      configs.push(await cbcEncryptJson(YAMBY_KEY, YAMBY_KEY.subarray(0, 16), o));
    }
    return {
      from: 'EmbyBridge', version: '1.0', export_time: nowSec(),
      configs: configs, icon_packages: {}, settings: {}, additional_data: {}, _key: null
    };
  }

  async function buildLinplayer(servers) {
    var configs = [];
    for (var i = 0; i < servers.length; i++) {
      var s = servers[i], o = baseRaw(s, 'linplayer');
      var ext = Object.assign({}, o.linplayer || {});
      ext.name = s.name || '';
      ext.remark = s.remark || null;
      ext.icon_url = s.icon || null;
      ext.password = s.password || '';
      ext.lines = s.lines.filter(function (l) { return l.url; }).map(function (l, j) {
        return { id: (o.linplayer && o.linplayer.lines && o.linplayer.lines[j] && o.linplayer.lines[j].id) || hexId(32), name: l.name || '线路', url: l.url, remark: null };
      });
      ext.active_line = s.activeLine || 0;
      ext.allow_insecure_tls = false;
      ext.source_kind = s.type || 'emby';
      ext.source = {};
      Object.assign(o, {
        type: s.type || 'emby', id: s.url || lineUrl(s), name: s.username || s.name || '',
        url: s.url || lineUrl(s), username: s.username || '', user_id: s.userId || '',
        access_token: s.accessToken || '', linplayer: ext
      });
      configs.push(await cbcEncryptJson(LIN_KEY, LIN_KEY.subarray(0, 16), o));
    }
    return {
      from: 'EmbyBridge', version: '1.0', export_time: nowSec(), configs: configs,
      linplayer_settings: null, _key: bytesToB64(LIN_KEY)
    };
  }

  function wwTransform(bytes, nonceStr) {
    var n = utf8(nonceStr), out = new Uint8Array(bytes.length);
    for (var i = 0; i < bytes.length; i++) {
      var kb = WW_KEY[i % WW_KEY.length], r = i % 8;
      out[i] = bytes[i] ^ (((kb << r) | (kb >> (8 - r))) & 0xff) ^ n[i % n.length];
    }
    return out;
  }

  function buildWwplayer(servers) {
    var list = servers.map(function (s, i) {
      var o = baseRaw(s, 'wwplayer');
      var lines = s.lines.filter(function (l) { return l.url; }).map(function (l, j) {
        return { id: (o.lines && o.lines[j] && o.lines[j].id) || hexId(37), name: l.name || '线路', url: l.url };
      });
      if (!lines.length) lines = [{ id: hexId(37), name: '默认', url: s.url }];
      var activeLineId = (lines[s.activeLine] || lines[0]).id;
      Object.assign(o, {
        id: o.id || hexId(39), name: s.name || '', icon: s.icon || 'w',
        username: s.username || '', userId: s.userId || '', accessToken: s.accessToken || '',
        password: s.password || '', useSystemProxy: o.useSystemProxy !== undefined ? o.useSystemProxy : true,
        activeLineId: activeLineId, lines: lines
      });
      return o;
    });
    var first = servers[0] || {};
    var inner = { activeServerId: list.length ? list[0].id : '', servers: list };
    if (first.url) {
      inner.embyServerUrl = first.url;
      inner.embyUsername = first.username || '';
      inner.embyUserId = first.userId || '';
      inner.embyAccessToken = first.accessToken || '';
    }
    var nonce = uuid();
    var payload = bytesToB64(wwTransform(utf8(JSON.stringify(inner)), nonce));
    return { magic: WW_MAGIC, nonce: nonce, payload: payload };
  }

  // Full top-level template copied from a real WWPlayer mobile (schemaVersion 2)
  // backup. The phone importer validates the whole document structure, not just
  // the servers array, so a bare skeleton with empty preferences is rejected as
  // "content invalid". We deep-clone this known-good template on every build.
  var WW_MOBILE_TEMPLATE = {
  "schemaVersion": 2,
  "credentialsIncluded": false,
  "preferences": {
    "ignoreSslCertificateValidation": true,
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

  // Defaults for the per-server fields the WWPlayer mobile app expects in a
  // schemaVersion 2 backup. A non-mobile source (Hills / Capy / Rodel ...) has
  // no such fields, so we seed them with the values a phone export actually
  // carries; otherwise the importer rejects the file as "content invalid".
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

  function buildWwmobile(servers) {
    var backup = null;
    servers.forEach(function (s) {
      if (!backup && s.raw && s.raw._wwMobileBackup) backup = s.raw._wwMobileBackup;
    });
    var doc = backup ? JSON.parse(JSON.stringify(backup)) : wwMobileSkeleton();
    doc.servers = servers.map(function (s) {
      // Seed with the full mobile server schema (defaults), then overlay any
      // fields the source already carried (a native phone backup keeps its own
      // values). This guarantees every required field exists with the right type.
      var o = Object.assign({}, mobileServerDefaults(), baseRaw(s, 'wwmobile'));
      // The mobile schemaVersion 2 backup does NOT carry credential fields at
      // the server level (only userId / userName are part of its model). Writing
      // password / accessToken makes the app reject the import as "sensitive
      // fields". Strip them and flag credentialsIncluded as false; the user
      // re-logs in once on the phone. Identity fields below are kept.
      delete o.password;
      delete o.accessToken;
      var oldLines = Array.isArray(o.lines) ? o.lines : [];
      var lines = s.lines.filter(function (l) { return l.url; }).map(function (l, j) {
        return {
          lineId: (oldLines[j] && oldLines[j].lineId) || wwShortId(),
          serverUrl: l.url, name: l.name || '',
          source: (oldLines[j] && oldLines[j].source) || ''
        };
      });
      if (!lines.length) lines = [{ lineId: wwShortId(), serverUrl: s.url, name: '默认', source: '' }];
      var idx = Math.min(Math.max(s.activeLine || 0, 0), lines.length - 1);
      Object.assign(o, {
        serverId: o.serverId || wwShortId(), displayName: s.name || '',
        lines: lines, activeLineId: lines[idx].lineId,
        remoteServerId: o.remoteServerId || hexId(32),
        remark: s.remark || '', serverType: s.type || 'emby',
        requiresAuthentication: true, userId: s.userId || '', userName: s.username || ''
      });
      return o;
    });
    doc.schemaVersion = 2;
    doc.exportedAtMs = nowMs();
    doc.credentialsIncluded = false;
    return doc;
  }

  async function buildCapyplayer(servers) {
    var backup = null;
    servers.forEach(function (s) {
      if (!backup && s.raw && s.raw._capyBackup) backup = s.raw._capyBackup;
    });
    var rows = servers.map(function (s, i) {
      var o = baseRaw(s, 'capyplayer');
      var u = splitUrl(s.url || lineUrl(s));
      var routes = s.lines.filter(function (l) { return l.url && l.url !== s.url; }).map(function (l) {
        var p = splitUrl(l.url);
        return { name: l.name || '线路', host: p.host, port: p.port, https: !!p.https, path: p.path || '/', isUse: false, isProxy: false };
      });
      Object.assign(o, {
        id: o.id || uuid(), name: s.name || '', type: s.type || 'emby', resource_type: 'media_server',
        created_at: o.created_at || nowMs(), last_accessed: o.last_accessed || null,
        host: u.host, port: u.port, path: u.path, username: s.username || '', password: s.password || '',
        token: s.accessToken || '', https: u.https, user_id: s.userId || '',
        backup_routes: routes.length ? JSON.stringify(routes) : (o.backup_routes || '[]'),
        server_logo_image_url: s.icon || null, sort_order: typeof s.sortOrder === 'number' ? s.sortOrder : i,
        remark: s.remark || null, is_hidden: o.is_hidden || 0,
        show_carousel: o.show_carousel === undefined ? 1 : o.show_carousel,
        show_resource_aggregation: o.show_resource_aggregation || 0, disable_aggregation: o.disable_aggregation || 0,
        use_strm_direct_link: o.use_strm_direct_link || 0, section_order: o.section_order || null,
        section_configs: o.section_configs || null, carousel_excluded_genres: o.carousel_excluded_genres || null
      });
      return o;
    });
    var inner = backup ? JSON.parse(JSON.stringify(backup.inner)) :
      { tables: { media_server_resources: [], media_item_settings: [], icon_packs: [], icon_items: [] }, preferences: {} };
    inner.tables = inner.tables || {};
    inner.tables.media_server_resources = rows;
    var iv = randomBytes(16);
    var key = await pbkdf2(CAPY_PASSWORD, CAPY_SALT, 10000, 32);
    var ct = await gcmEncrypt(key, iv, utf8(JSON.stringify(inner)));
    var envelope = backup ? Object.assign({}, backup.envelope) : {
      version: '1.0', app_version: '1.0.0.0', database_version: 5, device_name: 'Emby Bridge'
    };
    envelope.created_at = nowMs();
    envelope.encrypted_data = bytesToB64(iv) + ':' + bytesToB64(ct);
    return envelope;
  }

  async function buildHills(servers) {
    var data = servers.map(function (s, i) {
      var o = baseRaw(s, 'hills');
      // Official Hills exports spell this field differently; keep one canonical key.
      delete o.displayName;
      delete o.displaayName;
      var auth = { User: { Name: s.username || '', Id: s.userId || '', PrimaryImageTag: null }, AccessToken: s.accessToken || '' };
      Object.assign(o, {
        displyName: s.name || '', serverName: s.serverName || s.name || '', serverUrl: s.url || lineUrl(s),
        username: s.username || '', password: s.password || '', authenticateJson: JSON.stringify(auth),
        orderIndex: typeof s.sortOrder === 'number' ? s.sortOrder : i, hideUsername: o.hideUsername || false,
        iconUrl: s.icon || '', hideLibraryList: o.hideLibraryList || [], libraryOrderIndexList: o.libraryOrderIndexList || [],
        avatarTag: o.avatarTag || '', viewSortList: o.viewSortList || [], viewFilterList: o.viewFilterList || [],
        selectedServerRoutingId: o.selectedServerRoutingId || '',
        serverRoutingList: s.lines.filter(function (l) { return l.url && l.url !== s.url; }).map(function (l) {
          return { id: hexId(36), url: l.url, name: l.name || '线路' };
        }),
        hideFederated: o.hideFederated || false, isJellyfin: s.type === 'jellyfin', lastWatchedDate: o.lastWatchedDate || null,
        mainRoutingName: o.mainRoutingName || '', isActive: i === 0, isPrivate: o.isPrivate || false,
        remark: s.remark || '', viewCoverTypeList: o.viewCoverTypeList || [], strmDirectLinkPlay: o.strmDirectLinkPlay || false,
        enableFailover: o.enableFailover || false
      });
      return o;
    });
    // The original Hills codec writes the inner document without its final
    // closing brace. Reproduce that byte-for-byte so the
    // generated backup is accepted by the same importers. parse() tolerates
    // both variants.
    var innerText = JSON.stringify({ data: data }).replace(/\}$/, '');
    var cipher = await cbcEncrypt(HILLS_KEY, HILLS_IV, utf8(innerText));
    return { version: 2, data: bytesToB64(cipher), settings: null, mpvConf: null, iconPacks: null, customIcons: null };
  }

  async function buildAiplayer(servers) {
    var akey = await sha256(utf8('AIPlayer'));
    var list = servers.map(function (s, i) {
      var o = baseRaw(s, 'aiplayer');
      var lines = s.lines.filter(function (l) { return l.url; }).map(function (l, j) {
        return { name: l.name || '线路', url: l.url, isMain: j === (s.activeLine || 0) };
      });
      if (!lines.some(function (l) { return l.isMain; }) && lines.length) lines[0].isMain = true;
      Object.assign(o, {
        id: o.id || hexId(16), provider: s.type || 'emby', name: s.name || '', username: s.username || '',
        lastKnownUserId: s.userId || '', serverName: s.serverName || null,
        encryptedToken: s.accessToken || '', rememberPassword: true, encryptedPassword: s.password || '',
        lines: lines, preferredLineUrl: lineUrl(s), iconUrl: s.icon || null,
        sortOrder: typeof s.sortOrder === 'number' ? s.sortOrder : i, useProxy: o.useProxy || false
      });
      return o;
    });
    var inner = { version: 1, exportedAt: dotNetNow(), servers: list };
    var cipher = await cbcEncrypt(akey, AI_IV, utf8(JSON.stringify(inner)));
    return { data: bytesToB64(cipher) };
  }

  function buildBridge(servers) {
    return {
      format: 'emby-bridge', version: 1, exportedAt: new Date().toISOString(),
      servers: servers.map(function (s) {
        var o = {};
        ['id', 'name', 'serverName', 'type', 'url', 'username', 'password', 'userId', 'accessToken', 'icon', 'lines', 'activeLine', 'remark', 'sortOrder'].forEach(function (k) { o[k] = s[k]; });
        return o;
      })
    };
  }

  async function build(servers, format, options) {
    options = options || {};
    var list = normalize(servers || []);
    if (options.selectedOnly) list = list.filter(function (s) { return s._selected !== false; });
    var obj;
    switch (format) {
      case 'afusekt': obj = buildAfusekt(list); break;
      case 'yamby': obj = await buildYamby(list); break;
      case 'linplayer': obj = await buildLinplayer(list); break;
      case 'wwplayer': obj = buildWwplayer(list); break;
      case 'wwmobile': obj = buildWwmobile(list); break;
      case 'capyplayer': obj = await buildCapyplayer(list); break;
      case 'hills': obj = await buildHills(list); break;
      case 'aiplayer': obj = await buildAiplayer(list); break;
      case 'bridge': obj = buildBridge(list); break;
      case 'csv': return { text: toCsv(list), filename: 'emby-servers-' + stamp() + '.csv', mime: 'text/csv;charset=utf-8' };
      default: throw new Error('未知格式: ' + format);
    }
    var pretty = format === 'wwplayer' || format === 'bridge' ? JSON.stringify(obj, null, 2) : JSON.stringify(obj);
    return {
      text: pretty,
      filename: 'emby-bridge-' + format + '-' + stamp() + '.' + META[format].ext,
      mime: 'application/json;charset=utf-8'
    };
  }

  /* ---------------------------------- CSV --------------------------------- */

  function csvCell(v) {
    v = v == null ? '' : String(v);
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function toCsv(servers) {
    var head = ['name', 'type', 'url', 'username', 'password', 'userId', 'accessToken', 'icon', 'lines'];
    var rows = [head.join(',')];
    (servers || []).forEach(function (s) {
      rows.push([
        csvCell(s.name), csvCell(s.type), csvCell(s.url), csvCell(s.username), csvCell(s.password),
        csvCell(s.userId), csvCell(s.accessToken), csvCell(s.icon),
        csvCell((s.lines || []).map(function (l) { return l.name + '=' + l.url; }).join('|'))
      ].join(','));
    });
    return '\uFEFF' + rows.join('\r\n');
  }
  function parseCsvLine(line) {
    var out = [], cur = '', quoted = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur); return out;
  }
  function parseCsv(text) {
    var lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (!lines.length) return [];
    var head = parseCsvLine(lines[0]).map(function (h) { return h.trim().toLowerCase(); });
    var map = { name: 'name', 名称: 'name', type: 'type', 类型: 'type', url: 'url', 地址: 'url', address: 'url', username: 'username', 用户名: 'username', account: 'username', password: 'password', 密码: 'password', userid: 'userId', user_id: 'userId', accesstoken: 'accessToken', access_token: 'accessToken', token: 'accessToken', icon: 'icon', 图标: 'icon', lines: 'lines', 线路: 'lines' };
    return lines.slice(1).map(function (line) {
      var cells = parseCsvLine(line), s = emptyServer();
      cells.forEach(function (v, i) {
        var key = map[head[i]] || head[i];
        if (key === 'lines') {
          s.lines = String(v).split('|').filter(Boolean).map(function (p) {
            var k = p.indexOf('='); return k > 0 ? { name: p.slice(0, k), url: p.slice(k + 1), active: false } : { name: '线路', url: p, active: false };
          });
        } else if (s.hasOwnProperty(key) && key !== 'lines' && key !== 'raw') s[key] = v;
      });
      return s;
    }).filter(function (s) { return s.url || s.name || s.username; });
  }
  function parseQuickText(text) {
    // One server per line: name | url | username | password  (or just a URL)
    var out = [];
    String(text || '').split(/\r?\n/).forEach(function (line) {
      line = line.trim(); if (!line || line.charAt(0) === '#') return;
      var parts = line.split(/\s*[|,;\t]\s*/);
      var url = parts.find(function (p) { return /^https?:\/\//i.test(p); });
      if (!url) return;
      var others = parts.filter(function (p) { return p !== url; });
      out.push(emptyServer({
        url: url, name: others[0] || '', username: others[1] || '', password: others[2] || '',
        lines: [{ name: '默认', url: url, active: true }]
      }));
    });
    return out;
  }

  return {
    META: META, FORMATS: FORMATS,
    detect: detect, parse: parse, build: build,
    normalize: normalize, dedupe: dedupe, mergeServerLists: mergeServerLists, emptyServer: emptyServer,
    toCsv: toCsv, parseCsv: parseCsv, parseQuickText: parseQuickText,
    _internal: { cbcEncrypt: cbcEncrypt, cbcDecrypt: cbcDecrypt, gcmEncrypt: gcmEncrypt, gcmDecrypt: gcmDecrypt, pbkdf2: pbkdf2, sha256: sha256, bytesToB64: bytesToB64, b64ToBytes: b64ToBytes }
  };
});

