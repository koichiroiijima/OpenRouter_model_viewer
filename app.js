const API_URL = 'https://openrouter.ai/api/v1/models';
const PER_MILLION = 1_000_000;

const tbody = document.getElementById('tbody');
const compareBody = document.getElementById('compare-body');
const compareWrap = document.getElementById('compare-wrap');
const compareEmpty = document.getElementById('compare-empty');
const searchInput = document.getElementById('search');
const statusEl = document.getElementById('status');
const resultCountEl = document.getElementById('result-count');
const clearBtn = document.getElementById('clear-btn');
const filterKpiEl = document.getElementById('filter-kpi');
const filterPriceEl = document.getElementById('filter-price');
const ths = Array.from(document.querySelectorAll('#models-table thead th'));
const cmpThs = Array.from(document.querySelectorAll('#compare-table thead th'));
const xAxisSel = document.getElementById('x-axis');
const yAxisSel = document.getElementById('y-axis');
const scatterSvg = document.getElementById('scatter-svg');
const scatterEmptyEl = document.getElementById('scatter-empty');
const scatterNoteEl = document.getElementById('scatter-note');

// 散布図の軸に使える指標（値が無いモデルはプロット対象外）
const METRICS = [
  { key: 'coding', label: 'Coding' },
  { key: 'intelligence', label: 'Intelligence' },
  { key: 'agent', label: 'Agent' },
  { key: 'input', label: '入力 ($/1M)' },
  { key: 'output', label: '出力 ($/1M)' },
  { key: 'cache', label: 'キャッシュ読込 ($/1M)' },
];

// 料金系の指標（0 以下は表と同様に「データ無し」扱い。スコアの 0 は実値）
const PRICE_KEYS = new Set(['input', 'output', 'cache']);

let models = [];
let query = '';
let sortKey = 'released';
let sortDir = 'desc';
let cmpKey = null;
let cmpDir = 'asc';
const selectedModels = new Set();

function fmtPrice(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n >= 100 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toFixed(3);
}

function fmtPriceNum(v) {
  return fmtPrice(v) != null ? Number(v) : null;
}

function fmtContext(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n.toLocaleString('en-US') : null;
}

function fmtScore(v) {
  if (v == null || !Number.isFinite(Number(v))) return null;
  return Number(v).toFixed(1);
}

// スコア値から強調クラスを返す（無い場合はプレースホルダ）
function scoreCls(v) {
  if (v == null || !Number.isFinite(Number(v))) return 'score placeholder';
  const n = Number(v);
  return n >= 70 ? 'score-high' : n >= 50 ? 'score-ok' : 'score-low';
}

function fmtDate(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toLocaleDateString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
}

function normalize(raw) {
  const pricing = raw.pricing || {};
  const provider = (raw.id || '').split('/')[0] || '—';
  const context = raw.context_length != null
    ? raw.context_length
    : (raw.top_provider && raw.top_provider.context_length);
  const aa = (raw.benchmarks && raw.benchmarks.artificial_analysis) || {};
  return {
    id: raw.id || '',
    name: raw.name || raw.id || '—',
    provider,
    context,
    input: Number(pricing.prompt) * PER_MILLION,
    output: Number(pricing.completion) * PER_MILLION,
    cache: Number(pricing.input_cache_read) * PER_MILLION,
    released: Number(raw.created) || 0,
    description: raw.description || '',
    coding: aa.coding_index != null ? Number(aa.coding_index) : null,
    intelligence: aa.intelligence_index != null ? Number(aa.intelligence_index) : null,
    agent: aa.agentic_index != null ? Number(aa.agentic_index) : null,
  };
}

function setStatus(html, isError = false) {
  if (html) {
    statusEl.innerHTML = html;
    statusEl.className = 'status' + (isError ? ' error' : '');
    statusEl.hidden = false;
  } else {
    statusEl.hidden = true;
  }
}

