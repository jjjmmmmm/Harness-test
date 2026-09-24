/* app.js — D3 复核台 · 界面与交互
 * 只读 runs/ 里的文件；复核标注存在浏览器本地（IndexedDB / localStorage），不写用户的任何文件。
 * 依赖 parse.js（window.DP）。 */
(function () {
  'use strict';

  const DP = window.DP;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s === null || s === undefined ? '' : s)
    .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ───────────────────────────── 状态 ───────────────────────────── */

  const S = {
    batches: [],          // 已导入批次（含全量数据）
    activeId: null,
    filter: { model: 'ALL', group: 'ALL', task: 'ALL', verdict: 'ALL', mark: 'ALL', q: '' },
    view: [],             // 筛选后的 run 指针数组
    cur: 0,
    tab: 'overview',
    marks: {},            // `${batchId}#${seq}` -> {verdict,label,note}
    collapsed: new Set(),
    openFile: null,
    fileMode: 'text',
    theme: 'auto',
    storageOk: true,
    autoNext: false,
  };

  const TABS = [
    { id: 'overview', name: '概要', key: '1' },
    { id: 'trace', name: '轨迹', key: '2' },
    { id: 'files', name: '文件', key: '3' },
    { id: 'check', name: '核对', key: '4' },
  ];

  const VERDICTS = ['未核', '标签属实', '标签有误', '存疑'];
  const LABELS = ['', '通过', '假完成', '认输', '产物错误', 'MAX-TURNS'];
  const LS = { marks: 'd3review.marks', theme: 'd3review.theme', last: 'd3review.lastBatch', autoNext: 'd3review.autoNext' };

  const batch = () => S.batches.find((b) => b.id === S.activeId) || null;
  const runs = () => { const b = batch(); return b ? b.runs : []; };
  const runAt = (i) => { const v = S.view; return v.length ? v[Math.max(0, Math.min(v.length - 1, i))] : null; };
  const curRun = () => runAt(S.cur);
  const markKey = (r) => (batch() ? batch().id : '?') + '#' + r.seq;
  let pendingFlush = null; // 当前面板里「未落盘的备注」的收口函数
  const getMark = (r) => S.marks[markKey(r)] || null;
  const setMark = (r, m) => {
    const k = markKey(r);
    if (!m || (!m.verdict || m.verdict === '未核') && !m.label && !m.note) delete S.marks[k];
    else S.marks[k] = m;
    saveMarks();
  };

  /* ───────────────────────────── 本地存储 ───────────────────────────── */

  function saveMarks() { try { localStorage.setItem(LS.marks, JSON.stringify(S.marks)); } catch (e) { /* 空间不足就只放在内存里 */ } }
  function loadMarks() { try { S.marks = JSON.parse(localStorage.getItem(LS.marks) || '{}') || {}; } catch (e) { S.marks = {}; } }

  let dbp = null;
  function idb() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      if (!('indexedDB' in window)) return rej(new Error('no idb'));
      const rq = indexedDB.open('d3-review', 1);
      rq.onupgradeneeded = () => { if (!rq.result.objectStoreNames.contains('batches')) rq.result.createObjectStore('batches', { keyPath: 'id' }); };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error || new Error('idb error'));
      rq.onblocked = () => rej(new Error('idb blocked'));
      setTimeout(() => rej(new Error('idb timeout')), 4000);
    });
    return dbp;
  }
  const store = {
    async put(obj) { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction('batches', 'readwrite'); tx.objectStore('batches').put(obj); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); },
    async all() { const db = await idb(); return new Promise((res, rej) => { const rq = db.transaction('batches', 'readonly').objectStore('batches').getAll(); rq.onsuccess = () => res(rq.result || []); rq.onerror = () => rej(rq.error); }); },
    async del(id) { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction('batches', 'readwrite'); tx.objectStore('batches').delete(id); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); },
  };

  /* ───────────────────────────── 代码 / 文本渲染 ───────────────────────────── */

  const KWR = /\b(import|from|as|def|return|if|elif|else|for|while|in|not|and|or|is|None|True|False|try|except|finally|with|raise|lambda|global|class|pass|break|continue|yield|assert|del|async|await)\b|\b(open|print|len|sum|range|list|dict|set|str|int|float|repr|enumerate|sorted|zip|map|filter|all|any|min|max|abs|round|getattr|isinstance|type|join|split|read|write|exists|listdir|walk|expanduser|getcwd|os|re|sys|json|collections|Counter|subprocess|Path)\b|(\b\d+(?:\.\d+)?\b)/g;

  function hlPlain(s) {
    let out = '', last = 0, m;
    KWR.lastIndex = 0;
    while ((m = KWR.exec(s)) !== null) {
      out += esc(s.slice(last, m.index));
      const cls = m[1] ? 'tok-kw' : (m[2] ? '' : 'tok-num');
      out += cls ? '<span class="' + cls + '">' + esc(m[0]) + '</span>' : esc(m[0]);
      last = m.index + m[0].length;
    }
    return out + esc(s.slice(last));
  }

  function hlPy(code) {
    let out = '', i = 0;
    while (i < code.length) {
      const c = code[i];
      if (c === '#') {
        const e = code.indexOf('\n', i);
        const seg = e < 0 ? code.slice(i) : code.slice(i, e);
        out += '<span class="tok-com">' + esc(seg) + '</span>';
        i = e < 0 ? code.length : e;
      } else if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < code.length) {
          if (code[j] === '\\') { j += 2; continue; }
          if (code[j] === c) { j++; break; }
          if (code[j] === '\n') break;
          j++;
        }
        out += '<span class="tok-str">' + esc(code.slice(i, j)) + '</span>';
        i = j;
      } else {
        let j = i;
        while (j < code.length && code[j] !== '#' && code[j] !== '"' && code[j] !== "'") j++;
        out += hlPlain(code.slice(i, j));
        i = j;
      }
    }
    return out;
  }

  function codeBlock(code, extraCls) {
    const lines = String(code === null || code === undefined ? '' : code).split('\n');
    // 每行一个块级元素，块之间不能再有换行符（pre 会把源码换行也渲染出来 → 双倍行距）
    const body = lines.map((l, i) =>
      '<span class="cl"><span class="ln">' + (i + 1) + '</span>' + hlPy(l) + '</span>').join('');
    return '<div class="code ' + (extraCls || '') + '"><pre>' + body + '</pre></div>';
  }

  function outBlock(text) {
    const lines = String(text === null || text === undefined ? '' : text).split('\n');
    const body = lines.map((l) => (DP.ERR_RE.test(l.trim()) ? '<span class="eline">' + esc(l) + '</span>' : esc(l))).join('\n');
    return '<div class="out">' + body + '</div>';
  }

  function mdLite(text) {
    const lines = esc(text).split('\n');
    let out = '', inUl = false;
    const closeUl = () => { if (inUl) { out += '</ul>'; inUl = false; } };
    for (const raw of lines) {
      let l = raw.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
      const mU = /^\s*[-*•]\s+(.*)$/.exec(l);
      const mO = /^\s*\d+[.)、]\s*(.*)$/.exec(l);
      if (mU || mO) { if (!inUl) { out += '<ul>'; inUl = true; } out += '<li>' + (mU ? mU[1] : mO[1]) + '</li>'; continue; }
      if (/^\s*$/.test(l)) { closeUl(); continue; }
      closeUl();
      if (/^#{1,6}\s+/.test(l)) { out += '<h4>' + l.replace(/^#{1,6}\s+/, '') + '</h4>'; continue; }
      if (/^\s*(---|___|\*\*\*)\s*$/.test(l)) { out += '<hr>'; continue; }
      if (/^\s*&gt;\s?/.test(l)) { out += '<p class="mut">' + l.replace(/^\s*&gt;\s?/, '') + '</p>'; continue; }
      out += '<p>' + l + '</p>';
    }
    closeUl();
    return out;
  }

  /* ───────────────────────────── 导入 ───────────────────────────── */

  const SKIP_DIR = /^(\.git|\.mimosa|node_modules|__pycache__|\$RECYCLE\.BIN|System Volume Information|\.vscode|\.idea)$/i;
  const skipPath = (p) => String(p).split(/[\\/]/).slice(0, -1).some((seg) => SKIP_DIR.test(seg) || (seg.startsWith('.') && seg.length > 1));

  let importUI = null;
  function importBusy(total, done, label) {
    if (!importUI) { importUI = openModal('导入中', '<div class="progress"><div class="pline" id="ipLine">准备…</div><div class="pbar"><i id="ipBar" style="width:0"></i></div></div>', '', { narrow: true, closable: false }); }
    const l = $('ipLine'), b = $('ipBar');
    if (l) l.textContent = label;
    if (b) b.style.width = (total ? Math.round((done / total) * 100) : 8) + '%';
  }
  function importDone() { if (importUI) { importUI.close(); importUI = null; } }

  // entries: [{path, name, file}]
  async function importEntries(entries) {
    if (!entries.length) { toast('没有读到文件'); return; }
    const byDir = new Map();
    const jsonlFiles = [];
    for (const e of entries) {
      if (skipPath(e.path)) continue;
      if (/results\.jsonl$/i.test(e.name)) { jsonlFiles.push(e); continue; }
      const dir = DP.dirName(e.path);
      if (!byDir.has(dir)) byDir.set(dir, {});
      byDir.get(dir)[e.name] = e.file;
    }
    const runDirs = [...byDir.entries()].filter(([, f]) => f['trace.log']);
    if (!runDirs.length) { toast('没找到含 trace.log 的 run 目录'); return; }

    importBusy(runDirs.length + 1, 0, '读取 ' + runDirs.length + ' 个 run…');
    const built = [];
    let n = 0;
    for (const [dir, files] of runDirs) {
      const bytes = {};
      const names = Object.keys(files).sort((a, b) => (a === 'trace.log' ? -1 : b === 'trace.log' ? 1 : a.localeCompare(b))).slice(0, 40);
      for (const fn of names) {
        try { bytes[fn] = new Uint8Array(await files[fn].arrayBuffer()); } catch (e) { /* 读不了的跳过 */ }
      }
      built.push(DP.buildRun(dir, bytes));
      n++;
      if (n % 8 === 0 || n === runDirs.length) importBusy(runDirs.length + 1, n, '读取 ' + n + ' / ' + runDirs.length + ' 个 run…');
    }

    let jsonlRows = null, jsonlName = '';
    for (const j of jsonlFiles) {
      try {
        const txt = await j.file.text();
        const rows = txt.trim().split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
        if (!jsonlRows || rows.length > jsonlRows.length) { jsonlRows = rows; jsonlName = j.path; }
      } catch (e) { /* ignore */ }
    }
    importBusy(runDirs.length + 1, runDirs.length, '机械体检…');

    // 按共同的父目录分批次（一次拖进多个实验目录时各成一批）
    const groups = new Map();
    for (const r of built) {
      const root = DP.dirName(r.dir) || '(根)';
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(r);
    }
    const created = [];
    for (const [root, list] of groups) {
      // jsonl 只在与本组同一棵树时才拿来对齐编号
      const useJsonl = jsonlRows && (groups.size === 1 || jsonlName.startsWith(root + '/') || jsonlName.startsWith(root + '\\'));
      const b = DP.buildBatch(list, { jsonlRows: useJsonl ? jsonlRows : null });
      const id = 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const baseName = DP.baseName(root) || 'runs';
      let name = baseName, k = 2;
      while (S.batches.some((x) => x.name === name)) name = baseName + ' (' + (k++) + ')';
      const obj = {
        id, name, createdAt: Date.now(), source: root,
        jsonl: useJsonl ? { path: jsonlName, rows: jsonlRows } : null,
        runs: b.runs, stats: b.stats, checks: b.checks,
      };
      created.push(obj);
      S.batches.push(obj);
      try { await store.put(obj); } catch (e) { S.storageOk = false; }
    }
    importDone();
    const first = created.sort((a, b) => b.stats.total - a.stats.total)[0];
    setActive(first.id);
    const badParse = first.runs.filter((r) => !r.parseOk).length;
    const extra = created.length > 1 ? `（发现 ${created.length} 组 run 目录，各成一批）` : '';
    toast((badParse > first.stats.total / 2
      ? `⚠ ${badParse} / ${first.stats.total} 个 run 的 trace.log 读不出内容——确认选的是 d3 的 runs 目录`
      : `导入 ${first.stats.total} 个 run${extra}`) + (S.storageOk ? '' : '；本页无法持久化，重开页面需重新导入'));
  }

  async function importFromFiles(fileList) {
    const entries = [];
    for (const f of fileList) entries.push({ path: f.webkitRelativePath || f.name, name: f.name, file: f });
    await importEntries(entries);
  }

  function readEntry(entry, path, out) {
    return new Promise((resolve) => {
      if (entry.isFile) {
        entry.file((f) => { out.push({ path: path + entry.name, name: entry.name, file: f }); resolve(); }, () => resolve());
      } else if (entry.isDirectory) {
        if (SKIP_DIR.test(entry.name)) return resolve();
        const reader = entry.createReader();
        const all = [];
        const step = () => reader.readEntries((batch) => {
          if (!batch.length) {
            Promise.all(all.map((e) => readEntry(e, path + entry.name + '/', out))).then(resolve);
            return;
          }
          all.push(...batch);
          step();
        }, () => resolve());
        step();
      } else resolve();
    });
  }

  function walkEntry(entry) {
    const out = [];
    return readEntry(entry, '', out).then(() => out);
  }

  // 起本地服务时的便捷入口：ReviewUI.importPaths(['runs/run-001__DS__A__T1__r1/trace.log', ...])
  async function importPaths(paths) {
    const entries = [];
    const seen = new Set();
    for (const p of paths) {
      const dir = DP.dirName(p);
      if (seen.has(dir)) continue;
      seen.add(dir);
      const name = DP.baseName(p);
      try {
        const res = await fetch(p);
        const blob = await res.blob();
        entries.push({ path: p, name, file: new File([blob], name) });
      } catch (e) { /* ignore */ }
    }
    // 同一目录下的初始文件与产物也取来（起本地服务时的调试口子）
    const KNOWN = ['result.txt', 'data.txt', 'data1.txt', 'words.txt', 'numbers_backup.txt', 'equivalent.txt', 'badbytes.txt', 'numbers.txt'];
    const dirs = [...new Set(entries.map((e) => DP.dirName(e.path)))];
    for (const d of dirs) {
      for (const extra of KNOWN) {
        const p = d + '/' + extra;
        if (entries.some((e) => e.path === p)) continue;
        try {
          const res = await fetch(p);
          if (!res.ok) continue;
          entries.push({ path: p, name: extra, file: new File([await res.blob()], extra) });
        } catch (e) { /* ignore */ }
      }
    }
    await importEntries(entries);
  }

  /* ───────────────────────────── 视图：批次 / 筛选 / 列表 ───────────────────────────── */

  function setActive(id, opts) {
    S.activeId = id;
    S.collapsed = new Set();
    S.openFile = null;
    S.fileMode = 'text';
    try { localStorage.setItem(LS.last, id || ''); } catch (e) { /* ignore */ }
    applyFilter();
    if (!opts || !opts.keepPos) S.cur = 0;
    paint();
  }

  function computeView() {
    const f = S.filter;
    const b = batch();
    if (!b) { S.view = []; return; }
    const q = f.q.trim().toLowerCase();
    S.view = b.runs.filter((r) => {
      if (f.model !== 'ALL' && r.mtag !== f.model) return false;
      if (f.group !== 'ALL' && r.group !== f.group) return false;
      if (f.task !== 'ALL' && r.task !== f.task) return false;
      if (f.verdict === 'PASS' && r.passed !== true) return false;
      if (f.verdict === 'FAIL' && r.passed !== false) return false;
      if (f.mark === 'FORM' && !DP.FORM_NOTES[r.seq]) return false;
      if (f.mark === 'WARN' && !(r.warnings && r.warnings.length)) return false;
      if (f.mark === 'MARKED' && !getMark(r)) return false;
      if (f.mark === 'UNMARKED' && getMark(r)) return false;
      if (q) {
        const hay = [r.seq, r.key, r.mtag, r.model, r.groupLabel, r.task, 'r' + r.repeat, r.judge].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  const applyFilter = () => { computeView(); S.cur = Math.min(Math.max(0, S.cur), Math.max(0, S.view.length - 1)); };

  // 改筛选条件后重画：能留住当前这条就留住，留不住回到第一条
  function refilter(keepSeq) {
    applyFilter();
    if (keepSeq !== undefined) {
      const i = S.view.findIndex((r) => r.seq === keepSeq);
      S.cur = i >= 0 ? i : 0;
    }
    S.collapsed = new Set();
    S.openFile = null;
    paintFilters(); paintList(); paintHead(); paintTabs(); paintPane(); paintFoot();
  }

  function counts(dim) {
    const b = batch();
    const c = {};
    if (!b) return c;
    for (const r of b.runs) {
      let key = null;
      if (dim === 'model') key = r.mtag;
      else if (dim === 'group') key = r.group;
      else if (dim === 'task') key = r.task;
      else if (dim === 'verdict') key = r.passed === true ? 'PASS' : r.passed === false ? 'FAIL' : 'UNK';
      else if (dim === 'mark') {
        if (DP.FORM_NOTES[r.seq]) c.FORM = (c.FORM || 0) + 1;
        if (r.warnings && r.warnings.length) c.WARN = (c.WARN || 0) + 1;
        if (getMark(r)) c.MARKED = (c.MARKED || 0) + 1; else c.UNMARKED = (c.UNMARKED || 0) + 1;
        continue;
      }
      if (key) c[key] = (c[key] || 0) + 1;
    }
    return c;
  }

  function chipRow(label, dim, opts) {
    const c = counts(dim);
    const cur = S.filter[dim];
    const btn = (val, text) => {
      const n = dim === 'mark' && val === 'ALL' ? (batch() ? batch().runs.length : 0) : c[val];
      const show = (dim === 'mark' && val === 'ALL') ? '' : (n ? '<span class="c">' + n + '</span>' : '');
      return '<button class="chip" data-f="' + dim + '" data-v="' + esc(val) + '" aria-pressed="' + (cur === val) + '">' + esc(text) + show + '</button>';
    };
    return '<div class="fgroup"><label>' + esc(label) + '</label><div class="chips">' +
      opts.map((o) => btn(o[0], o[1])).join('') + '</div></div>';
  }

  function paintFilters() {
    const b = batch();
    if (!b) { $('filters').innerHTML = '<div class="note">尚未导入数据</div>'; return; }
    const st = b.stats;
    const models = [['ALL', '全部']].concat(st.models.map((m) => [m, m]));
    const groups = [['ALL', '全部'], ['A', 'A 完整'], ['B', 'B 截断']];
    const tasks = [['ALL', '全部']].concat(st.tasks.map((t) => [t, t]));
    const vers = [['ALL', '全部'], ['PASS', '通过'], ['FAIL', '不过']];
    const marks = [['ALL', '全部'], ['FORM', '表单列名'], ['WARN', '有异动'], ['MARKED', '已标注'], ['UNMARKED', '未标注']];
    $('filters').innerHTML =
      chipRow('模型', 'model', models) +
      chipRow('配置', 'group', groups) +
      chipRow('题', 'task', tasks) +
      chipRow('结论', 'verdict', vers) +
      chipRow('只看', 'mark', marks) +
      '<div class="fgroup"><label></label><input class="fld" id="q" placeholder="编号 / 模型 / 题 / 判分理由…" value="' + esc(S.filter.q) + '"></div>' +
      '<div class="note" style="margin-top:2px">批次 <b class="mono">' + esc(b.name) + '</b> · ' + st.total + ' 条 · ' + esc(b.source) + '</div>';
    const q = $('q');
    if (q) q.addEventListener('input', () => {
      S.filter.q = q.value;
      const keep = curRun();
      applyFilter();
      if (keep) { const i = S.view.findIndex((r) => r.seq === keep.seq); if (i >= 0) S.cur = i; }
      paintList(); paintHead(); paintTabs(); paintPane(); paintFoot();
    });
    $('filters').addEventListener('click', (e) => {
      const c = e.target.closest('.chip');
      if (!c || !c.dataset.f) return;
      const keep = curRun();
      S.filter[c.dataset.f] = c.dataset.v;
      refilter(keep ? keep.seq : undefined);
      const qi = $('q'); // 重画后搜索框是新节点，保持焦点与内容
      if (qi) { qi.value = S.filter.q; }
    });
  }

  function paintList() {
    const el = $('list');
    const st = batch() ? batch().stats : null;
    if (!st) { el.innerHTML = ''; return; }
    const head = '<div class="lhead"><span>序号 / 格·题·次</span><span>显示 ' + S.view.length + ' / ' + st.total + '</span></div>';
    const rows = S.view.map((r, i) => {
      const m = getMark(r);
      const flags = [];
      if (DP.FORM_NOTES[r.seq]) flags.push('<span class="flag ' + (DP.FORM_NOTES[r.seq].flag ? 'wn' : '') + '">' + (DP.FORM_NOTES[r.seq].flag ? '疑' : '表') + '</span>');
      if (r.warnings && r.warnings.length) flags.push('<span class="flag no">异</span>');
      if (m) flags.push('<span class="flag done">标</span>');
      return '<div class="row" data-i="' + i + '" data-seq="' + r.seq + '" aria-selected="' + (i === S.cur) + '">' +
        '<span class="seq">' + String(r.seq).padStart(3, '0') + '</span>' +
        '<span class="id">' + esc(r.mtag + '·' + r.group + '·' + r.task + '·r' + r.repeat) + '</span>' +
        '<span class="marks">' + flags.join('') + '<span class="st ' + (r.passed === true ? 'ok' : r.passed === false ? 'no' : '') + '"></span></span>' +
        '</div>';
    });
    el.innerHTML = head + (rows.length ? rows.join('') : '<div class="empty" style="margin:12px">当前筛选下没有 run</div>');
    const sel = el.querySelector('.row[aria-selected="true"]');
    if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' });
  }

  /* ───────────────────────────── 视图：主区头部 ───────────────────────────── */

  const GROUP_LABEL = { A: '完整报错', B: '截断' };

  function paintHead() {
    const el = $('rhead');
    const r = curRun();
    if (!r) { el.innerHTML = ''; return; }
    const st = batch().stats;
    const med = batch().checks.medianTokens || 0;
    const pct = med && r.tokens ? Math.min(100, Math.round((Math.log10(r.tokens) / Math.log10(batch().checks.maxTokens || r.tokens)) * 100)) : 0;
    const warn = (r.warnings || []).slice(0, 3);
    const note = DP.FORM_NOTES[r.seq];
    el.innerHTML =
      '<div class="line1">' +
        '<span class="rid">run-' + String(r.seq).padStart(3, '0') + '</span>' +
        '<span class="sep"></span>' +
        '<span class="tag mono">' + esc(r.mtag) + ' ' + esc(r.model || '') + '</span>' +
        '<span class="tag">' + esc(r.group) + ' · ' + esc(GROUP_LABEL[r.group] || r.groupLabel) + '</span>' +
        '<span class="tag mono">' + esc(r.task) + '</span>' +
        '<span class="tag plain mono">r' + r.repeat + '</span>' +
        (note ? '<span class="tag ' + (note.flag ? 'dot wn' : 'dot') + '">' + esc(note.flag || '表单') + '</span>' : '') +
        '<span class="stamp ' + (r.passed === true ? '' : r.passed === false ? 'no' : 'unk') + '">' + (r.passed === true ? '通过' : r.passed === false ? '不过' : '未判') + '</span>' +
        '<span class="metrics">' +
          '<span>步数 <b>' + (r.nSteps === null ? '—' : r.nSteps) + '</b></span>' +
          '<span>用时 <b>' + (r.elapsedS === null ? '—' : r.elapsedS + 's') + '</b></span>' +
          '<span>tokens <b>' + (r.tokens === null ? '—' : r.tokens.toLocaleString()) + '</b>' +
            (r.tokens ? '<span class="meter" title="相对本批最大 token（对数刻度）"><i style="width:' + pct + '%"></i></span>' : '') +
          '</span>' +
        '</span>' +
      '</div>' +
      (warn.length ? '<div class="warnline">' + warn.map((w) => '<span>⚑ ' + esc(w) + '</span>').join('') + '</div>' : '');
  }

  function paintTabs() {
    const el = $('tabs');
    if (!batch()) { el.innerHTML = '<div class="tab-ink" id="tabInk"></div>'; return; }
    const r = curRun();
    const countsBadge = { trace: r ? (r.steps.length + ' 步') : '', files: r ? (r.files.filter((f) => f.kind !== 'trace').length + ' 个') : '', check: (r && getMark(r)) ? '已标' : '' };
    el.innerHTML = TABS.map((t) =>
      '<button class="tab" role="tab" data-tab="' + t.id + '" aria-selected="' + (S.tab === t.id) + '" title="按 ' + t.key + ' 切换">' + t.name +
      (countsBadge[t.id] ? ' <span class="k">' + esc(countsBadge[t.id]) + '</span>' : '') + '</button>').join('') +
      '<div class="tab-ink" id="tabInk"></div>';
    const sel = el.querySelector('.tab[aria-selected="true"]');
    const ink = $('tabInk');
    if (sel && ink) { ink.style.width = sel.offsetWidth + 'px'; ink.style.transform = 'translateX(' + sel.offsetLeft + 'px)'; }
  }

  function paintFoot() {
    const st = batch() ? batch().stats : null;
    $('pos').innerHTML = S.view.length
      ? '第 <b>' + (S.cur + 1) + '</b> / ' + S.view.length + ' 条 <span class="faint">（本批 ' + st.total + ' 条）</span>'
      : '<span class="faint">无</span>';
    $('barFill').style.width = S.view.length ? Math.round(((S.cur + 1) / S.view.length) * 100) + '%' : '0';
    $('btnPrev').disabled = S.cur <= 0;
    $('btnNext').disabled = S.cur >= S.view.length - 1;
    const b = batch();
    if (b) {
      const flagged = b.runs.filter((r) => DP.FORM_NOTES[r.seq]).length;
      const marked = b.runs.filter((r) => getMark(r)).length;
      $('footHint').innerHTML = '表单列名 <b class="num">' + flagged + '</b> 条 · 已标 <b class="num">' + marked + '</b>';
    } else $('footHint').textContent = '';
  }

  function paintTally() {
    const b = batch();
    if (!b) { $('tally').innerHTML = ''; $('batchName').textContent = '—'; return; }
    const st = b.stats;
    $('batchName').textContent = b.name;
    $('tally').innerHTML =
      '<span><b>' + st.total + '</b> runs</span>' +
      '<span class="pass">通过 <b>' + st.passed + '</b></span>' +
      '<span class="fail">不过 <b>' + st.failed + '</b></span>' +
      (st.withWarning ? '<span class="warn">异动 <b>' + st.withWarning + '</b></span>' : '');
  }

  /* ───────────────────────────── 视图：各页 ───────────────────────────── */

  function sec(title, hint) {
    return '<div class="sec"><span>' + esc(title) + '</span>' + (hint ? '<span class="hint">' + esc(hint) + '</span>' : '') + '</div>';
  }

  // 行尾说明：小文件常是一致行尾；trace.log 混行尾是正常的（模型答复里带 \r\n）
  function eolText(f) {
    if (!f || !f.eol || f.eol === 'none') return '';
    if (f.eol === 'crlf') return 'CRLF 行尾';
    if (f.eol === 'lf') return 'LF 行尾';
    return '混行尾（CRLF ' + f.crlf + ' / LF ' + f.lf + '）';
  }

  function verdictOf(r) { return r.passed === true ? '通过' : r.passed === false ? '不过' : '未判'; }

  function paneOverview(r) {
    const b = batch();
    const judgeParts = (r.judge || '').split(/\s+/).filter(Boolean);
    const judgeChips = judgeParts.map((p) => {
      const cls = /✗/.test(p) ? 'fail' : /✓/.test(p) ? 'pass' : 'plain';
      return '<span class="tag ' + (cls === 'fail' ? 'dot no' : cls === 'pass' ? 'dot ok' : 'plain') + '">' + esc(p) + '</span>';
    }).join(' ');
    const art = r.artifact;
    const artText = art ? DP.decodeText(art.bytes).text : '';
    const clues = [];
    clues.push(['目录内 result.txt', art ? '有 · ' + art.size + ' 字节' + (eolText(art) ? ' · ' + eolText(art) : '') : '没有', art ? 'ok' : 'no']);
    clues.push(['本 run 的写动作', r.writeAttempts ? r.writeAttempts + ' 次（write_file 成功调用或代码里带写文件）' : '没有成功的写动作', r.writeAttempts ? 'ok' : 'q']);
    clues.push(['最终答复里的完成声明', r.claimHits.length ? r.claimHits.map((c) => c.word).join('、') : '没有出现「已写入 / 已完成」这类声明', r.claimHits.length ? 'n' : 'q']);
    clues.push(['工具报错的步骤', r.errorSteps ? r.errorSteps + ' 步（如 ' + (r.steps.find((s) => s.error) || {}).output.split('\n')[0].slice(0, 40) + '）' : '没有', r.errorSteps ? 'n' : 'q']);
    if (r.missingArgSteps) clues.push(['空参数工具调用', r.missingArgSteps + ' 次（工具收到 None）', 'n']);

    const sameJudge = judgeDistribution(b, r.task);

    return sec('判分', '理由出自 trace.log 第 2 行；results.jsonl 的 judge 字段同值')
      + '<div class="block"><div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap">' +
        '<div style="min-width:150px"><div class="mut" style="font-size:11.5px;letter-spacing:.06em">判分结论</div>' +
        '<div style="font-size:15px;font-weight:600;margin-top:2px" class="' + (r.passed ? 'pass' : r.passed === false ? 'fail' : '') + '">' + verdictOf(r) + '</div></div>' +
        '<div style="flex:1;min-width:240px"><div class="mut" style="font-size:11.5px;letter-spacing:.06em">理由（原样）</div>' +
        '<div class="code" style="margin-top:4px"><pre style="padding:6px 8px">' + esc(r.judgeRaw || '(缺)') + '</pre></div>' +
        '<div style="margin-top:6px" class="chips">' + judgeChips + '</div>' +
        '<div class="note" style="margin-top:7px">✓ / ✗ 逐项对应判分口径。<b>✗ 的那一项就是没过的地方</b>——对照下方产物看具体差在哪。</div>' +
        '</div></div></div>'
      + '<div class="grid2" style="margin-top:14px">' +
        sec('产物 result.txt', art ? art.size + ' 字节' : '未产出') +
        '<div class="block">' + (art
          ? '<div class="code"><pre>' + esc(artText.length > 4000 ? artText.slice(0, 4000) + '\n…（截断显示）' : artText) + '</pre></div>' +
            '<div style="margin-top:7px" class="chips"><span class="tag plain mono">sha256 ' + art.sha.slice(0, 12) + '</span>' +
            '<span class="tag plain mono">' + art.size + ' B</span>' + (eolText(art) ? '<span class="tag plain">' + esc(eolText(art)) + '</span>' : '') +
            '<button class="chip" data-goto-tab="files">到「文件」页看字节 →</button></div>'
          : '<div class="empty">这个 run 的目录里没有 result.txt</div>') + '</div>' +
        sec('核对线索', '机械事实，不下结论') +
        '<div class="block"><div class="ok-list">' + clues.map((c) =>
          '<div class="ok-row"><span class="m ' + c[2] + '">' + (c[2] === 'ok' ? '·' : c[2] === 'no' ? '×' : '?') + '</span><span>' +
          esc(c[0]) + '：<span class="' + (c[2] === 'ok' ? '' : c[2] === 'no' ? 'fail' : 'mut') + '">' + esc(c[1]) + '</span></span></div>').join('') +
        '</div>' + (r.claimHits.length ? '<div class="note" style="margin-top:8px">完成声明原文：' +
          r.claimHits.map((c) => '「' + esc(c.ctx) + '」').join(' ') + '</div>' : '') +
        '</div>' +
      '</div>'
      + sec('本题在整批里的判分口径', '同题全部 run 的判分理由分布——看清「要求什么」和「大多数是什么结果」')
      + '<div class="block"><table class="tbl"><thead><tr><th style="width:70px">结果</th><th>理由</th><th style="width:60px">计数</th></tr></thead><tbody>' +
        sameJudge + '</tbody></table>' +
        '<div class="note" style="margin-top:7px">' + esc(DP.TASK_NOTE[r.task] || '') + '</div></div>'
      + sec('最终答复', '模型自己说的话，全文（trace.log 未截断）')
      + '<div class="block"><div class="answer">' + (r.final ? mdLite(r.final) : '<span class="mut">（空）</span>') + '</div></div>';
  }

  function judgeDistribution(b, task) {
    const m = new Map();
    for (const r of b.runs) {
      if (r.task !== task) continue;
      const k = (r.passed ? '通过' : r.passed === false ? '不过' : '未判') + '｜' + (r.judge || '');
      m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()].sort((a, b2) => b2[1] - a[1]).map(([k, n]) => {
      const [v, reason] = k.split('｜');
      return '<tr><td class="' + (v === '通过' ? 'pass' : 'fail') + '">' + esc(v) + '</td><td class="mono" style="font-size:12px">' + esc(reason) + '</td><td class="n">' + n + '</td></tr>';
    }).join('');
  }

  function paneTrace(r) {
    if (!r.steps.length) return '<div class="empty">没有步骤记录</div>';
    const nums = r.steps.map((s) => s.i);
    const gaps = [];
    for (let i = 0; i < (r.nSteps || 0); i++) if (!nums.includes(i)) gaps.push(i);
    const steps = r.steps.map((s) => {
      const collapsed = S.collapsed.has(s.i);
      const code = s.args && typeof s.args.code === 'string' ? s.args.code : null;
      const path = s.args && typeof s.args.path === 'string' ? s.args.path : null;
      const content = s.args && typeof s.args.content === 'string' ? s.args.content : null;
      let argsHtml = '';
      if (s.argsMissing) argsHtml = '<div class="note fail">工具调用没有带参数（收到 None）</div>';
      else if (code !== null) argsHtml = codeBlock(code);
      else if (path !== null || content !== null) {
        argsHtml = '<div class="code"><pre>' + esc(JSON.stringify(s.args, null, 2)) + '</pre></div>';
      } else argsHtml = '<div class="code"><pre>' + esc(s.argsRaw) + '</pre></div>';
      return '<div class="step ' + (s.error ? 'err' : '') + (collapsed ? ' collapsed' : '') + '" data-step="' + s.i + '">' +
        '<div class="lead"><div class="n">' + String(s.i).padStart(2, '0') + '</div>' +
        '<button class="toggle" data-toggle="' + s.i + '">' + (collapsed ? '展开' : '收起') + '</button></div>' +
        '<div class="body"><div class="head"><span class="tool">' + esc(s.tool) + '</span>' +
        (path ? '<span class="lab">' + esc(path) + '</span>' : '') +
        (s.error ? '<span class="lab" style="color:var(--fail)">报错</span>' : '') +
        '</div><div class="args">' + argsHtml + '</div>' +
        '<div class="outwrap"><div class="lab" style="margin:2px 0 3px">输出</div>' + outBlock(s.output) + '</div></div></div>';
    }).join('');
    return sec('步骤轨迹', r.steps.length + ' 步' + (gaps.length ? ' · 缺 step ' + gaps.join('/') : '')) +
      (gaps.length ? '<div class="note warn">trace.log 里没有 step ' + gaps.join('/') + ' 的记录，但头部记 ' + r.nSteps + ' 步、results.jsonl 也是 ' + r.nSteps + ' 步——存档缺了一行，不是模型少走一步。</div>' : '') +
      '<div class="steps">' + steps + '</div>' +
      '<div class="note" style="margin-top:12px">步骤输出在 trace.log 里<b>按行截断到 60 字符</b>（本次核对实测：134 处正好 60 字符），完整 stdout 没有存档；' +
      '代码参数是完整的。判断「模型到底执行了什么」以代码为准。</div>';
  }

  function paneFiles(r) {
    const fs = r.files;
    const nRuns = (r.fileStats && r.fileStats.nRuns) || '?';
    const rows = fs.map((f) => {
      const stat = r.fileStats && f.kind !== 'trace' && f.name !== 'result.txt' ? r.fileStats.summary[f.name] : null;
      let cons = '';
      if (stat) {
        cons = stat.variants.length
          ? '<span class="fail">与同题多数不一致</span>'
          : '<span class="pass">同题 ' + stat.total + ' 个 run 逐字节一致</span>';
      } else if (f.kind === 'artifact') cons = '<span class="mut">产物，无标准值</span>';
      else if (f.kind === 'extra') cons = '<span class="fail">非标准件：同题 ' + nRuns + ' 个 run 多数没有</span>';
      else if (f.kind === 'trace') cons = '<span class="mut">运行记录</span>';
      const note = [];
      const et = eolText(f);
      if (et && f.eol !== 'mixed') note.push(et.replace(' 行尾', ''));
      else if (et) note.push('混行尾 ' + f.crlf + '/' + f.lf);
      const kindName = { initial: '初始文件', artifact: '产物', extra: '异常新增', trace: '轨迹存档' }[f.kind] || f.kind;
      return '<tr data-file="' + esc(f.name) + '"' + (S.openFile === f.name ? ' aria-selected="true"' : '') + '>' +
        '<td class="fname">' + esc(f.name) + '</td>' +
        '<td><span class="kind ' + f.kind + '">' + kindName + '</span></td>' +
        '<td class="n">' + f.size + '</td>' +
        '<td class="n mono" style="text-align:left">' + f.sha.slice(0, 12) + '</td>' +
        '<td>' + cons + (note.length ? ' <span class="faint mono">' + note.join(' ') + '</span>' : '') + '</td></tr>';
    }).join('');

    const head = sec('文件清单', fs.length + ' 个（含 trace.log）') +
      '<div class="tablewrap"><table class="tbl"><thead><tr><th style="width:180px">文件名</th><th style="width:80px">性质</th><th style="width:64px">字节</th>' +
      '<th style="width:96px">sha256</th><th>同题一致性</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="note" style="margin-top:9px">「同题一致性」＝ 同一道题的 16 个 run 里该文件的字节内容是否完全一致（等价于与任务常量逐字比对）——' +
      '这是 1.3「未动文件逐字节抽查」的机械化版本，128 个 run 全跑一遍。</div>';

    if (!S.openFile) return head + '<div class="empty" style="margin-top:14px">点表里的文件名查看内容 / 十六进制字节</div>';
    const f = fs.find((x) => x.name === S.openFile);
    if (!f) return head;
    const dec = DP.decodeText(f.bytes);
    const isText = dec.utf8;
    const hex = DP.hexdump(f.bytes, { max: 4096 });
    const hexHtml = hex.rows.map((row) => '<span class="off">' + row.off.toString(16).padStart(6, '0') + '</span>  ' +
      esc(row.hex) + ' <span class="asc">|' + esc(row.asc) + '|</span>').join('\n') +
      (hex.truncated ? '\n<span class="faint">…共 ' + hex.total + ' 字节，此处显示前 4096 字节</span>' : '');
    const viewer = '<div class="viewer" style="margin-top:14px">' +
      '<div class="vhead"><span class="fn">' + esc(f.name) + '</span>' +
      '<span class="tag plain mono">' + f.size + ' B</span>' +
      '<span class="tag plain mono">sha256 ' + f.sha.slice(0, 16) + '</span>' +
      (eolText(f) ? '<span class="tag plain">' + esc(eolText(f)) + '</span>' : '') +
      (dec.utf8 ? '' : '<span class="tag plain">非 UTF-8 字节</span>') +
      '<span class="seg" style="margin-left:auto">' +
        '<button data-fmode="text" aria-pressed="' + (S.fileMode === 'text') + '">文本</button>' +
        '<button data-fmode="hex" aria-pressed="' + (S.fileMode === 'hex') + '">字节</button>' +
      '</span></div>' +
      '<div class="vbody">' + (S.fileMode === 'hex'
        ? '<div class="hex">' + hexHtml + '</div>'
        : (isText ? '<div class="code" style="border:0;background:transparent"><pre>' + esc(dec.text.length > 20000 ? dec.text.slice(0, 20000) + '\n…（截断显示）' : dec.text) + '</pre></div>'
                  : '<div class="hex">' + hexHtml + '</div>')) +
      '</div></div>';
    return head + viewer;
  }

  function paneCheck(r) {
    const m = getMark(r) || { verdict: '未核', label: '', note: '' };
    const note = DP.FORM_NOTES[r.seq];
    const auto = DP.FAIL_TAGS[r.seq];
    const b = batch();
    const sameCell = b.runs.filter((x) => x.mtag === r.mtag && x.group === r.group && x.task === r.task);
    const passN = sameCell.filter((x) => x.passed).length;
    const pairs = DP.GOTO_PAIRS.filter((p) => p[0] === r.seq || p[1] === r.seq).map((p) => (p[0] === r.seq ? p[1] : p[0]));
    const otherFails = b.runs.filter((x) => x.seq !== r.seq && x.mtag === r.mtag && x.task === r.task && x.passed === false);

    return sec('这一条在表单里的位置', note ? note.list : '不在表单清单里') +
      '<div class="block">' +
        (note
          ? '<div style="font-size:13px">' + (note.flag ? '<b>' + esc(note.flag) + '</b> ' : '') + esc(note.note || '（表单只列了这一行，没有额外备注）') + '</div>'
          : '<div class="mut">review-form.md 的 1.5 / 1.2 表里没有这一条。若你在做 1.3 的逐字节抽查或 1.4 的样本核对，也可以在这里记录。</div>') +
        (DP.CHECK12.includes(r.seq) ? '<div class="note" style="margin-top:8px">1.2 判分抽查的六条之一（重点看：判分理由与产物内容对不对得上、初始文件有没有被改动）。</div>' : '') +
        (r.seq === 47 ? '<div class="note" style="margin-top:8px">1.4 头号样本：看 step 0 的报错形态、step 1–7 是否 os.walk 扫盘、最后怎么落到 equivalent.txt，与 sum.md ③④ 的 9 步 / 116s / 296K token 对齐。</div>' : '') +
        (pairs.length ? '<div style="margin-top:9px" class="chips">' + pairs.map((p) => '<button class="chip" data-jump="' + p + '">跳到对照 run-' + String(p).padStart(3, '0') + ' →</button>').join('') + '</div>' : '') +
      '</div>'
      + '<div class="grid2" style="margin-top:14px">' +
        sec('自动标签（sum.md ⑤）') +
        '<div class="block"><div style="display:flex;gap:10px;align-items:baseline">' +
          '<span class="tag mono" style="font-size:13px">' + esc(auto || (r.passed ? '通过' : '（未列入失败清单）')) + '</span>' +
          '<span class="mut" style="font-size:12px">' + (auto ? '这是待你核对的机器标签' : '') + '</span></div>' +
          '<div class="note" style="margin-top:8px">规则（sum.md ⑤）：<b>假完成</b>＝没落盘却声称已写入；<b>认输</b>＝明说无法/失败；<b>产物错误</b>＝落盘了但内容不过；<b>MAX-TURNS</b>＝打满步数。</div>' +
          '<div class="note" style="margin-top:7px">同格成绩：<b>' + esc(r.mtag + '·' + r.group + '·' + r.task) + '</b> 通过 ' + passN + ' / ' + sameCell.length +
          (otherFails.length ? ' · 同模型同题的其他失败样：' + otherFails.map((x) => 'run-' + String(x.seq).padStart(3, '0')).join('、') : '') + '</div>' +
        '</div>' +
        sec('我的核对') +
        '<div class="block">' +
          '<div class="mut" style="font-size:11.5px;letter-spacing:.06em;margin-bottom:5px">判定</div>' +
          '<div class="seg" style="width:100%">' + VERDICTS.map((v) => '<button data-verdict="' + esc(v) + '" aria-pressed="' + (m.verdict === v) + '" style="flex:1">' + esc(v) + '</button>').join('') + '</div>' +
          '<div class="mut" style="font-size:11.5px;letter-spacing:.06em;margin:12px 0 5px">我核到的标签</div>' +
          '<div class="chips">' + LABELS.map((l) => '<button class="chip" data-rlabel="' + esc(l) + '" aria-pressed="' + (m.label === l) + '">' + esc(l || '（空）') + '</button>').join('') + '</div>' +
          '<div class="mut" style="font-size:11.5px;letter-spacing:.06em;margin:12px 0 5px">备注（会进导出表）</div>' +
          '<textarea class="fld" id="noteBox" rows="4" placeholder="如实写：看了什么、判错在哪、怎么改。">' + esc(m.note || '') + '</textarea>' +
          '<div style="margin-top:9px;display:flex;align-items:center;gap:10px">' +
            '<span class="mut" style="font-size:12px" id="markState">' + (getMark(r) ? '已记录' : '未记录') + '</span>' +
            '<label class="mut" style="font-size:12px;margin-left:auto;display:flex;gap:5px;align-items:center">' +
            '<input type="checkbox" id="autoNext" ' + (S.autoNext ? 'checked' : '') + '> 标完自动下一条</label>' +
            '<button class="btn tiny" id="clearMark">清除</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function paintPane() {
    // 面板要重画了：先把备注框里还没落盘的内容收进标注（防抖窗口内的输入不能丢）
    if (pendingFlush) { const f = pendingFlush; pendingFlush = null; try { f(); } catch (e) { /* ignore */ } }
    const el = $('pane');
    const r = curRun();
    if (!r) {
      el.innerHTML = batch() ? '<div class="empty">当前筛选下没有 run</div>' : welcomeHtml();
      bindWelcome();
      return;
    }
    const html = S.tab === 'overview' ? paneOverview(r) : S.tab === 'trace' ? paneTrace(r) : S.tab === 'files' ? paneFiles(r) : paneCheck(r);
    el.innerHTML = html;
    el.scrollTop = 0;
    bindPane(r);
    // 记录滚动位置
  }

  function paint() {
    paintFilters(); paintList(); paintHead(); paintTabs(); paintPane(); paintFoot(); paintTally();
    $('btnDiag').disabled = !batch();
    $('btnExport').disabled = !batch();
  }
  function repaintRun() { paintList(); paintHead(); paintTabs(); paintPane(); paintFoot(); paintTally(); }

  /* ───────────────────────────── 欢迎页 ───────────────────────────── */

  function welcomeHtml() {
    return '' +
      '<div style="max-width:640px;margin:34px auto 0">' +
        '<div style="font-size:19px;font-weight:600;letter-spacing:.01em">导入一个 runs 目录开始复核</div>' +
        '<div class="mut" style="margin-top:8px;font-size:13px">前端只读你的文件，不改动任何东西；复核标注存在浏览器本地。' +
        '方向键逐条翻，判分 / 轨迹 / 产物 / 初始文件都在一页里对得上。</div>' +
        '<div style="margin-top:16px;display:flex;gap:9px;flex-wrap:wrap">' +
          '<button class="btn primary" data-imp="dir">选择文件夹…</button>' +
          '<button class="btn" data-imp="jsonl">只选 results.jsonl（可选）</button>' +
          '<button class="btn" data-diag-help="1">看看它做了哪些机械核对</button>' +
        '</div>' +
        '<div style="margin-top:22px">' + sec('它期待的结构') +
          '<div class="block"><div class="tree">d3-results/\n' +
          '├─ <span class="hi">runs/</span>                      <span class="c">← 选这一层，或选上一层的 d3-results</span>\n' +
          '│  ├─ run-001__DS__A__T1__r1/\n' +
          '│  │  ├─ trace.log            <span class="c">步骤轨迹 + 判分理由 + 最终答复</span>\n' +
          '│  │  ├─ result.txt           <span class="c">产物（没落盘的就是没有这个文件）</span>\n' +
          '│  │  └─ data.txt …           <span class="c">初始文件（按原样读，用于逐字节比对）</span>\n' +
          '│  └─ run-002__…/\n' +
          '└─ results.jsonl           <span class="c">可选：用于「存档编号对应」核对</span></div>' +
          '<div class="note" style="margin-top:10px">复测同理：新跑出来的目录（比如 runs-b4/ 或另一次实验的 runs/）直接再导入一次，' +
          '会成为独立批次，互不覆盖；两个批次可以来回切换。</div>' +
          '</div>' +
        '</div>' +
        '<div style="margin-top:22px">' + sec('机械核对了什么', '导入后点顶栏的「体检」随时重看') +
          '<div class="block"><div class="ok-list">' + [
            ['目录名 ↔ trace 头行 ↔ results.jsonl', '三条记录的模型 / 组 / 题 / 次数 / 判分是否互相打架'],
            ['同题初始文件逐字节一致性', '同题 16 个 run 里同名文件是不是同一个字节流（等价于与任务常量比对）'],
            ['异常新出现的文件', '同题多数 run 都没有的文件（自建文件、篡改的第一信号）'],
            ['判分与磁盘状态是否矛盾', '判「未产出」却有 result.txt、判「通过」却没有 result.txt'],
            ['步骤记录缺口与工具异常', '头部记 N 步但轨迹少一行；工具收到空参数；报错步骤'],
            ['成本离群', 'token 超过本批中位数 10 倍的 run'],
          ].map((c) => '<div class="ok-row"><span class="m q">·</span><span><b>' + esc(c[0]) + '</b> — ' + esc(c[1]) + '</span></div>').join('') +
          '</div></div>' +
        '</div>' +
      '</div>';
  }
  function bindWelcome() {
    document.querySelectorAll('[data-imp]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.imp === 'jsonl') $('pickFiles').click(); else $('pickDir').click();
    }));
    document.querySelectorAll('[data-diag-help]').forEach((b) => b.addEventListener('click', () => openDiag(true)));
  }

  /* ───────────────────────────── 交互 ───────────────────────────── */

  function goto(i) {
    if (!S.view.length) return;
    const n = Math.max(0, Math.min(S.view.length - 1, i));
    S.cur = n;
    S.collapsed = new Set();
    S.openFile = null;
    repaintRun();
  }
  const next = () => goto(S.cur + 1);
  const prev = () => goto(S.cur - 1);
  function gotoSeq(seq) {
    const i = S.view.findIndex((r) => r.seq === seq);
    if (i >= 0) goto(i);
    else { S.filter.q = ''; const q = $('q'); if (q) q.value = ''; applyFilter(); paintFilters(); paintList(); const j = S.view.findIndex((r) => r.seq === seq); if (j >= 0) goto(j); }
  }

  function bindPane(r) {
    const pane = $('pane');
    // 备注框有 350ms 防抖，重画前先把它收进标注里，别让打字丢了
    const flushNote = () => {
      const nb = $('noteBox');
      if (!nb) return;
      const m = Object.assign({ verdict: '未核', label: '', note: '' }, getMark(r));
      if (m.note !== nb.value) { m.note = nb.value; setMark(r, m); }
    };
    pendingFlush = flushNote;
    pane.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => {
      const i = +b.dataset.toggle;
      if (S.collapsed.has(i)) S.collapsed.delete(i); else S.collapsed.add(i);
      pane.querySelector('.step[data-step="' + i + '"]').classList.toggle('collapsed');
      b.textContent = S.collapsed.has(i) ? '展开' : '收起';
    }));
    pane.querySelectorAll('tr[data-file]').forEach((tr) => tr.addEventListener('click', () => {
      const name = tr.dataset.file;
      if (S.openFile === name) { S.openFile = null; paintPane(); return; }
      S.openFile = name;
      const f = r.files.find((x) => x.name === name);
      // 非 UTF-8 的文件默认直接看字节（逐字节核对本来就是本题要看的）
      S.fileMode = f && !DP.decodeText(f.bytes).utf8 ? 'hex' : 'text';
      paintPane();
    }));
    pane.querySelectorAll('[data-fmode]').forEach((b) => b.addEventListener('click', () => { S.fileMode = b.dataset.fmode; paintPane(); }));
    pane.querySelectorAll('[data-goto-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.gotoTab)));
    pane.querySelectorAll('[data-jump]').forEach((b) => b.addEventListener('click', () => gotoSeq(+b.dataset.jump)));
    pane.querySelectorAll('[data-verdict]').forEach((b) => b.addEventListener('click', () => {
      flushNote();
      const m = Object.assign({ verdict: '未核', label: '', note: '' }, getMark(r));
      m.verdict = b.dataset.verdict;
      setMark(r, m);
      paintPane(); paintList(); paintFoot();
      if (S.autoNext && m.verdict !== '未核') setTimeout(() => { next(); }, 160);
    }));
    pane.querySelectorAll('[data-rlabel]').forEach((b) => b.addEventListener('click', () => {
      flushNote();
      const m = Object.assign({ verdict: '未核', label: '', note: '' }, getMark(r));
      m.label = b.dataset.rlabel;
      setMark(r, m);
      pane.querySelectorAll('[data-rlabel]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.rlabel === m.label)));
      paintList(); paintFoot();
    }));
    const box = $('noteBox');
    if (box) {
      let t = null;
      box.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          const m = Object.assign({ verdict: '未核', label: '', note: '' }, getMark(r));
          m.note = box.value;
          setMark(r, m);
          const st = $('markState');
          if (st) st.textContent = getMark(r) ? '已记录 · ' + new Date().toLocaleTimeString() : '未记录';
          paintList(); paintFoot();
        }, 350);
      });
    }
    const auto = $('autoNext');
    if (auto) auto.addEventListener('change', () => { S.autoNext = auto.checked; try { localStorage.setItem(LS.autoNext, S.autoNext ? '1' : '0'); } catch (e) { /* ignore */ } });
    const clr = $('clearMark');
    if (clr) clr.addEventListener('click', () => { setMark(r, null); paintPane(); paintList(); paintFoot(); });
  }

  function setTab(id) {
    if (S.tab === id) return;
    S.tab = id;
    paintTabs();
    paintPane();
  }

  /* ───────────────────────────── 批次菜单 ───────────────────────────── */

  function openBatchMenu(anchor) {
    closePop();
    const pop = document.createElement('div');
    pop.className = 'pop';
    pop.id = 'batchPop';
    const items = S.batches.map((b) =>
      '<div class="pitem" data-batch="' + b.id + '" aria-selected="' + (b.id === S.activeId) + '">' +
      '<span class="mono" style="font-size:11.5px">' + b.stats.total + '</span>' +
      '<span data-name="' + b.id + '">' + esc(b.name) + '</span>' +
      '<span class="meta">' + new Date(b.createdAt).toLocaleDateString() + '</span>' +
      '<button class="act" data-ren="' + b.id + '" title="重命名">改名</button>' +
      '<button class="act" data-del="' + b.id + '" title="从本地移除">移除</button></div>').join('');
    pop.innerHTML = items + '<div class="pfoot"><button class="btn tiny" data-act="import">导入新目录</button>' +
      '<span class="mut" style="font-size:11.5px;margin-left:auto">' + (S.storageOk ? '存在浏览器本地' : '仅本次会话') + '</span></div>';
    document.body.appendChild(pop);
    const box = anchor.getBoundingClientRect();
    pop.style.left = Math.round(box.left) + 'px';
    pop.style.top = Math.round(box.bottom + 5) + 'px';
    pop.querySelectorAll('.pitem').forEach((it) => it.addEventListener('click', (ev) => {
      if (ev.target.dataset.ren !== undefined || ev.target.dataset.del !== undefined) return;
      setActive(it.dataset.batch);
      closePop();
    }));
    pop.querySelectorAll('[data-ren]').forEach((b) => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const id = b.dataset.ren;
      const span = pop.querySelector('[data-name="' + id + '"]');
      const old = span.textContent;
      span.innerHTML = '<input class="fld" style="padding:1px 4px;font-size:12px" value="' + esc(old) + '">';
      const inp = span.querySelector('input');
      inp.focus(); inp.select();
      const commit = async () => {
        const v = inp.value.trim() || old;
        const bb = S.batches.find((x) => x.id === id);
        if (bb) { bb.name = v; try { await store.put(bb); } catch (e) { /* ignore */ } }
        closePop(); paint();
      };
      inp.addEventListener('keydown', (e2) => { if (e2.key === 'Enter') commit(); if (e2.key === 'Escape') closePop(); });
      inp.addEventListener('blur', commit);
    }));
    pop.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const id = b.dataset.del;
      const bb = S.batches.find((x) => x.id === id);
      if (!bb) return;
      if (!confirm('从本地移除批次「' + bb.name + '」？（只删浏览器里的缓存，不动你的文件）')) return;
      S.batches = S.batches.filter((x) => x.id !== id);
      try { await store.del(id); } catch (e) { /* ignore */ }
      if (S.activeId === id) setActive(S.batches.length ? S.batches[0].id : null);
      else { paint(); }
      closePop();
    }));
    pop.querySelector('[data-act="import"]').addEventListener('click', () => { closePop(); $('pickDir').click(); });
    setTimeout(() => document.addEventListener('mousedown', outsideClose, true), 0);
  }
  function outsideClose(ev) {
    const pop = $('batchPop');
    if (pop && !pop.contains(ev.target) && ev.target.id !== 'btnBatch') closePop();
  }
  function closePop() {
    const pop = $('batchPop');
    if (pop) pop.remove();
    document.removeEventListener('mousedown', outsideClose, true);
  }

  /* ───────────────────────────── 模态框 ───────────────────────────── */

  function openModal(title, bodyHtml, footHtml, opts) {
    const o = opts || {};
    const wrap = document.createElement('div');
    wrap.className = 'scrim';
    wrap.innerHTML = '<div class="modal' + (o.narrow ? ' narrow' : '') + '">' +
      '<div class="mhead"><h3>' + esc(title) + '</h3>' +
      (o.closable === false ? '' : '<button class="btn tiny" data-close style="margin-left:auto">关闭</button>') + '</div>' +
      '<div class="mbody">' + bodyHtml + '</div>' +
      (footHtml ? '<div class="mfoot">' + footHtml + '</div>' : '') + '</div>';
    $('modals').appendChild(wrap);
    const close = () => wrap.remove();
    wrap.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap && o.closable !== false) close(); });
    return { el: wrap, close };
  }

  const DIAG_LIST = [
    ['① 存档编号对应', '目录名 ↔ trace 头行 ↔ results.jsonl 的模型 / 组 / 题 / 次数 / 判分是否互相打架'],
    ['② 同题初始文件逐字节一致性', '同题每个 run 里同名文件的字节流是否完全相同（等价于与任务常量逐字比对）'],
    ['③ 异常新增文件', '同题多数 run 都没有的文件——自建文件、绕过限制写盘的第一信号'],
    ['④ 缺标准件', '同题多数 run 都有的初始文件在本 run 里不见了'],
    ['⑤ 判分与磁盘状态矛盾', '判「未产出」却有 result.txt，或判「通过」却没有 result.txt'],
    ['⑥ 步骤记录缺口与工具异常', '头部记 N 步但轨迹里少一行；工具收到空参数；报错的步骤'],
    ['⑦ 成本离群', 'token 超过本批中位数 10 倍的 run'],
  ];

  function openDiag(helpOnly) {
    const b = batch();
    if (!b) {
      const body = '<div class="diag">' + DIAG_LIST.map((d) =>
        '<section><div class="dsec"><h4>' + esc(d[0]) + '</h4></div><div class="note">' + esc(d[1]) + '</div></section>').join('') +
        '</div><div class="note" style="margin-top:12px">导入 runs 目录后，这些检查会在导入时整批跑一遍，结果在这里逐条列出，点条目可直接跳过去看。</div>';
      openModal(helpOnly ? '机械体检会查这些' : '机械体检', body, '<button class="btn" data-close>好</button>', { narrow: true });
      return;
    }
    const c = b.checks;
    const li = (seq, text) => '<li><b>run-' + String(seq).padStart(3, '0') + '</b> <span class="go" data-jump="' + seq + '">跳到 →</span> ' + esc(text) + '</li>';
    const secHtml = (t, hint, items, emptyText) =>
      '<section><div class="dsec"><h4>' + esc(t) + '</h4><span class="c">' + (items.length ? items.length + ' 处' : '通过') + '</span></div>' +
      (hint ? '<div class="note">' + esc(hint) + '</div>' : '') +
      (items.length ? '<ul>' + items.join('') + '</ul>' : '<div class="note">' + esc(emptyText || '没有发现异常') + '</div>') + '</section>';

    const jl = c.jsonl;
    const body = '<div class="diag">' +
      secHtml('① 存档编号对应（1.1）',
        'results.jsonl 的每一行与目录名 / trace 头行 / 判分结论逐字段比对。',
        jl.present ? (jl.mismatches.map((m) => li(m.seq, m.diff.join('；')))
          .concat(jl.orphanRows.map((s) => li(s, 'jsonl 里有这一行，但目录里没有对应的 run 目录')))
          .concat(jl.seqMismatch.map((s) => li(s, '目录里有这个 run，jsonl 里没有对应行')))) : [],
        jl.present ? '全部一致（' + jl.rows + ' 行）' : '本批次没有导入 results.jsonl——把包含它的上一层目录一起选进来即可启用这项核对') +
      secHtml('② 同题初始文件逐字节一致性（1.3）',
        '同一道题的所有 run 里，同名初始文件的字节内容是否完全一致。不一致 = 该 run 的文件被动过；这一步等价于与任务常量逐字比对。',
        Object.entries(c.files).map(([k, v]) => v.outliers.map((s) => li(s, k + '：与同题多数（' + v.majorityCount + '/' + v.total + '）不一致，多数哈希 ' + v.majorityHash.slice(0, 12)))),
        '同题的初始文件全部逐字节一致') +
      secHtml('③ 异常新增文件',
        '同题多数 run 都没有的文件。这是「自己造了个文件再读它」这类行为的机械信号。',
        c.extras.map((e) => li(e.seq, '新出现 ' + e.name + '（' + e.size + ' 字节）—— 同题 ' + e.total + ' 个 run 里只有 ' + e.appeared + ' 个有')),
        '没有 run 新建过文件') +
      secHtml('④ 缺标准件',
        '同题多数 run 都有的初始文件，在本 run 目录里不见了。',
        c.missingFiles.map((e) => li(e.seq, '缺少 ' + e.name)),
        '没有缺失') +
      secHtml('⑤ 判分与磁盘状态矛盾',
        '判分说「未产出」却有 result.txt，或判「通过」却没有 result.txt。这种矛盾意味着尺子或存档有问题。',
        c.judgeDisk.map((e) => li(e.seq, e.note)), '没有矛盾') +
      secHtml('⑥ 步骤记录缺口与工具异常',
        '头部记的步数与轨迹里实际写下的步骤行对不上；或工具调用收到空参数。',
        c.stepGaps.map((g) => li(g.seq, 'trace.log 缺 step ' + g.missing.join('/') + '（头部 ' + g.headerN + ' 步，实际 ' + g.traceN + ' 行）'))
          .concat(c.toolAnomalies.map((t2) => li(t2.seq, 'step ' + t2.step + '：' + t2.note)))
          .concat(c.parseErrors.map((e) => li(e.seq, e.note))),
        '步骤记录完整，工具调用正常') +
      secHtml('⑦ 成本离群',
        'token 超过本批中位数 10 倍的 run（中位数 ' + Math.round(c.medianTokens).toLocaleString() + '，阈值 ' + Math.round(c.medianTokens * 10).toLocaleString() + '）。',
        c.cost.map((e) => li(e.seq, e.tokens.toLocaleString() + ' tokens（中位数的 ' + e.ratio.toFixed(0) + ' 倍）')),
        '没有离群') +
      '<section><div class="dsec"><h4>⑧ 失败清单的覆盖</h4><span class="c">' + b.stats.failed + ' 条不过</span></div>' +
        '<div class="note">review-form.md 1.5 列了 31 条失败：A 组 ' + DP.PART15_A.length + ' 条 + B 组 ' + DP.PART15_B.length + ' 条。' +
        '本批实际的「不过」是 ' + b.stats.failed + ' 条。' +
        (b.stats.failed === DP.PART15_A.length + DP.PART15_B.length ? '数量对得上。' : '数量对不上，值得查一下。') + '</div></section>' +
      '</div>';
    const m = openModal(helpOnly ? '机械体检会查这些' : '机械体检（整批 ' + b.stats.total + ' 条）', body,
      '<button class="btn" data-close>关闭</button><span class="mut" style="font-size:12px;margin-left:auto">点任意条目可跳到该 run</span>');
    m.el.querySelectorAll('[data-jump]').forEach((x) => x.addEventListener('click', () => { m.close(); gotoSeq(+x.dataset.jump); }));
  }

  function openExport() {
    const b = batch();
    if (!b) return;
    const md = buildMarkdown(b);
    const m = openModal('导出核对表', '<div class="note" style="margin-bottom:10px">下面是可直接贴进 review-form.md 的 markdown。只有你标过的 run 会带内容，其余留空等你填。</div>' +
      '<div class="md" id="mdBox">' + esc(md) + '</div>',
      '<button class="btn primary" id="btnCopy">复制全文</button>' +
      '<button class="btn" id="btnDownload">下载 .md</button>' +
      '<span class="mut" style="font-size:12px;margin-left:auto">已标 ' + b.runs.filter((r) => getMark(r)).length + ' 条</span>');
    m.el.querySelector('#btnCopy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(md); toast('已复制'); }
      catch (e) { const box = m.el.querySelector('#mdBox'); const r2 = document.createRange(); r2.selectNodeContents(box); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r2); toast('已选中，按 Ctrl+C 复制'); }
    });
    m.el.querySelector('#btnDownload').addEventListener('click', () => {
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'd3-复核记录_' + b.name.replace(/[^\w一-龥-]+/g, '_') + '.md';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
  }

  function buildMarkdown(b) {
    const R = (seq) => b.runs.find((r) => r.seq === seq);
    const cell = (r, f) => { const m = r ? getMark(r) : null; const v = m ? (m[f] || '') : ''; return v.replace(/\|/g, '\\|').replace(/\n+/g, ' '); };
    const L = [];
    L.push('# D3 复核记录（由复核台导出）');
    L.push('');
    L.push('> 批次：' + b.name + '　来源：`' + b.source + '`　导出时间：' + new Date().toLocaleString());
    L.push('> 说明：这些内容由我在复核台上逐条看过文件后填写；未填的是还没核到。');
    L.push('');
    L.push('## 1.5 A 组失败（' + DP.PART15_A.length + ' 条）');
    L.push('');
    L.push('| run | 格·题 | 自动标签 | 我核对的标签 | 判定 | 备注 |');
    L.push('|---|---|---|---|---|---|');
    for (const seq of DP.PART15_A) {
      const r = R(seq);
      L.push('| run-' + String(seq).padStart(3, '0') + ' | ' + (r ? r.mtag + '·' + r.group + '·' + r.task : '') + ' | ' + (DP.FAIL_TAGS[seq] || '') + ' | ' + cell(r, 'label') + ' | ' + cell(r, 'verdict') + ' | ' + cell(r, 'note') + ' |');
    }
    L.push('');
    L.push('## 1.5 B 组失败（' + DP.PART15_B.length + ' 条）');
    L.push('');
    L.push('| run | 格·题 | 自动标签 | 我核对的标签 | 判定 | 备注 |');
    L.push('|---|---|---|---|---|---|');
    for (const seq of DP.PART15_B) {
      const r = R(seq);
      L.push('| run-' + String(seq).padStart(3, '0') + ' | ' + (r ? r.mtag + '·' + r.group + '·' + r.task : '') + ' | ' + (DP.FAIL_TAGS[seq] || '') + ' | ' + cell(r, 'label') + ' | ' + cell(r, 'verdict') + ' | ' + cell(r, 'note') + ' |');
    }
    L.push('');
    L.push('## 1.2 判分抽查（' + DP.CHECK12.length + ' 条）');
    L.push('');
    L.push('| run | 题 | 判分理由（trace.log 第 2 行） | 我看了 result.txt 后的判断 | 冤枉了吗 |');
    L.push('|---|---|---|---|---|');
    for (const seq of DP.CHECK12) {
      const r = R(seq);
      L.push('| run-' + String(seq).padStart(3, '0') + ' | ' + (r ? r.task : '') + ' | ' + (r ? r.judgeRaw.replace(/\|/g, '\\|') : '') + ' | ' + cell(r, 'note') + ' | ' + cell(r, 'verdict') + ' |');
    }
    const others = b.runs.filter((r) => getMark(r) && !DP.FORM_NOTES[r.seq]).map((r) => r.seq).sort((a, x) => a - x);
    if (others.length) {
      L.push('');
      L.push('## 其他标注');
      L.push('');
      L.push('| run | 格·题 | 判定 | 我核到的标签 | 备注 |');
      L.push('|---|---|---|---|---|');
      for (const seq of others) {
        const r = R(seq);
        L.push('| run-' + String(seq).padStart(3, '0') + ' | ' + r.mtag + '·' + r.group + '·' + r.task + ' | ' + cell(r, 'verdict') + ' | ' + cell(r, 'label') + ' | ' + cell(r, 'note') + ' |');
      }
    }
    const c = b.checks;
    L.push('');
    L.push('## 机械体检摘要（复核台自动跑）');
    L.push('');
    L.push('- 存档编号对应（1.1）：' + (c.jsonl.present ? (c.jsonl.rows + ' 行 jsonl 与目录逐字段比对，' + (c.jsonl.mismatches.length + c.jsonl.orphanRows.length + c.jsonl.seqMismatch.length === 0 ? '全部一致' : '有 ' + (c.jsonl.mismatches.length + c.jsonl.orphanRows.length + c.jsonl.seqMismatch.length) + ' 处不一致')) : '本批未导入 results.jsonl'));
    L.push('- 同题初始文件逐字节（1.3）：' + (Object.keys(c.files).length === 0 ? '同题标准件字节全部一致（含 run-047 的 equivalent.txt）' : '有 ' + Object.keys(c.files).length + ' 个文件出现不一致：' + Object.keys(c.files).join('、')));
    L.push('- 异常新增文件：' + (c.extras.length ? c.extras.map((e) => 'run-' + String(e.seq).padStart(3, '0') + ' 新建了 ' + e.name).join('；') : '无'));
    L.push('- 缺标准件：' + (c.missingFiles.length ? c.missingFiles.map((e) => 'run-' + String(e.seq).padStart(3, '0') + ' 缺 ' + e.name).join('；') : '无'));
    L.push('- 判分与磁盘矛盾：' + (c.judgeDisk.length ? c.judgeDisk.map((e) => 'run-' + String(e.seq).padStart(3, '0') + ' ' + e.note).join('；') : '无'));
    L.push('- 步骤记录缺口：' + (c.stepGaps.length ? c.stepGaps.map((g) => 'run-' + String(g.seq).padStart(3, '0') + ' 缺 step ' + g.missing.join('/')).join('；') : '无'));
    L.push('- 工具空参调用：' + (c.toolAnomalies.length ? c.toolAnomalies.map((t2) => 'run-' + String(t2.seq).padStart(3, '0') + ' step ' + t2.step).join('、') : '无'));
    L.push('- 成本离群（>' + Math.round(c.medianTokens * 10) + ' tokens）：' + (c.cost.length ? c.cost.map((e) => 'run-' + String(e.seq).padStart(3, '0') + '（' + e.tokens.toLocaleString() + '，' + e.ratio.toFixed(0) + '×）').join('；') : '无'));
    L.push('');
    L.push('> 本批统计：' + b.stats.total + ' 条，通过 ' + b.stats.passed + '，不过 ' + b.stats.failed + '；有异动的 run ' + b.stats.withWarning + ' 条。');
    return L.join('\n');
  }

  /* ───────────────────────────── 提示条 ───────────────────────────── */

  let toastTimer = null;
  function toast(msg) {
    let t = $('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      t.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:58px;background:var(--ink);color:var(--panel);' +
        'padding:7px 13px;border-radius:3px;font-size:12.5px;z-index:70;opacity:0;transition:opacity .18s';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.opacity = '0'; }, 2600);
  }

  /* ───────────────────────────── 事件绑定 ───────────────────────────── */

  function bindChrome() {
    $('btnImport').addEventListener('click', () => $('pickDir').click());
    $('btnBatch').addEventListener('click', (e) => openBatchMenu(e.currentTarget));
    $('btnRail').addEventListener('click', () => document.body.classList.toggle('rail-open'));
    $('btnPrev').addEventListener('click', prev);
    $('btnNext').addEventListener('click', next);
    $('btnDiag').addEventListener('click', () => openDiag(false));
    $('btnExport').addEventListener('click', openExport);
    $('pickDir').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) importFromFiles(f); });
    $('pickFiles').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) importFromFiles(f); });

    $('list').addEventListener('click', (e) => {
      const row = e.target.closest('.row');
      if (row) {
        goto(+row.dataset.i);
        if (window.innerWidth <= 860) document.body.classList.remove('rail-open');
      }
    });
    $('tabs').addEventListener('click', (e) => {
      const t = e.target.closest('.tab');
      if (t) setTab(t.dataset.tab);
    });
    $('themeSeg').addEventListener('click', (e) => {
      const b = e.target.closest('[data-theme-set]');
      if (b) setTheme(b.dataset.themeSet);
    });

    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
      if (e.key === 'Escape') { closePop(); const scrim = document.querySelector('.scrim'); if (scrim) scrim.remove(); return; }
      if (typing) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowRight' || e.key === 'j') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft' || e.key === 'k') { e.preventDefault(); prev(); }
      else if (e.key >= '1' && e.key <= '4') setTab(TABS[+e.key - 1].id);
      else if (e.key === '/') { e.preventDefault(); const q = $('q'); if (q) q.focus(); }
      else if (e.key === 'm') {
        const r = curRun();
        if (!r) return;
        const nb = $('noteBox');
        const m = Object.assign({ verdict: '未核', label: '', note: '' }, getMark(r));
        if (nb) m.note = nb.value; // 先把没落盘的备注收走
        m.verdict = VERDICTS[(VERDICTS.indexOf(m.verdict || '未核') + 1) % VERDICTS.length];
        setMark(r, m);
        repaintRun();
      }
    });

    // 拖拽导入
    let dragDepth = 0;
    window.addEventListener('dragenter', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragDepth++; $('drop').classList.add('on'); } });
    window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('drop').classList.remove('on'); });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      dragDepth = 0;
      $('drop').classList.remove('on');
      const items = e.dataTransfer.items;
      if (!items || !items.length) return;
      const entries = [];
      const roots = [];
      for (const it of items) {
        const entry = it.webkitGetAsEntry && it.webkitGetAsEntry();
        if (entry) roots.push(entry);
      }
      if (roots.length) {
        for (const r of roots) entries.push(...await walkEntry(r));
        await importEntries(entries);
      } else {
        const files = [...e.dataTransfer.files].map((f) => ({ path: f.name, name: f.name, file: f }));
        await importEntries(files);
      }
    });
  }

  function setTheme(t) {
    S.theme = t;
    applyTheme();
    try { localStorage.setItem(LS.theme, t); } catch (e) { /* ignore */ }
    document.querySelectorAll('#themeSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeSet === t)));
  }
  function applyTheme() {
    const dark = S.theme === 'dark' || (S.theme === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }

  /* ───────────────────────────── 启动 ───────────────────────────── */

  async function boot() {
    loadMarks();
    try { S.theme = localStorage.getItem(LS.theme) || 'auto'; } catch (e) { /* ignore */ }
    try { S.autoNext = localStorage.getItem(LS.autoNext) === '1'; } catch (e) { /* ignore */ }
    setTheme(S.theme);
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      if (mq.addEventListener) mq.addEventListener('change', () => { if (S.theme === 'auto') applyTheme(); });
    }
    bindChrome();
    paint();

    // 恢复上次的批次
    try {
      const list = await store.all();
      if (list && list.length) {
        S.batches = list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        let last = null;
        try { last = localStorage.getItem(LS.last); } catch (e) { /* ignore */ }
        const pick = S.batches.find((b) => b.id === last) || S.batches[S.batches.length - 1];
        setActive(pick.id);
      }
    } catch (e) {
      S.storageOk = false;
    }
    paint();
  }

  window.ReviewUI = {
    state: S,
    importEntries, importFromFiles, importPaths, goto, gotoSeq,
    get batch() { return batch(); },
    render: paint,
  };

  boot();
})();
