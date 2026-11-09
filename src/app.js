/* Emby Bridge - UI controller. No network access, no storage. */
(function () {
  'use strict';
  var B = globalThis.EmbyBridge;
  var $ = function (s) { return document.querySelector(s); };
  var state = { servers: [], files: [], filter: '', showSecrets: false };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var toastTimer;
  function toast(msg, isErr) {
    var t = $('#toast');
    t.textContent = msg; t.className = 'show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = ''; }, 3600);
  }
  function fmtCount() {
    var n = state.servers.length, sel = state.servers.filter(function (s) { return s._selected !== false; }).length;
    $('#count').textContent = '共 ' + n + ' 台 · 已选 ' + sel + ' 台';
    $('#exportHint').textContent = '将导出已勾选的 ' + sel + ' 台服务器（共 ' + n + ' 台）。密码与令牌会原样写入备份文件，请妥善保管。';
  }

  /* ------------------------------ merging ------------------------------ */
  function fill(a, b) {
    ['name', 'serverName', 'url', 'username', 'password', 'userId', 'accessToken', 'icon', 'remark'].forEach(function (k) {
      if (!a[k] && b[k]) a[k] = b[k];
    });
    if ((b.lines || []).length > (a.lines || []).length) a.lines = b.lines;
    Object.keys(b.raw || {}).forEach(function (f) { if (!a.raw[f]) a.raw[f] = b.raw[f]; });
  }
  function mergeServers(incoming) {
    var index = {};
    state.servers.forEach(function (s) { index[(s.url || '').toLowerCase() + '|' + (s.username || '').toLowerCase()] = s; });
    var added = 0, merged = 0;
    incoming.forEach(function (s) {
      var key = (s.url || '').toLowerCase() + '|' + (s.username || '').toLowerCase();
      if (index[key]) { fill(index[key], s); merged++; }
      else { s._selected = true; s._open = false; state.servers.push(s); index[key] = s; added++; }
    });
    state.servers = B.normalize(state.servers);
    return { added: added, merged: merged };
  }

  /* ------------------------------- render ------------------------------- */
  function field(i, key, label, val, opts) {
    opts = opts || {};
    var type = opts.secret && !state.showSecrets ? 'password' : 'text';
    var cls = opts.mono ? ' class="mono"' : '';
    return '<label class="f"><span>' + label + '</span><input type="' + type + '"' + cls +
      ' data-i="' + i + '" data-field="' + key + '" value="' + esc(val) + '"' +
      (opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '') + '></label>';
  }
  function lineRow(i, j, l) {
    return '<div class="line-row">' +
      '<input class="nm" data-i="' + i + '" data-li="' + j + '" data-lf="name" value="' + esc(l.name) + '" placeholder="线路名">' +
      '<input data-i="' + i + '" data-li="' + j + '" data-lf="url" value="' + esc(l.url) + '" placeholder="https://...">' +
      '<button class="rm" data-act="rmline" data-i="' + i + '" data-li="' + j + '" title="删除线路">×</button></div>';
  }
  function serverHtml(s, i) {
    var open = !!s._open, sel = s._selected !== false;
    var h = '<div class="server' + (open ? ' open' : '') + (sel ? ' selected' : '') + '" data-card="' + i + '">';
    h += '<div class="server-head">' +
      '<input type="checkbox" data-act="sel" data-i="' + i + '"' + (sel ? ' checked' : '') + ' title="参与导出">' +
      '<span class="idx">' + (i + 1) + '</span>' +
      '<div class="meta"><span class="sv-name">' + esc(s.name || '未命名服务器') + '</span>' +
      '<span class="sv-url">' + esc(s.url || '') + '</span>' +
      '<span class="sv-user">' + esc(s.username || '') + '</span>' +
      '<span class="tag">' + (s.lines.length || 0) + ' 线路</span></div>' +
      '<button class="btn sm ghost" data-act="toggle" data-i="' + i + '">' + (open ? '收起' : '编辑') + '</button>' +
      '<button class="btn sm ghost danger" data-act="del" data-i="' + i + '" title="删除">删除</button></div>';
    h += '<div class="server-body"><div class="fields">' +
      field(i, 'name', '显示名称', s.name) +
      '<label class="f"><span>服务器类型</span><select data-i="' + i + '" data-field="type">' +
      '<option value="emby"' + (s.type === 'emby' ? ' selected' : '') + '>Emby</option>' +
      '<option value="jellyfin"' + (s.type === 'jellyfin' ? ' selected' : '') + '>Jellyfin</option></select></label>' +
      field(i, 'url', '主地址', s.url, { mono: true, placeholder: 'https://server:8096' }) +
      field(i, 'serverName', '服务器名（部分播放器用）', s.serverName) +
      field(i, 'username', '用户名', s.username) +
      field(i, 'password', '密码', s.password, { secret: true }) +
      field(i, 'userId', 'User ID', s.userId, { secret: true, mono: true }) +
      field(i, 'accessToken', 'Access Token', s.accessToken, { secret: true, mono: true }) +
      field(i, 'icon', '图标 URL', s.icon, { mono: true }) +
      field(i, 'remark', '备注', s.remark) +
      '</div>';
    h += '<div class="lines"><div class="lines-title">线路 / 备用地址' +
      '<button class="btn sm ghost" data-act="addline" data-i="' + i + '">+ 添加线路</button>' +
      '<span style="color:var(--dim);font-size:11.5px">第一条为默认线路</span></div>' +
      (s.lines.map(function (l, j) { return lineRow(i, j, l); }).join('') || '<div class="empty" style="padding:8px">暂无线路</div>') +
      '</div></div></div>';
    return h;
  }
  function render() {
    var q = state.filter.trim().toLowerCase();
    var list = state.servers.map(function (s, i) { return { s: s, i: i }; }).filter(function (x) {
      if (!q) return true;
      return [x.s.name, x.s.url, x.s.username, x.s.serverName].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    $('#serverList').innerHTML = list.length
      ? list.map(function (x) { return serverHtml(x.s, x.i); }).join('')
      : '<div class="empty">' + (state.servers.length ? '没有匹配的服务器' : '还没有服务器。先导入一个播放器备份，或用「批量添加」粘贴地址。') + '</div>';
    fmtCount();
    $('#fileList').innerHTML = state.files.map(function (f) {
      return '<span class="chip"><b>' + esc(B.META[f.format] ? B.META[f.format].label : f.format) + '</b><span>' + esc(f.name) + ' · ' + f.count + ' 台</span></span>';
    }).join('');
  }

  /* ------------------------------- import ------------------------------- */
  async function importText(text, name) {
    var fmt = B.detect(text, name), servers = [];
    if (!fmt && (/\.csv$/i.test(name) || /^[\s\uFEFF]*(name|名称|url|地址)\s*,/i.test(text))) {
      servers = B.parseCsv(text); fmt = 'CSV';
    } else if (!fmt && /^\s*\{/.test(text)) {
      try {
        var o = JSON.parse(text);
        if (o && o.format === 'emby-bridge') { servers = (await B.parse(text, 'bridge')).servers; fmt = '通用中间格式'; }
      } catch (e) { /* fall through */ }
    }
    if (!fmt) {
      var quick = B.parseQuickText(text);
      if (quick.length) { servers = quick; fmt = '文本'; }
    }
    if (fmt && B.FORMATS.indexOf(fmt) >= 0) servers = (await B.parse(text, fmt)).servers;
    if (!servers.length) throw new Error('无法识别：' + name + '（支持的格式见页面下方）');
    var r = mergeServers(servers);
    state.files.push({ name: name, format: fmt, count: servers.length });
    return r;
  }
  async function handleFiles(files) {
    var added = 0, merged = 0, errors = [];
    for (var i = 0; i < files.length; i++) {
      try {
        var text = await files[i].text();
        var r = await importText(text, files[i].name);
        added += r.added; merged += r.merged;
      } catch (e) { errors.push(e.message); }
    }
    render();
    if (errors.length) toast(errors.join(' / '), true);
    else toast('导入完成：新增 ' + added + ' 台，合并 ' + merged + ' 台');
  }

  /* ------------------------------- export ------------------------------- */
  async function exportAs(fmt) {
    var selected = state.servers.filter(function (s) { return s._selected !== false; });
    if (!selected.length) { toast('请至少勾选一台服务器', true); return; }
    try {
      var out = await B.build(selected, fmt);
      var blob = new Blob([out.text], { type: out.mime });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = out.filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      toast('已生成 ' + out.filename + '（' + selected.length + ' 台）');
    } catch (e) { toast('导出失败：' + e.message, true); }
  }

  /* -------------------------------- events ------------------------------- */
  function bind() {
    var drop = $('#drop'), input = $('#fileInput');
    drop.addEventListener('click', function (e) { if (e.target.tagName !== 'BUTTON') input.click(); });
    $('#pickBtn').addEventListener('click', function (e) { e.stopPropagation(); input.click(); });
    input.addEventListener('change', function () { if (input.files.length) handleFiles(input.files); input.value = ''; });
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('hover'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('hover'); }); });
    drop.addEventListener('drop', function (e) { if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); });

    $('#search').addEventListener('input', function (e) { state.filter = e.target.value; render(); });
    $('#addBtn').addEventListener('click', function () {
      var s = B.emptyServer({ name: '新服务器', url: '', lines: [] });
      s._selected = true; s._open = true;
      state.servers.push(s); render();
      setTimeout(function () { var el = document.querySelector('[data-card="' + (state.servers.length - 1) + '"] input'); if (el) el.focus(); }, 30);
    });
    $('#pasteBtn').addEventListener('click', function () { $('#modal').classList.add('show'); $('#pasteText').focus(); });
    $('#modalCancel').addEventListener('click', function () { $('#modal').classList.remove('show'); });
    $('#modal').addEventListener('click', function (e) { if (e.target.id === 'modal') $('#modal').classList.remove('show'); });
    $('#modalOk').addEventListener('click', async function () {
      var text = $('#pasteText').value;
      if (!text.trim()) { toast('请先粘贴内容', true); return; }
      try {
        var r = await importText(text, '粘贴内容');
        $('#pasteText').value = ''; $('#modal').classList.remove('show'); render();
        toast('已添加 ' + r.added + ' 台，合并 ' + r.merged + ' 台');
      } catch (e) { toast(e.message, true); }
    });
    $('#dedupeBtn').addEventListener('click', function () {
      var before = state.servers.length;
      state.servers = B.dedupe(state.servers); render();
      toast('已去除 ' + (before - state.servers.length) + ' 条重复项');
    });
    $('#selectAll').addEventListener('click', function () {
      var all = state.servers.every(function (s) { return s._selected !== false; });
      state.servers.forEach(function (s) { s._selected = all ? false : true; }); render();
    });
    $('#expandAll').addEventListener('click', function () {
      var anyClosed = state.servers.some(function (s) { return !s._open; });
      state.servers.forEach(function (s) { s._open = anyClosed; }); render();
    });
    $('#secretBtn').addEventListener('click', function () {
      state.showSecrets = !state.showSecrets;
      $('#secretBtn').textContent = state.showSecrets ? '隐藏密码' : '显示密码';
      render();
    });
    $('#clearBtn').addEventListener('click', function () {
      if (!state.servers.length) return;
      if (!confirm('确定清空当前列表？此操作只清空页面内存，不会删除你电脑上的任何文件。')) return;
      state.servers = []; state.files = []; render(); toast('已清空');
    });

    $('#serverList').addEventListener('input', function (e) {
      var el = e.target, i = +el.dataset.i;
      if (isNaN(i) || !state.servers[i]) return;
      if (el.dataset.li !== undefined) {
        var l = state.servers[i].lines[+el.dataset.li];
        if (l) l[el.dataset.lf] = el.value;
      } else if (el.dataset.field) {
        state.servers[i][el.dataset.field] = el.value;
        if (el.dataset.field === 'name' || el.dataset.field === 'url') {
          var card = el.closest('.server');
          if (card) {
            var n = card.querySelector('.sv-name'), u = card.querySelector('.sv-url');
            if (n) n.textContent = state.servers[i].name || '未命名服务器';
            if (u) u.textContent = state.servers[i].url || '';
          }
        }
      }
    });
    $('#serverList').addEventListener('change', function (e) {
      if (e.target.tagName === 'SELECT') e.target.dispatchEvent(new Event('input', { bubbles: true }));
    });
    $('#serverList').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]'); if (!btn) return;
      var act = btn.dataset.act, i = +btn.dataset.i;
      if (act === 'toggle') { state.servers[i]._open = !state.servers[i]._open; render(); }
      else if (act === 'sel') { state.servers[i]._selected = btn.checked; render(); }
      else if (act === 'del') { state.servers.splice(i, 1); render(); }
      else if (act === 'addline') { state.servers[i].lines.push({ name: '线路', url: '', active: false }); render(); }
      else if (act === 'rmline') { state.servers[i].lines.splice(+btn.dataset.li, 1); render(); }
    });

    document.querySelectorAll('[data-export]').forEach(function (b) {
      b.addEventListener('click', function () { exportAs(b.dataset.export); });
    });

    if (!globalThis.crypto || !globalThis.crypto.subtle) {
      toast('当前环境缺少 Web Crypto，请改用 HTTPS 页面或新版浏览器打开', true);
    }
  }

  document.addEventListener('DOMContentLoaded', function () { bind(); render(); });
})();