function visibleModels() {
  let rows = models;
  // 性能KPI: Coding / Intelligence / Agent の 3 指標が全て揃っているモデルのみ
  if (filterKpiEl.checked) {
    rows = rows.filter(m => m.coding != null && m.intelligence != null && m.agent != null);
  }
  // 価格: 入力・出力の両方があるモデルのみ（キャッシュは見ない）
  if (filterPriceEl.checked) {
    rows = rows.filter(m => fmtPriceNum(m.input) != null && fmtPriceNum(m.output) != null);
  }
  if (!query) return rows.slice();
  const q = query.toLowerCase();
  return rows.filter(m =>
    m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
  );
}

function compareBy(a, b, key, dir) {
  const av = a[key];
  const bv = b[key];
  const numeric = key !== 'name' && key !== 'provider' && key !== 'description';
  const aValid = numeric ? fmtPriceNum(av) != null : true;
  const bValid = numeric ? fmtPriceNum(bv) != null : true;

  if (numeric) {
    if (aValid !== bValid) return aValid ? -1 : 1;
    if (!aValid) return 0;
    const diff = av - bv;
    return dir === 'asc' ? diff : -diff;
  }

  const aStr = String(av).toLowerCase();
  const bStr = String(bv).toLowerCase();
  const cmp = aStr.localeCompare(bStr);
  return dir === 'asc' ? cmp : -cmp;
}

function compare(a, b) {
  return compareBy(a, b, sortKey, sortDir);
}

function renderCandidates() {
  const rows = visibleModels().sort(compare);

  if (!models.length) {
    tbody.innerHTML = '';
    return;
  }

  if (!rows.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="11">該当するモデルがありません。</td></tr>';
    resultCountEl.textContent = '0 件';
    return;
  }

  tbody.innerHTML = rows.map(m => {
    const isSel = selectedModels.has(m.id);
    const checked = isSel ? ' checked' : '';
    const selCls = isSel ? ' selected' : '';
    const inP = fmtPrice(m.input);
    const outP = fmtPrice(m.output);
    const cacheP = fmtPrice(m.cache);
    const ctx = fmtContext(m.context);
    const rel = fmtDate(m.released);
    const coding = fmtScore(m.coding);
    const intelligence = fmtScore(m.intelligence);
    const agent = fmtScore(m.agent);
    return `<tr data-id="${escapeHtml(m.id)}" class="${selCls}">
      <td class="chk"><input type="checkbox" value="${escapeHtml(m.id)}"${checked} aria-label="比較に追加"></td>
      <td class="model">${escapeHtml(m.name)}<div class="sub-id">${escapeHtml(m.id)}</div></td>
      <td>${escapeHtml(m.provider)}</td>
      <td class="num">${rel ? rel : ''}</td>
      <td class="num">${ctx ? ctx : ''}</td>
      <td class="num ${scoreCls(m.coding)}">${coding ? coding : ''}</td>
      <td class="num ${scoreCls(m.intelligence)}">${intelligence ? intelligence : ''}</td>
      <td class="num ${scoreCls(m.agent)}">${agent ? agent : ''}</td>
      <td class="num ${inP ? '' : 'price placeholder'}">${inP ? '$' + inP : ''}</td>
      <td class="num ${outP ? '' : 'price placeholder'}">${outP ? '$' + outP : ''}</td>
      <td class="num ${cacheP ? '' : 'price placeholder'}">${cacheP ? '$' + cacheP : ''}</td>
    </tr>`;
  }).join('');

  const selectedVisible = rows.filter(m => selectedModels.has(m.id)).length;
  resultCountEl.textContent = `${rows.length.toLocaleString('en-US')} / ${models.length.toLocaleString('en-US')} 件 ・ 選択中 ${selectedVisible}`;
}

