/* Emby Bridge 页面控制器：仅使用页面内存，不联网、不持久化。 */
(function () {
  'use strict';
  var B = globalThis.EmbyBridge;
  var $ = function (s) { return document.querySelector(s); };
  var state = {
    servers: [], files: [], contexts: [], filter: '', showSecrets: false,
    page: 1, pageSize: 50, generation: 0, importJob: null,
    exportBusy: false, exportJob: null, exportModel: null, dialog: null, effectsPaused: false
  };
  var motionQuery = globalThis.matchMedia ? globalThis.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var cardMotions = new Map();
  var fullFormats = ['yamby', 'linplayer', 'wwplayer', 'wwmobile', 'capyplayer', 'aiplayer', 'hills'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function selectedServers() {
    return state.servers.filter(function (s) { return s._selected !== false; });
  }
  function busy() { return !!state.importJob || state.exportBusy; }
  function canMutate() {
    if (!busy()) return true;
    toast('请先完成或取消当前操作', true);
    return false;
  }
  function serverById(id) {
    return state.servers.find(function (s) { return s.id === id; });
  }
  function cardById(id) {
    return Array.from($('#serverList').querySelectorAll('[data-card]')).find(function (card) {
      return card.dataset.card === id;
    });
  }
  function formatLabel(fmt) {
    return B.META[fmt] ? B.META[fmt].label : '地址文本';
  }
  var toastTimer;
  function toast(msg, isErr) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = ''; }, 4200);
  }
  function fmtCount() {
    var n = state.servers.length, sel = selectedServers().length;
    $('#count').textContent = '共 ' + n + ' 台 · 已选 ' + sel + ' 台';
    $('#exportHint').textContent = '已选 ' + sel + ' / 共 ' + n + ' 台。搜索不会改变导出范围；默认仅导出选中的服务器，不保留原备份的设置与历史。选择目标格式后查看预检。';
  }

  /* 只为当前页中展开的卡片生成字段，事件始终使用服务器和线路的稳定 ID。 */
  function hasLineBreak(value) { return typeof value === 'string' && /[\r\n]/.test(value); }
  function inputDisplay(value) { return hasLineBreak(value) ? value.replace(/\r/g, '\\r').replace(/\n/g, '\\n') : value; }
  function preserveInputAttrs(value) {
    return hasLineBreak(value) ? ' readonly aria-readonly="true" data-preserve-raw="true" title="原值含换行，已按原样保留；请通过 CSV / JSON 修改"' : '';
  }
  function field(s, key, label, val, opts) {
    opts = opts || {};
    var type = opts.secret && !state.showSecrets ? 'password' : 'text';
    return '<label class="f"><span>' + label + '</span><input type="' + type + '"' +
      (opts.mono ? ' class="mono"' : '') + ' data-sid="' + esc(s.id) + '" data-field="' + key +
      '" value="' + esc(inputDisplay(val)) + '" autocomplete="off" spellcheck="false"' +
      preserveInputAttrs(val) + (opts.secret ? ' data-secret="true"' : '') +
      (opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '') + '>' +
      (hasLineBreak(val) ? '<small class="raw-field-hint">含换行，原值按原样导出；请通过 CSV / JSON 修改。</small>' : '') + '</label>';
  }
  function lineRow(s, line) {
    var primary = line.id === s.primaryLineId;
    var attrs = ' data-sid="' + esc(s.id) + '" data-line-id="' + esc(line.id) + '"';
    var label = line.name || (primary ? '主线路' : '备用线路');
    return '<div class="line-row' + (primary ? ' primary-line' : '') + '">' +
      '<label class="line-active"><input type="radio" name="active-' + esc(s.id) + '" data-act="active"' + attrs +
      (line.id === s.activeLineId ? ' checked' : '') + ' aria-label="将 ' + esc(label) + ' 设为活动线路"><span>活动</span></label>' +
      '<input class="nm"' + attrs + ' data-line-field="name" value="' + esc(inputDisplay(line.name)) + '" placeholder="线路名" aria-label="线路名称" autocomplete="off"' + preserveInputAttrs(line.name) + '>' +
      '<input class="line-url"' + attrs + ' data-line-field="url" value="' + esc(inputDisplay(line.url)) + '" placeholder="https://server:8096" aria-label="' + (primary ? '主线路地址，与主地址同步' : '备用线路地址') + '" autocomplete="off" spellcheck="false"' + preserveInputAttrs(line.url) + '>' +
      (primary ? '<span class="primary-label" title="主线路不能删除，请修改主地址">主线路</span>' :
        '<button class="rm" data-act="rmline"' + attrs + ' aria-label="删除 ' + esc(label) + '">删除</button>') +
      (hasLineBreak(line.name) || hasLineBreak(line.url) ? '<small class="raw-field-hint line-raw-hint">含换行的字段只读，原值仍保留；请通过 CSV / JSON 修改。</small>' : '') + '</div>';
  }
  function serverBodyId(s) {
    // A collision-free DOM identity, independent of filtering, deletion and pagination.
    return 'server-body-' + Array.from(String(s.id), function (c) { return c.codePointAt(0).toString(16); }).join('-');
  }
  function serverBodyHtml(s) {
    var attrs = ' data-sid="' + esc(s.id) + '"';
    return '<div class="server-body-inner"><div class="fields">' + field(s, 'name', '显示名称', s.name) +
      '<label class="f"><span>服务器类型</span><select' + attrs + ' data-field="type">' +
      '<option value="emby"' + (s.type === 'emby' ? ' selected' : '') + '>Emby</option>' +
      '<option value="jellyfin"' + (s.type === 'jellyfin' ? ' selected' : '') + '>Jellyfin</option></select></label>' +
      field(s, 'url', '主地址（与主线路同步）', s.url, { mono: true, placeholder: 'https://server:8096' }) +
      field(s, 'serverName', '服务器名（部分播放器用）', s.serverName) +
      field(s, 'username', '用户名', s.username) + field(s, 'password', '密码', s.password, { secret: true }) +
      field(s, 'userId', 'User ID', s.userId, { secret: true, mono: true }) +
      field(s, 'accessToken', 'Access Token', s.accessToken, { secret: true, mono: true }) +
      field(s, 'icon', '图标 URL', s.icon, { mono: true }) + field(s, 'remark', '备注', s.remark) + '</div>' +
      '<fieldset class="lines"><legend>线路 / 备用地址</legend><div class="lines-title">' +
      '<span class="line-help">单选框指定活动线路；主线路不能删除。</span>' +
      '<button class="btn sm ghost" data-act="addline"' + attrs + '>+ 添加线路</button></div>' +
      s.lines.map(function (l) { return lineRow(s, l); }).join('') + '</fieldset></div>';
  }
  function serverHtml(s, index) {
    var open = !!s._open, sel = s._selected !== false;
    var bodyId = serverBodyId(s), attrs = ' data-sid="' + esc(s.id) + '"';
    var h = '<div class="server' + (open ? ' open' : '') + (sel ? ' selected' : '') + '" data-card="' + esc(s.id) + '">';
    h += '<div class="server-head"><input type="checkbox" data-act="sel"' + attrs +
      (sel ? ' checked' : '') + ' aria-label="导出 ' + esc(s.name || '未命名服务器') + '">' +
      '<span class="idx">' + (index + 1) + '</span><div class="meta">' +
      '<span class="sv-name">' + esc(s.name || '未命名服务器') + '</span>' +
      '<span class="sv-url">' + esc(s.url) + '</span><span class="sv-user">' + esc(s.username) + '</span>' +
      '<span class="tag">' + s.lines.length + ' 线路</span></div>' +
      '<button class="btn sm ghost" data-act="toggle"' + attrs + ' aria-expanded="' + open +
      '" aria-controls="' + bodyId + '">' + (open ? '收起' : '编辑') + '</button>' +
      '<button class="btn sm ghost danger" data-act="del"' + attrs + ' aria-label="删除 ' + esc(s.name || '未命名服务器') + '">删除</button></div>';
    return h + '<div class="server-body" id="' + bodyId + '"' + (open ? '' : ' hidden') + '>' +
      (open ? serverBodyHtml(s) : '') + '</div></div>';
  }

  function stopCardMotion(card) {
    var motion = cardMotions.get(card);
    if (!motion) return;
    cardMotions.delete(card);
    motion.animation.cancel();
    motion.body.style.overflow = '';
  }
  function stopCardMotions() { Array.from(cardMotions.keys()).forEach(stopCardMotion); }
  function cardInViewport(card) {
    var rect = card.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < globalThis.innerHeight + 80;
  }
  function moveCardBody(card, open, fromHeight, fromOpacity) {
    var body = card.querySelector('.server-body');
    stopCardMotion(card);
    body.hidden = false;
    body.inert = !open;
    function settle() {
      body.hidden = !open;
      body.inert = false;
      body.style.overflow = '';
      if (!open) body.textContent = '';
    }
    if (motionQuery.matches || !body.animate || !cardInViewport(card)) { settle(); return; }
    var targetHeight = open ? body.firstElementChild.getBoundingClientRect().height : 0;
    body.style.overflow = 'hidden';
    var animation = body.animate([
      { height: fromHeight + 'px', opacity: fromOpacity },
      { height: targetHeight + 'px', opacity: open ? 1 : 0 }
    ], { duration: open ? 320 : 240, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'both' });
    var motion = { animation: animation, body: body, finish: function () {
      if (cardMotions.get(card) !== motion) return;
      cardMotions.delete(card);
      var s = serverById(card.dataset.card);
      if (card.isConnected && s && !!s._open === open) settle();
      animation.cancel();
    } };
    cardMotions.set(card, motion);
    animation.finished.then(motion.finish, function () {});
  }
  function updateExpandLabel() {
    var items = view().items;
    $('#expandAll').textContent = items.length && items.every(function (x) { return x.s._open; }) ? '收起本页' : '展开本页';
  }
  function setServerOpen(s, open) {
    var card = cardById(s.id);
    if (!!s._open === open) return;
    s._open = open;
    if (!card) return;
    var body = card.querySelector('.server-body'), button = card.querySelector('[data-act="toggle"]');
    var fromHeight = body.hidden ? 0 : body.getBoundingClientRect().height;
    var fromOpacity = body.hidden ? 0 : Number(getComputedStyle(body).opacity);
    if (!open && body.contains(document.activeElement)) button.focus({ preventScroll: true });
    if (open && !body.firstElementChild) body.innerHTML = serverBodyHtml(s);
    card.classList.toggle('open', open);
    button.textContent = open ? '收起' : '编辑';
    button.setAttribute('aria-expanded', String(open));
    moveCardBody(card, open, fromHeight, fromOpacity);
  }
  function view() {
    var q = state.filter.trim().toLowerCase();
    var list = state.servers.map(function (s, i) { return { s: s, index: i }; }).filter(function (x) {
      return !q || [x.s.name, x.s.url, x.s.username, x.s.serverName].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    var pages = Math.max(1, Math.ceil(list.length / state.pageSize));
    state.page = Math.max(1, Math.min(state.page, pages));
    var start = (state.page - 1) * state.pageSize;
    return { list: list, items: list.slice(start, start + state.pageSize), pages: pages, start: start };
  }
  function captureCardFocus() {
    var el = document.activeElement, card = el && el.closest('[data-card]');
    if (!card || !$('#serverList').contains(card)) return null;
    return {
      sid: card.dataset.card, field: el.dataset.field, lineId: el.dataset.lineId,
      lineField: el.dataset.lineField, act: el.dataset.act,
      start: typeof el.selectionStart === 'number' ? el.selectionStart : null,
      end: typeof el.selectionEnd === 'number' ? el.selectionEnd : null
    };
  }
  function restoreCardFocus(focus) {
    if (!focus || state.dialog) return;
    var card = cardById(focus.sid), el;
    if (card) {
      el = Array.from(card.querySelectorAll('input, select, button')).find(function (x) {
        if (focus.field) return x.dataset.field === focus.field;
        if (focus.lineId) return x.dataset.lineId === focus.lineId &&
          (focus.lineField ? x.dataset.lineField === focus.lineField : x.dataset.act === focus.act);
        return focus.act && x.dataset.act === focus.act;
      });
      if (!el) el = card.querySelector('[data-act="toggle"]');
    }
    if (!el || el.disabled) el = $('#serverList [data-act="toggle"]');
    if (!el || el.disabled) el = $('#search');
    el.focus({ preventScroll: true });
    if (focus.start !== null && focus.start !== undefined && el.setSelectionRange && el.type !== 'radio' && el.type !== 'checkbox') {
      el.setSelectionRange(focus.start, focus.end);
    }
  }
  function render(options) {
    options = options || {};
    var focus = options.focus || captureCardFocus(), v = view();
    stopCardMotions();
    $('#serverList').innerHTML = v.items.length ? v.items.map(function (x) {
      return serverHtml(x.s, x.index);
    }).join('') : '<div class="empty"><span class="empty-icon" aria-hidden="true"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 17.5h.01M11 7.5h6M11 17.5h6"/></svg></span><b>' +
      (state.servers.length ? '没有匹配的服务器' : '你的配置工作区已就绪') + '</b><span>' +
      (state.servers.length ? '搜索不会取消已勾选的项目。' : '先导入播放器备份，或用「批量粘贴」添加地址。') + '</span></div>';
    $('#pager').hidden = !v.list.length;
    $('#pageInfo').textContent = '第 ' + state.page + ' / ' + v.pages + ' 页 · 显示 ' + (v.start + 1) + '–' +
      (v.start + v.items.length) + ' / ' + v.list.length + ' 条' + (state.filter.trim() ? '匹配结果' : '服务器');
    $('#prevPage').disabled = state.page <= 1;
    $('#nextPage').disabled = state.page >= v.pages;
    updateExpandLabel();
    fmtCount();
    syncBusyUI();
    if (options.animateId) {
      var card = cardById(options.animateId);
      if (card && card.classList.contains('open')) moveCardBody(card, true, 0, 0);
    }
    restoreCardFocus(focus);
  }
  function renderFiles() {
    var labels = { pending: '等待', reading: '读取中', parsing: '解析中', success: '成功', error: '失败', cancelled: '已取消' };
    $('#fileList').innerHTML = state.files.map(function (f) {
      return '<li class="chip ' + f.status + '"><span class="file-status">' + labels[f.status] + '</span><div>' +
        '<b>' + esc(f.name) + '</b><span>' + esc(f.format ? formatLabel(f.format) + ' · ' : '') + esc(f.detail) + '</span></div></li>';
    }).join('');
  }
  function syncBusyUI() {
    var locked = busy();
    document.querySelectorAll('[data-mutation], [data-export]').forEach(function (el) { el.disabled = locked; });
    $('#addBtn').disabled = locked || state.servers.length >= B.MAX_SERVERS;
    $('#fileInput').disabled = locked;
    $('#drop').setAttribute('aria-disabled', String(locked));
    if (locked) $('#drop').classList.remove('hover');
    $('#drop').setAttribute('aria-busy', String(!!state.importJob));
    $('#serverList').setAttribute('aria-busy', String(!!state.importJob));
    $('#serverList').querySelectorAll('input, select, button').forEach(function (el) { el.disabled = locked; });
    $('#clearBtn').disabled = state.exportBusy || (!state.servers.length && !state.files.length && !state.contexts.length && !state.importJob && !$('#pasteText').value);
    $('#importCancel').hidden = !state.importJob;
    $('#pasteText').disabled = locked;
    $('#modalOk').disabled = locked;
    $('#modalOk').textContent = state.importJob && state.importJob.kind === 'paste' ? '正在解析…' : '添加到列表';
    $('#secretBtn').textContent = state.showSecrets ? '隐藏凭据' : '显示凭据';
    $('#secretBtn').setAttribute('aria-pressed', String(state.showSecrets));
    if (state.exportModel) {
      var report = state.exportModel.report;
      $('#exportOk').disabled = locked || !report || !report.ok ||
        (report.warnings.length > 0 && !$('#exportConfirm').checked);
      $('#exportOk').textContent = state.exportBusy ? '正在生成…' : '生成并下载';
      $('#exportModeServers').disabled = locked;
      $('#exportModeFull').disabled = locked || fullFormats.indexOf(state.exportModel.format) < 0;
      $('#exportConfirm').disabled = locked;
    }
    if (state.dialog && state.dialog.closing) {
      state.dialog.mask.querySelectorAll('button, input, select, textarea').forEach(function (el) { el.disabled = true; });
    }
  }
  function updateCardMeta(s, card) {
    if (!card) return;
    card.querySelector('.sv-name').textContent = s.name || '未命名服务器';
    card.querySelector('.sv-url').textContent = s.url;
    card.querySelector('.sv-user').textContent = s.username;
    card.querySelector('.tag').textContent = s.lines.length + ' 线路';
    card.querySelector('[data-act="sel"]').setAttribute('aria-label', '导出 ' + (s.name || '未命名服务器'));
  }

  /* 导入以代次和 AbortController 隔离，取消或清空后旧异步结果不能回填。 */
  function beginImport(total, kind, records) {
    if (!canMutate()) return null;
    var job = {
      id: ++state.generation, controller: new AbortController(), total: total, completed: 0,
      added: 0, merged: 0, failed: 0, kind: kind, records: records
    };
    state.importJob = job;
    state.files = state.files.concat(records);
    $('#importPanel').hidden = false;
    $('#importProgress').max = total;
    $('#importProgress').value = 0;
    setImportPhase(job, '准备导入 ' + total + ' 项');
    renderFiles();
    syncBusyUI();
    return job;
  }
  function currentImport(job) {
    return state.importJob === job && state.generation === job.id && !job.controller.signal.aborted;
  }
  function checkImport(job) {
    if (!currentImport(job)) { var e = new Error('导入已取消'); e.name = 'AbortError'; throw e; }
  }
  function setImportPhase(job, message, fraction) {
    if (!currentImport(job)) return;
    $('#importStatus').textContent = message + ' · 已完成 ' + job.completed + ' / ' + job.total + ' 项';
    $('#importProgress').value = job.completed + (fraction || 0);
    if (job.kind === 'paste') $('#pasteStatus').textContent = message;
  }
  function cancelImport() {
    var job = state.importJob;
    if (!job) return;
    state.importJob = null;
    state.generation++;
    job.controller.abort();
    job.records.forEach(function (f) {
      if (['pending', 'reading', 'parsing'].indexOf(f.status) >= 0) { f.status = 'cancelled'; f.detail = '未导入'; }
    });
    $('#importProgress').value = job.completed;
    $('#importStatus').textContent = '导入已取消 · 已完成 ' + job.completed + ' / ' + job.total + ' 项；已成功导入的服务器保留在列表中。';
    if (job.kind === 'paste') $('#pasteStatus').textContent = '已取消，粘贴内容仍保留。';
    renderFiles();
    syncBusyUI();
  }
  function finishImport(job) {
    if (!currentImport(job)) return;
    state.importJob = null;
    var message = '导入完成：新增 ' + job.added + ' 台，保守合并 ' + job.merged + ' 台' + (job.failed ? '，失败 ' + job.failed + ' 项' : '');
    $('#importProgress').value = job.completed;
    $('#importStatus').textContent = message + ' · ' + job.completed + ' / ' + job.total + ' 项已处理';
    if (job.kind === 'paste') $('#pasteStatus').textContent = message;
    renderFiles();
    syncBusyUI();
    toast(message, job.failed > 0);
  }
  function readFile(file, job) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader(), signal = job.controller.signal;
      function cleanup() { signal.removeEventListener('abort', abort); }
      function abortError() { var e = new Error('导入已取消'); e.name = 'AbortError'; return e; }
      function abort() {
        if (reader.readyState === 1) reader.abort();
        else { cleanup(); reject(abortError()); }
      }
      reader.onload = function () { cleanup(); resolve(String(reader.result || '')); };
      reader.onerror = function () { cleanup(); reject(new Error('文件读取失败，请重新选择文件')); };
      reader.onabort = function () { cleanup(); reject(abortError()); };
      reader.onprogress = function (e) {
        if (currentImport(job) && e.lengthComputable) $('#importProgress').value = job.completed + 0.45 * e.loaded / e.total;
      };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) { abort(); return; }
      reader.readAsText(file);
    });
  }
  async function importText(text, name, job, record) {
    checkImport(job);
    if (new Blob([text]).size > B.MAX_IMPORT_BYTES) throw new Error('单项内容不能超过 20 MiB');
    if (!text.trim()) throw new Error('内容为空');
    var fmt = B.detect(text, name), parsed;
    record.format = fmt || 'quick';
    record.status = 'parsing'; record.detail = '正在解析';
    renderFiles();
    setImportPhase(job, '正在解析：' + name, 0.55);
    if (fmt && B.IMPORT_FORMATS.indexOf(fmt) >= 0) {
      parsed = await B.parse(text, fmt, { signal: job.controller.signal });
    } else {
      parsed = { servers: B.parseQuickText(text), context: null };
    }
    checkImport(job);
    if (!parsed.servers.length) throw new Error('没有识别到服务器，请检查格式和内容');
    var incoming = B.normalize(parsed.servers);
    incoming.forEach(function (s) { s._selected = true; s._open = false; });
    // 在副本上合并和校验，失败时不留下部分修改。
    var result = B.mergeServerLists(B.normalize(state.servers), incoming);
    var next = B.normalize(result.servers);
    if (next.length > B.MAX_SERVERS) throw new Error('服务器总数不能超过 ' + B.MAX_SERVERS + ' 台');
    checkImport(job);
    state.servers = next;
    if (parsed.context && !state.contexts.some(function (c) { return c.id === parsed.context.id; })) {
      state.contexts.push(parsed.context);
      record.contextId = parsed.context.id;
    }
    record.format = parsed.meta && parsed.meta.format || fmt || 'quick';
    record.status = 'success';
    record.detail = incoming.length + ' 台 · 新增 ' + result.added + ' / 合并 ' + result.merged;
    job.added += result.added; job.merged += result.merged;
    render();
    return result;
  }
  async function handleFiles(snapshot) {
    if (!snapshot.length || busy()) { if (snapshot.length) toast('请先完成或取消当前操作', true); return; }
    var records = snapshot.map(function (file) { return { name: file.name, status: 'pending', detail: '等待处理', format: '' }; });
    var job = beginImport(snapshot.length, 'files', records);
    if (!job) return;
    for (var i = 0; i < snapshot.length; i++) {
      if (!currentImport(job)) return;
      var file = snapshot[i], record = records[i];
      try {
        if (file.size > B.MAX_IMPORT_BYTES) throw new Error('文件超过 20 MiB 上限，未读取');
        record.status = 'reading'; record.detail = '正在读取';
        renderFiles(); setImportPhase(job, '正在读取：' + file.name);
        var text = await readFile(file, job);
        checkImport(job);
        await importText(text, file.name, job, record);
      } catch (e) {
        if (!currentImport(job)) return;
        record.status = 'error'; record.detail = e && e.message ? e.message : '导入失败'; job.failed++;
      }
      if (!currentImport(job)) return;
      job.completed++;
      renderFiles(); setImportPhase(job, (record.status === 'error' ? '失败：' : '成功：') + file.name);
    }
    finishImport(job);
  }
  async function handlePaste() {
    if (!canMutate() || !state.dialog || state.dialog.closing) return;
    var text = $('#pasteText').value;
    if (!text.trim()) { $('#pasteError').textContent = '请先粘贴内容'; $('#pasteText').focus(); return; }
    $('#pasteError').textContent = ''; $('#pasteText').removeAttribute('aria-invalid');
    var record = { name: '粘贴内容', status: 'pending', detail: '等待处理', format: '' };
    var job = beginImport(1, 'paste', [record]);
    if (!job) return;
    try {
      await importText(text, '粘贴内容', job, record);
      if (!currentImport(job)) return;
      job.completed = 1;
      $('#pasteText').value = '';
      finishImport(job);
      closeDialog('complete');
    } catch (e) {
      if (!currentImport(job)) return;
      record.status = 'error'; record.detail = e && e.message ? e.message : '导入失败';
      job.failed = 1; job.completed = 1;
      finishImport(job);
      $('#pasteError').textContent = record.detail;
      $('#pasteText').setAttribute('aria-invalid', 'true');
      $('#pasteText').focus();
    }
  }

  /* 对话框统一管理焦点、Escape、键盘循环以及关闭后的焦点恢复。 */
  function focusable(mask) {
    return Array.from(mask.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(function (el) {
      return !el.hidden && !el.closest('[hidden], [inert]') && el.getClientRects().length > 0;
    });
  }
  function finalizeDialog(dialog) {
    // Only the current lifecycle can hide a sheet or release the workspace.
    if (state.dialog !== dialog) return;
    state.dialog = null;
    clearTimeout(dialog.closeTimer);
    (dialog.animations || []).forEach(function (animation) { animation.cancel(); });
    (dialog.disabledControls || []).forEach(function (x) { x.el.disabled = x.disabled; });
    dialog.mask.classList.remove('show', 'leaving');
    dialog.mask.hidden = true;
    $('#workspace').inert = false;
    $('#workspace').removeAttribute('aria-hidden');
    document.body.classList.remove('dialog-open');
    syncBusyUI();
    var target = dialog.returnFocus;
    if (!target || !target.isConnected || target.disabled) target = $('#search');
    target.focus({ preventScroll: true });
    dialog.mask.setAttribute('aria-hidden', 'true');
  }
  function prepareDialogOpen() {
    if (state.dialog && state.dialog.closing) finalizeDialog(state.dialog);
    return !state.dialog;
  }
  function openDialog(mask, focusTarget) {
    if (!prepareDialogOpen()) return;
    state.dialog = { mask: mask, returnFocus: document.activeElement, closing: false, animations: [] };
    mask.classList.remove('leaving');
    mask.hidden = false; mask.setAttribute('aria-hidden', 'false'); mask.classList.add('show');
    document.body.classList.add('dialog-open');
    syncBusyUI();
    (focusTarget || focusable(mask)[0] || mask.querySelector('.modal')).focus({ preventScroll: true });
    $('#workspace').inert = true;
    $('#workspace').setAttribute('aria-hidden', 'true');
  }
  function closeDialog(reason) {
    if (!state.dialog || state.dialog.closing) return;
    var dialog = state.dialog;
    dialog.disabledControls = Array.from(dialog.mask.querySelectorAll('button, input, select, textarea')).map(function (el) {
      return { el: el, disabled: el.disabled };
    });
    // Cancellation is immediate, never delayed until the visual exit finishes.
    dialog.closing = true;
    if (reason !== 'complete' && dialog.mask.id === 'modal' && state.importJob && state.importJob.kind === 'paste') cancelImport();
    if (dialog.mask.id === 'exportModal') {
      if (reason !== 'complete' && state.exportJob) {
        state.exportJob.cancelled = true;
        state.exportJob.controller.abort();
      }
      state.exportModel = null;
    }
    if (state.exportBusy) {
      $('#importPanel').hidden = false;
      $('#importStatus').textContent = '下载已取消，正在结束本地生成操作。';
      $('#importProgress').removeAttribute('value');
    }
    var sheet = dialog.mask.querySelector('.modal');
    var maskStyle = getComputedStyle(dialog.mask), sheetStyle = getComputedStyle(sheet);
    var maskOpacity = maskStyle.opacity, sheetOpacity = sheetStyle.opacity, sheetTransform = sheetStyle.transform;
    sheet.focus({ preventScroll: true });
    dialog.disabledControls.forEach(function (x) { x.el.disabled = true; });
    dialog.mask.classList.add('leaving');
    syncBusyUI();
    if (motionQuery.matches || !dialog.mask.animate || !sheet.animate) { finalizeDialog(dialog); return; }
    dialog.animations = [
      dialog.mask.animate([{ opacity: maskOpacity }, { opacity: 0 }], { duration: 220, easing: 'ease-out', fill: 'both' }),
      sheet.animate([{ opacity: sheetOpacity, transform: sheetTransform }, { opacity: 0, transform: 'translateY(16px) scale(.975)' }],
        { duration: 220, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'both' })
    ];
    dialog.closeTimer = setTimeout(function () { finalizeDialog(dialog); }, 360);
    Promise.all(dialog.animations.map(function (animation) { return animation.finished; })).then(function () {
      finalizeDialog(dialog);
    }, function () { if (state.dialog === dialog && dialog.closing) finalizeDialog(dialog); });
  }

  /* Decorative effects are optional, memory-only and suspended outside the viewport. */
  function syncEffectsUI() {
    var reduced = motionQuery.matches, paused = reduced || state.effectsPaused;
    document.body.classList.toggle('effects-paused', paused);
    document.body.classList.toggle('page-hidden', document.hidden);
    var button = $('#motionBtn');
    button.disabled = reduced;
    button.setAttribute('aria-pressed', String(paused));
    button.setAttribute('aria-label', reduced ? '系统已启用减少动画，流光动效已关闭' : (paused ? '恢复背景与边框的流光动效' : '暂停背景与边框的流光动效'));
    button.title = reduced ? '遵循系统的减少动画设置' : '只控制装饰流光，不影响导入、编辑或导出；刷新后恢复默认';
    $('#motionLabel').textContent = reduced ? '已减少动效' : (paused ? '恢复流光' : '暂停流光');
    $('#motionIcon').innerHTML = paused ? '<path d="m7 4 8 6-8 6Z"/>' : '<path d="M7 4v12M13 4v12"/>';
  }
  function bindEffects() {
    $('#motionBtn').addEventListener('click', function () {
      if (motionQuery.matches) return;
      state.effectsPaused = !state.effectsPaused;
      syncEffectsUI();
    });
    document.addEventListener('visibilitychange', syncEffectsUI);
    function changed() {
      if (motionQuery.matches) {
        Array.from(cardMotions.values()).forEach(function (motion) { motion.finish(); });
        if (state.dialog && state.dialog.closing) finalizeDialog(state.dialog);
      }
      syncEffectsUI();
    }
    if (motionQuery.addEventListener) motionQuery.addEventListener('change', changed);
    else if (motionQuery.addListener) motionQuery.addListener(changed);
    if (globalThis.IntersectionObserver) {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) { entry.target.classList.toggle('fx-sleep', !entry.isIntersecting); });
      }, { rootMargin: '120px' });
      document.querySelectorAll('[data-glow]').forEach(function (el) { observer.observe(el); });
    }
    syncEffectsUI();
  }

  /* 导出范围只取勾选状态，完整模式必须能够唯一匹配同格式原始文档。 */
  function exportOptions(fmt, mode) {
    var selected = selectedServers();
    var candidates = state.contexts.filter(function (c) {
      return c.format === fmt && selected.length > 0 && selected.every(function (s) {
        return (s._sources || []).indexOf(c.id) >= 0;
      });
    });
    return {
      options: { mode: mode, context: candidates.length === 1 ? candidates[0] : undefined, selectedOnly: true },
      candidates: candidates.length
    };
  }
  function exportRisk(fmt, mode) {
    var text;
    if (fmt === 'wwmobile') text = '已核对 WWPlayer Android 0.4.9 的 schemaVersion 2 便携备份：可以迁移用户名 / User ID，但没有 password / accessToken 字段。标记包含凭据会被拒绝，额外密码字段会被忽略；导入后需重新认证。其它版本的兼容性仍需单独验证。';
    else if (fmt === 'afusekt') text = 'AfuseKt 明文保存用户名与密码，不保存 User ID / Access Token。请把导出文件当作凭据文件保管。';
    else if (fmt === 'bridge' || fmt === 'csv') text = '该格式是明文，会保存密码与 Access Token 等凭据。不要公开分享、上传或发给第三方。';
    else text = '该格式可能保存密码、Access Token 或可逆的授权数据；加密或混淆不等于可以安全分享。请像密码文件一样保管。';
    if (mode === 'full') text += ' 完整备份还会保留这份原始文档的设置、历史或其他私密数据；只应在确需同格式往返时使用。';
    return text;
  }
  function updateExportReport(resetConfirmation) {
    var model = state.exportModel;
    if (!model) return;
    var resolved = exportOptions(model.format, model.mode);
    var report = B.inspectExport(state.servers, model.format, resolved.options);
    report = Object.assign({}, report, { errors: report.errors.slice(), warnings: report.warnings.slice() });
    if (model.mode === 'full' && resolved.candidates !== 1) {
      report.errors.push(resolved.candidates > 1 ? '完整备份对应多份同格式来源，无法唯一选择。请只使用一份原始备份。' :
        '无法匹配完整备份来源：需要从同一份目标格式备份完整选中服务器，不能混入其他来源、新增或删减。');
      report.ok = false;
    }
    model.report = report; model.options = resolved.options;
    var key = JSON.stringify([model.format, model.mode, selectedServers().map(function (s) { return s.id; }),
      resolved.options.context && resolved.options.context.id, report.warnings]);
    if (resetConfirmation || key !== model.warningKey) $('#exportConfirm').checked = false;
    model.warningKey = key;
    $('#exportSelection').textContent = '已选 ' + report.selectedCount + ' / 共 ' + state.servers.length + ' 台 · 搜索不改变导出范围';
    $('#exportModeSummary').textContent = '导出模式：' + (model.mode === 'full' ? '完整备份（同格式往返）' : '仅选中的服务器（默认）');
    $('#exportRisk').textContent = exportRisk(model.format, model.mode);
    var source = resolved.options.context;
    var sourceFile = source && state.files.find(function (f) { return f.contextId === source.id; });
    $('#exportSource').textContent = model.mode === 'full' ? '原始文档：' + (source ? (sourceFile ? sourceFile.name : formatLabel(source.format) + ' 备份') : '未能唯一匹配') :
      '仅输出服务器；不会附带原备份的设置或播放历史。';
    $('#exportErrors').innerHTML = report.errors.length ? '<h4>无法生成，请先处理</h4><ul>' + report.errors.map(function (s) {
      return '<li>' + esc(s) + '</li>';
    }).join('') + '</ul>' : '<p>预检通过，没有阻止生成的错误。</p>';
    $('#exportErrors').classList.toggle('has-errors', report.errors.length > 0);
    $('#exportWarnings').innerHTML = report.warnings.length ? '<h4>兼容性与数据警告</h4><ul>' + report.warnings.map(function (s) {
      return '<li>' + esc(s) + '</li>';
    }).join('') + '</ul>' : '<p>预检没有额外兼容性警告；仍请保留原始备份并妥善保管凭据。</p>';
    $('#exportConfirmWrap').hidden = !report.warnings.length;
    syncBusyUI();
  }
  function openExport(fmt) {
    if (!canMutate() || !prepareDialogOpen()) return;
    state.exportModel = { format: fmt, mode: 'servers', report: null, warningKey: '' };
    $('#exportTitle').textContent = '导出为 ' + formatLabel(fmt);
    $('#exportModeServers').checked = true; $('#exportModeFull').checked = false;
    $('#fullModeHint').textContent = fullFormats.indexOf(fmt) < 0 ? '此格式仅支持服务器导出。' :
      '完整模式要求一份同格式原始备份、全部服务器和单一来源；Hills 仅支持 v2。';
    $('#exportStatus').textContent = '';
    updateExportReport(true);
    openDialog($('#exportModal'), $('#exportModeServers'));
  }
  async function generateExport() {
    if (!canMutate() || !state.exportModel) return;
    updateExportReport(false);
    var model = state.exportModel, report = model.report;
    if (!report.ok) { $('#exportErrors').focus(); return; }
    if (report.warnings.length && !$('#exportConfirm').checked) { $('#exportConfirm').focus(); return; }
    var job = { generation: state.generation, cancelled: false, controller: new AbortController() };
    state.exportJob = job; state.exportBusy = true;
    $('#exportStatus').textContent = '正在本地生成文件，请稍候。取消会阻止下载。';
    syncBusyUI();
    var downloaded = false, out;
    try {
      out = await B.build(state.servers, model.format, Object.assign({}, model.options, { signal: job.controller.signal }));
      if (job.cancelled || state.exportModel !== model || state.generation !== job.generation) return;
      var blob = new Blob([out.text], { type: out.mime });
      var url = URL.createObjectURL(blob), a = document.createElement('a');
      try {
        a.href = url; a.download = out.filename; document.body.appendChild(a); a.click();
        downloaded = true;
      } finally {
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      }
    } catch (e) {
      if (!job.cancelled && state.exportModel === model) {
        $('#exportStatus').textContent = '生成失败：' + (e && e.message ? e.message : '未知错误');
        toast('导出失败，请查看弹窗中的错误', true);
      }
    } finally {
      if (state.exportJob === job) {
        state.exportJob = null; state.exportBusy = false;
        if (job.cancelled) {
          $('#importProgress').max = 1; $('#importProgress').value = 0;
          $('#importStatus').textContent = '导出已取消，没有下载文件；可以继续编辑或导入。';
        }
        syncBusyUI();
      }
    }
    if (downloaded && state.exportModel === model) {
      closeDialog('complete');
      toast('已生成 ' + out.filename + ' · ' + report.selectedCount + ' 台 · ' + (out.mode === 'full' ? '完整备份' : '仅服务器'));
    }
  }

  function bind() {
    var drop = $('#drop'), input = $('#fileInput'), dragDepth = 0;
    function pickFiles() { if (canMutate()) input.click(); }
    drop.addEventListener('click', function (e) { if (!e.target.closest('button')) pickFiles(); });
    drop.addEventListener('keydown', function (e) {
      if (e.target === drop && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pickFiles(); }
    });
    $('#pickBtn').addEventListener('click', function (e) { e.stopPropagation(); pickFiles(); });
    input.addEventListener('change', function () {
      // FileList 只在事件入口快照一次，重置文件框后不再读取活对象。
      var snapshot = Array.prototype.slice.call(input.files || []);
      input.value = '';
      if (snapshot.length) handleFiles(snapshot);
    });
    drop.addEventListener('dragenter', function (e) { e.preventDefault(); dragDepth++; if (!busy()) drop.classList.add('hover'); });
    drop.addEventListener('dragover', function (e) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = busy() ? 'none' : 'copy'; });
    drop.addEventListener('dragleave', function (e) { e.preventDefault(); dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) drop.classList.remove('hover'); });
    drop.addEventListener('drop', function (e) {
      e.preventDefault(); dragDepth = 0; drop.classList.remove('hover');
      var snapshot = Array.prototype.slice.call(e.dataTransfer ? e.dataTransfer.files : []);
      if (snapshot.length) handleFiles(snapshot);
    });
    document.addEventListener('dragover', function (e) { e.preventDefault(); });
    document.addEventListener('drop', function (e) { e.preventDefault(); });
    $('#importCancel').addEventListener('click', function () {
      cancelImport(); $('#pickBtn').focus({ preventScroll: true });
      toast('已取消导入；成功导入的项目仍保留');
    });

    $('#search').addEventListener('input', function (e) { state.filter = e.target.value; state.page = 1; render(); });
    $('#prevPage').addEventListener('click', function () { state.page--; render(); });
    $('#nextPage').addEventListener('click', function () { state.page++; render(); });
    $('#addBtn').addEventListener('click', function () {
      if (!canMutate()) return;
      if (state.servers.length >= B.MAX_SERVERS) { toast('服务器总数不能超过 ' + B.MAX_SERVERS + ' 台', true); return; }
      var s = B.normalize([B.emptyServer({ name: '新服务器', _sources: [], _selected: true, _open: true })])[0];
      B.setPrimaryUrl(s, '');
      state.servers = B.normalize(state.servers.concat(s));
      state.filter = ''; $('#search').value = ''; state.page = Math.ceil(state.servers.length / state.pageSize);
      render({ focus: { sid: s.id, field: 'name' }, animateId: s.id });
    });
    $('#pasteBtn').addEventListener('click', function () {
      if (!canMutate() || !prepareDialogOpen()) return;
      $('#pasteStatus').textContent = '';
      openDialog($('#modal'), $('#pasteText'));
    });
    $('#modalCancel').addEventListener('click', function () { closeDialog('cancel'); });
    $('#modalOk').addEventListener('click', handlePaste);
    $('#pasteText').addEventListener('input', function () {
      $('#pasteError').textContent = ''; $('#pasteText').removeAttribute('aria-invalid'); syncBusyUI();
    });
    $('#dedupeBtn').addEventListener('click', function () {
      if (!canMutate()) return;
      var before = state.servers.length;
      try {
        state.servers = B.normalize(B.dedupe(B.normalize(state.servers))); render();
        toast('保守去重完成：合并 ' + (before - state.servers.length) + ' 条；凭据冲突或身份歧义的项目不会覆盖。');
      } catch (e) { toast(e.message, true); }
    });
    $('#selectAll').addEventListener('click', function () {
      if (!canMutate()) return;
      var all = state.servers.every(function (s) { return s._selected !== false; });
      state.servers.forEach(function (s) { s._selected = !all; }); render();
    });
    $('#expandAll').addEventListener('click', function () {
      if (!canMutate()) return;
      var items = view().items, anyClosed = items.some(function (x) { return !x.s._open; });
      items.forEach(function (x) { setServerOpen(x.s, anyClosed); });
      updateExpandLabel();
    });
    $('#secretBtn').addEventListener('click', function () {
      if (!canMutate()) return;
      state.showSecrets = !state.showSecrets;
      $('#serverList').querySelectorAll('[data-secret]').forEach(function (el) { el.type = state.showSecrets ? 'text' : 'password'; });
      syncBusyUI();
    });
    $('#clearBtn').addEventListener('click', function () {
      if (state.exportBusy) { toast('请先结束当前导出', true); return; }
      if (!confirm('确定清空服务器、导入记录和粘贴内容？当前导入会取消。只清空页面内存，不会删除电脑上的任何文件。')) return;
      cancelImport(); state.generation++;
      state.servers = []; state.files = []; state.contexts = []; state.filter = ''; state.page = 1; state.showSecrets = false;
      $('#search').value = ''; $('#pasteText').value = ''; $('#pasteError').textContent = ''; $('#pasteStatus').textContent = '';
      $('#pasteText').removeAttribute('aria-invalid'); $('#importPanel').hidden = true;
      $('#importStatus').textContent = '页面内存已清空';
      renderFiles(); render(); $('#pickBtn').focus({ preventScroll: true });
      toast('已清空页面内存，原始文件未改动');
    });

    function editField(el) {
      if (busy()) return;
      var s = serverById(el.dataset.sid);
      if (!s) return;
      var card = cardById(s.id);
      if (el.dataset.lineId) {
        var line = s.lines.find(function (l) { return l.id === el.dataset.lineId; });
        if (!line) return;
        if (hasLineBreak(line[el.dataset.lineField])) { el.value = inputDisplay(line[el.dataset.lineField]); return; }
        if (el.dataset.lineField === 'url') {
          B.setLineUrl(s, line.id, el.value);
          if (line.id === s.primaryLineId) {
            var mainInput = card.querySelector('[data-field="url"]');
            if (mainInput) mainInput.value = s.url;
          }
        } else if (el.dataset.lineField === 'name') {
          line.name = el.value;
          var radio = el.closest('.line-row').querySelector('[data-act="active"]');
          radio.setAttribute('aria-label', '将 ' + (line.name || '线路') + ' 设为活动线路');
        }
      } else if (el.dataset.field) {
        if (hasLineBreak(s[el.dataset.field])) { el.value = inputDisplay(s[el.dataset.field]); return; }
        if (el.dataset.field === 'url') {
          var countBefore = s.lines.length;
          B.setPrimaryUrl(s, el.value);
          card.querySelectorAll('[data-line-field="url"]').forEach(function (x) { if (x.dataset.lineId === s.primaryLineId) x.value = s.url; });
          if (s.lines.length !== countBefore) { render(); return; }
        } else s[el.dataset.field] = el.value;
      }
      updateCardMeta(s, card);
    }
    $('#serverList').addEventListener('input', function (e) { if (e.target.matches('[data-field], [data-line-field]')) editField(e.target); });
    $('#serverList').addEventListener('change', function (e) {
      var el = e.target, s = serverById(el.dataset.sid);
      if (!s || busy()) return;
      if (el.dataset.act === 'sel') {
        s._selected = el.checked; cardById(s.id).classList.toggle('selected', el.checked); fmtCount();
      } else if (el.dataset.act === 'active' && el.checked) {
        B.setActiveLine(s, el.dataset.lineId);
        cardById(s.id).querySelectorAll('[data-act="active"]').forEach(function (radio) { radio.checked = radio.dataset.lineId === s.activeLineId; });
      } else if (el.tagName === 'SELECT') editField(el);
    });
    $('#serverList').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn || btn.dataset.act === 'sel' || btn.dataset.act === 'active' || !canMutate()) return;
      var s = serverById(btn.dataset.sid);
      if (!s) return;
      var act = btn.dataset.act;
      if (act === 'toggle') { setServerOpen(s, !s._open); updateExpandLabel(); }
      else if (act === 'del') { state.servers = state.servers.filter(function (x) { return x.id !== s.id; }); render(); }
      else if (act === 'addline') {
        try {
          var oldIds = new Set(s.lines.map(function (l) { return l.id; }));
          var next = B.normalize([Object.assign({}, s, { lines: s.lines.concat({ name: '备用线路', url: '', active: false, raw: {} }) })])[0];
          state.servers = state.servers.map(function (x) { return x.id === s.id ? next : x; });
          var added = next.lines.find(function (l) { return !oldIds.has(l.id); });
          render({ focus: { sid: s.id, lineId: added.id, lineField: 'name' } });
        } catch (err) { toast(err.message, true); }
      } else if (act === 'rmline') {
        if (btn.dataset.lineId === s.primaryLineId) { toast('主线路不能删除，请修改主地址', true); return; }
        var wasActive = btn.dataset.lineId === s.activeLineId;
        s.lines = s.lines.filter(function (l) { return l.id !== btn.dataset.lineId; });
        B.setActiveLine(s, wasActive ? s.primaryLineId : s.activeLineId);
        render({ focus: { sid: s.id, lineId: s.primaryLineId, act: 'active' } });
      }
    });

    document.querySelectorAll('[data-export]').forEach(function (b) { b.addEventListener('click', function () { openExport(b.dataset.export); }); });
    document.querySelectorAll('[name="exportMode"]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        if (!state.exportModel || busy() || !radio.checked) return;
        state.exportModel.mode = radio.value; $('#exportStatus').textContent = ''; updateExportReport(true);
      });
    });
    $('#exportConfirm').addEventListener('change', syncBusyUI);
    $('#exportOk').addEventListener('click', generateExport);
    $('#exportCancel').addEventListener('click', function () { closeDialog('cancel'); });
    ['#modal', '#exportModal'].forEach(function (selector) {
      $(selector).addEventListener('click', function (e) { if (e.target === $(selector)) closeDialog('cancel'); });
    });
    document.addEventListener('keydown', function (e) {
      if (!state.dialog) return;
      if (e.key === 'Escape') { e.preventDefault(); closeDialog('cancel'); return; }
      if (e.key !== 'Tab') return;
      var nodes = focusable(state.dialog.mask), first = nodes[0], last = nodes[nodes.length - 1];
      if (!first) { e.preventDefault(); state.dialog.mask.querySelector('.modal').focus(); }
      else if (e.shiftKey && (document.activeElement === first || !state.dialog.mask.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !state.dialog.mask.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    });
    document.addEventListener('focusin', function (e) {
      if (state.dialog && !state.dialog.mask.contains(e.target)) (focusable(state.dialog.mask)[0] || state.dialog.mask.querySelector('.modal')).focus();
    });
    if (!globalThis.crypto || !globalThis.crypto.subtle) toast('当前环境缺少 Web Crypto，请改用本地 HTTP 预览或新版浏览器', true);
  }
  document.addEventListener('DOMContentLoaded', function () { bindEffects(); bind(); renderFiles(); render(); });
})();