function rowForId(model) {
  return `<tr data-id="${escapeHtml(model.id)}">
    <td class="model">${escapeHtml(model.name)}<div class="sub-id">${escapeHtml(model.id)}</div><button class="remove-btn" data-id="${escapeHtml(model.id)}" type="button" aria-label="比較から外す">×</button></td>
    <td class="num cell-released">${fmtDate(model.released) || ''}</td>
    <td class="num">${fmtScore(model.coding) || ''}</td>
    <td class="num">${fmtScore(model.intelligence) || ''}</td>
    <td class="num">${fmtScore(model.agent) || ''}</td>
    <td class="num cell-input">${fmtPrice(model.input) ? '$' + fmtPrice(model.input) : ''}</td>
    <td class="num cell-output">${fmtPrice(model.output) ? '$' + fmtPrice(model.output) : ''}</td>
    <td class="num cell-cache">${fmtPrice(model.cache) ? '$' + fmtPrice(model.cache) : ''}</td>
    <td class="desc">${escapeHtml(model.description)}</td>
  </tr>`;
}

function renderCompare() {
  if (!selectedModels.size) {
    compareEmpty.hidden = false;
    compareWrap.hidden = true;
    clearBtn.disabled = true;
    return;
  }

  compareEmpty.hidden = true;
  compareWrap.hidden = false;
  clearBtn.disabled = false;

  // 検索条件に関わらず、選択中の全モデルを表示（選択状態を保持）
  // 比較ペインのソート（cmpKey）が指定されていればその順序で並べる
  let order = models.filter(m => selectedModels.has(m.id));
  if (cmpKey) {
    order = order.slice().sort((a, b) => compareBy(a, b, cmpKey, cmpDir));
  }
  compareBody.innerHTML = order.map(rowForId).join('');

  // 各価格列ごとに最安値をハイライト（無効値は除外）
  ['input', 'output', 'cache'].forEach(key => {
    const values = order
      .map(m => ({ m, v: fmtPriceNum(m[key]) }))
      .filter(x => x.v != null);
    if (!values.length) return;
    const minKey = values.reduce((best, x) => x.v < best.v ? x : best, values[0]);
    const minRow = compareBody.querySelector(`tr[data-id="${CSS.escape(minKey.m.id)}"]`);
    if (minRow) minRow.querySelector(`.cell-${key}`).classList.add('best');
  });
}

// ---------- 散布図 ----------
const SCATTER_W = 760;
const SCATTER_H = 460;
const SCATTER_PAD = { top: 20, right: 24, bottom: 44, left: 56 };

function initScatterControls() {
  const options = METRICS.map(m => `<option value="${m.key}">${m.label}</option>`).join('');
  xAxisSel.innerHTML = options;
  yAxisSel.innerHTML = options;
  xAxisSel.value = METRICS[0].key;
  yAxisSel.value = METRICS[1].key;
}

// データ範囲に少し余裕を持たせた軸ドメイン
function niceDomain(values) {
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.08;
  return [min - pad, max + pad];
}

// きりの良い間隔の目盛り値
function tickValues(min, max, count = 5) {
  const rawStep = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const start = Math.ceil(min / step) * step;
  const out = [];
  for (let v = start; v <= max + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

function fmtTick(v) {
  return String(Number(Number(v).toPrecision(3)));
}

// 対数軸の目盛り（桁ごとの 1・2・5。極端に狭い範囲では線形目盛りにフォールバック）
function logTicks(min, max) {
  const out = [];
  for (let d = Math.floor(Math.log10(min)); d <= Math.ceil(Math.log10(max)); d++) {
    for (const mul of [1, 2, 5]) {
      const v = mul * Math.pow(10, d);
      if (v >= min * 1.02 && v <= max / 1.02) out.push(v);
    }
  }
  return out.length >= 2 ? out.sort((a, b) => a - b) : tickValues(min, max);
}

// ツールチップ用の値整形（料金系は $ 付き・表と同じ桁数）
function fmtMetric(key, v) {
  return PRICE_KEYS.has(key) ? '$' + fmtPrice(v) : fmtTick(v);
}

function shortLabel(s, n = 22) {
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function renderScatter() {
  const hasSelection = selectedModels.size > 0;
  const xKey = xAxisSel.value;
  const yKey = yAxisSel.value;

  if (!hasSelection) {
    scatterEmptyEl.textContent = '左ペインでプロットしたいモデルを選択してください。';
    scatterEmptyEl.hidden = false;
    scatterSvg.hidden = true;
    scatterNoteEl.textContent = '';
    return;
  }

  // 両方の指標を持つモデルのみプロット対象（料金系は正の値のみ）
  const valid = (key, v) =>
    v != null && Number.isFinite(Number(v)) &&
    (PRICE_KEYS.has(key) ? Number(v) > 0 : true);
  const pts = models.filter(m =>
    selectedModels.has(m.id) && valid(xKey, m[xKey]) && valid(yKey, m[yKey])
  );

  if (!pts.length) {
    scatterEmptyEl.textContent = '選択中のモデルに両方の指標（' +
      METRICS.find(m => m.key === xKey).label + ' / ' + METRICS.find(m => m.key === yKey).label +
      '）が揃っているものがありません。';
    scatterEmptyEl.hidden = false;
    scatterSvg.hidden = true;
    scatterNoteEl.textContent = '';
    return;
  }

  // 料金系は値の桁が広い（$0.001〜$100+）ため対数スケール
  const xLog = PRICE_KEYS.has(xKey);
  const yLog = PRICE_KEYS.has(yKey);
  const [xMin, xMax] = niceDomain(pts.map(p => xLog ? Math.log10(p[xKey]) : p[xKey]));
  const [yMin, yMax] = niceDomain(pts.map(p => yLog ? Math.log10(p[yKey]) : p[yKey]));
  const px = v => SCATTER_PAD.left +
    ((xLog ? Math.log10(v) : v) - xMin) / (xMax - xMin) *
    (SCATTER_W - SCATTER_PAD.left - SCATTER_PAD.right);
  const py = v => SCATTER_H - SCATTER_PAD.bottom -
    ((yLog ? Math.log10(v) : v) - yMin) / (yMax - yMin) *
    (SCATTER_H - SCATTER_PAD.top - SCATTER_PAD.bottom);

  const parts = [];

  // グリッド線と目盛りラベル
  (xLog ? logTicks(Math.pow(10, xMin), Math.pow(10, xMax)) : tickValues(xMin, xMax)).forEach(v => {
    const x = px(v);
    parts.push(`<line class="gridline" x1="${x}" y1="${SCATTER_PAD.top}" x2="${x}" y2="${SCATTER_H - SCATTER_PAD.bottom}"></line>`);
    parts.push(`<text class="tick-label" x="${x}" y="${SCATTER_H - SCATTER_PAD.bottom + 18}" text-anchor="middle">${xLog ? '$' + fmtPrice(v) : fmtTick(v)}</text>`);
  });
  (yLog ? logTicks(Math.pow(10, yMin), Math.pow(10, yMax)) : tickValues(yMin, yMax)).forEach(v => {
    const y = py(v);
    parts.push(`<line class="gridline" x1="${SCATTER_PAD.left}" y1="${y}" x2="${SCATTER_W - SCATTER_PAD.right}" y2="${y}"></line>`);
    parts.push(`<text class="tick-label" x="${SCATTER_PAD.left - 8}" y="${y + 4}" text-anchor="end">${yLog ? '$' + fmtPrice(v) : fmtTick(v)}</text>`);
  });

  // 軸線
  parts.push(`<line class="axis-line" x1="${SCATTER_PAD.left}" y1="${SCATTER_PAD.top}" x2="${SCATTER_PAD.left}" y2="${SCATTER_H - SCATTER_PAD.bottom}"></line>`);
  parts.push(`<line class="axis-line" x1="${SCATTER_PAD.left}" y1="${SCATTER_H - SCATTER_PAD.bottom}" x2="${SCATTER_W - SCATTER_PAD.right}" y2="${SCATTER_H - SCATTER_PAD.bottom}"></line>`);

  // プロット点（ネイティブのツールチップ付き）
  pts.forEach(m => {
    const cx = px(m[xKey]);
    const cy = py(m[yKey]);
    parts.push(
      `<g><circle class="point" cx="${cx}" cy="${cy}" r="6">` +
      `<title>${escapeHtml(m.name)}\n${METRICS.find(mm => mm.key === xKey).label}: ${fmtMetric(xKey, m[xKey])}\n${METRICS.find(mm => mm.key === yKey).label}: ${fmtMetric(yKey, m[yKey])}</title>` +
      `</circle>` +
      `<text class="pt-label" x="${cx + 9}" y="${cy - 7}">${escapeHtml(shortLabel(m.name))}</text></g>`
    );
  });

  scatterSvg.innerHTML = parts.join('');
  scatterSvg.hidden = false;
  scatterEmptyEl.hidden = true;
  scatterNoteEl.textContent =
    `${pts.length.toLocaleString('en-US')} モデルをプロット` +
    (pts.length !== selectedModels.size
      ? `（選択 ${selectedModels.size.toLocaleString('en-US')} 件中、指標が無いモデルは除外）`
      : '');
}

function updateSortHeaders() {
  ths.forEach(th => th.classList.remove('sort-asc', 'sort-desc'));
  const th = ths.find(t => t.dataset.key === sortKey);
  if (th) th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
}

function handleSort(e) {
  const th = e.target.closest('th');
  if (!th) return;
  const key = th.dataset.key;
  if (!key) return;
  if (key === sortKey) {
    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    sortKey = key;
    sortDir = 'asc';
  }
  updateSortHeaders();
  renderCandidates();
}

function updateCmpHeaders() {
  cmpThs.forEach(th => th.classList.remove('sort-asc', 'sort-desc'));
  if (!cmpKey) return;
  const th = cmpThs.find(t => t.dataset.key === cmpKey);
  if (th) th.classList.add(cmpDir === 'asc' ? 'sort-asc' : 'sort-desc');
}

function handleCompareSort(e) {
  const th = e.target.closest('th');
  if (!th) return;
  const key = th.dataset.key;
  if (!key) return;
  if (key === cmpKey) {
    cmpDir = cmpDir === 'asc' ? 'desc' : 'asc';
  } else {
    cmpKey = key;
    cmpDir = 'asc';
  }
  updateCmpHeaders();
  renderCompare();
}

function handleCheckboxChange(e) {
  const cb = e.target.closest('input[type="checkbox"]');
  if (!cb) return;
  const id = cb.value;
  if (cb.checked) selectedModels.add(id);
  else selectedModels.delete(id);
  renderCandidates();
  renderCompare();
  renderScatter();
}

function handleCompareClick(e) {
  const btn = e.target.closest('.remove-btn');
  if (!btn) return;
  selectedModels.delete(btn.dataset.id);
  renderCandidates();
  renderCompare();
  renderScatter();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function load() {
  setStatus('<span>モデル情報を読み込み中…</span>');
  searchInput.disabled = true;
  try {
    const res = await fetch(API_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    models = (data.data || []).map(normalize);
    updateSortHeaders();
    initScatterControls();
    renderCandidates();
    renderCompare();
    renderScatter();
    setStatus('');
  } catch (err) {
    console.error(err);
    setStatus(
      `<strong>モデル情報の取得に失敗しました。</strong>
       <div class="retry-hint">ネットワーク接続を確認して、ページを再読み込みしてください。</div>`,
      true
    );
    tbody.innerHTML = '';
    compareWrap.hidden = true;
    compareEmpty.hidden = false;
    resultCountEl.textContent = '';
  } finally {
    searchInput.disabled = false;
  }
}

searchInput.addEventListener('input', (e) => {
  query = e.target.value.trim();
  renderCandidates();
});

filterKpiEl.addEventListener('change', renderCandidates);
filterPriceEl.addEventListener('change', renderCandidates);

clearBtn.addEventListener('click', () => {
  selectedModels.clear();
  renderCandidates();
  renderCompare();
  renderScatter();
});

xAxisSel.addEventListener('change', renderScatter);
yAxisSel.addEventListener('change', renderScatter);

tbody.addEventListener('change', handleCheckboxChange);
compareBody.addEventListener('click', handleCompareClick);
ths.forEach(th => th.addEventListener('click', handleSort));
cmpThs.forEach(th => th.addEventListener('click', handleCompareSort));

updateSortHeaders();
load();
