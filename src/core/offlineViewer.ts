import type { MaterialPackage } from '../types/domain';

/**
 * 生成离线审阅器 index.html：内嵌材料 JSON 与原生脚本，零依赖、零网络请求。
 * 双击即可打开，用于审计员在无网环境核对行金额与证据引用。
 */
export function buildOfflineViewerHtml(material: MaterialPackage): string {
  const payload = JSON.stringify(material).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const title = escapeHtml(material.title);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>离线稽核材料 · ${title}</title>
<style>
  :root{--ink:#12212b;--muted:#5e6c74;--line:#d9d4c8;--paper:#f7f4ec;--card:#ffffff;--teal:#0d5b56;--teal-soft:#e3efec;--amber:#a65a17;--amber-soft:#fbf0df;--red:#8f2f2f;--red-soft:#f9e6e3}
  *{box-sizing:border-box}
  body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.55 "Noto Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif}
  header{background:var(--ink);color:#f4f1e8;padding:18px 26px;display:flex;gap:26px;align-items:flex-start;flex-wrap:wrap}
  header h1{font-size:18px;margin:0 0 4px;letter-spacing:.3px}
  header .meta{font-size:12px;opacity:.72;line-height:1.7}
  .kpis{display:flex;gap:22px;margin-left:auto;flex-wrap:wrap}
  .kpi{min-width:112px}
  .kpi b{display:block;font-size:19px;font-variant-numeric:tabular-nums}
  .kpi span{font-size:11px;opacity:.65;letter-spacing:.6px}
  main{padding:20px 26px 60px;max-width:1280px;margin:0 auto}
  .bar{display:flex;gap:10px;align-items:center;margin-bottom:14px;flex-wrap:wrap}
  input[type=search],select{padding:7px 10px;border:1px solid var(--line);border-radius:6px;background:#fff;font:inherit;color:inherit}
  input[type=search]{min-width:240px}
  .chip{border:1px solid var(--line);border-radius:99px;padding:4px 11px;background:#fff;font-size:12px;cursor:pointer}
  .chip.on{background:var(--teal);color:#fff;border-color:var(--teal)}
  table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:8px;overflow:hidden}
  th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #ece7db;font-size:12.5px;vertical-align:top}
  th{background:#f1ede2;font-weight:600;font-size:11px;letter-spacing:.4px;color:#3c4a50;position:sticky;top:0;z-index:1}
  tbody tr{cursor:pointer}
  tbody tr:hover{background:var(--teal-soft)}
  tbody tr.sel{background:var(--teal-soft);outline:2px solid var(--teal);outline-offset:-2px}
  .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .tag{display:inline-block;padding:1px 7px;border-radius:99px;font-size:11px;line-height:1.7;border:1px solid transparent;white-space:nowrap}
  .tag.ok{background:var(--teal-soft);color:var(--teal);border-color:#bcd6d1}
  .tag.warn{background:var(--amber-soft);color:var(--amber);border-color:#ecd2a8}
  .tag.bad{background:var(--red-soft);color:var(--red);border-color:#e7bcb6}
  .tag.mute{background:#ece9df;color:var(--muted);border-color:#ddd8ca}
  .layout{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(320px,1fr);gap:16px;align-items:start}
  .panel{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px 16px}
  .panel h2{font-size:13px;letter-spacing:.6px;margin:0 0 10px;color:#3c4a50;text-transform:uppercase}
  .panel h3{font-size:12px;margin:16px 0 6px;color:var(--muted);letter-spacing:.4px}
  .kv{display:grid;grid-template-columns:96px 1fr;gap:3px 10px;font-size:12.5px}
  .kv dt{color:var(--muted)}
  .kv dd{margin:0;font-variant-numeric:tabular-nums}
  .evidence{border:1px solid #e8e2d4;border-radius:6px;padding:9px 11px;margin-bottom:8px;background:#fdfcf8}
  .evidence b{font-size:12.5px}
  .evidence p{margin:4px 0 0;color:var(--muted);font-size:12px}
  .scroll{max-height:520px;overflow:auto}
  .pill-row{display:flex;gap:5px;flex-wrap:wrap}
  section.panel h2{font-size:13px;letter-spacing:.6px;margin:0 0 10px;color:#3c4a50;text-transform:uppercase}
footer{max-width:1280px;margin:0 auto;padding:0 26px 40px;color:var(--muted);font-size:11.5px}
  code{font-size:11.5px;background:#f0ece1;padding:1px 5px;border-radius:4px;word-break:break-all}
  .empty{padding:26px;text-align:center;color:var(--muted)}
  @media (max-width:960px){.layout{grid-template-columns:1fr}header{padding:16px 18px}.kpis{margin-left:0}main{padding:16px 18px 40px}}
</style>
</head>
<body>
<header>
  <div>
    <h1>${title}</h1>
    <div class="meta">
      材料编号 ${material.id} · 版本 V${material.version} · 封存于 ${escapeHtml(material.createdAt)}<br/>
      数据源 ${material.datasetId} · ${material.rowCount} 条结算行 · 生成人 ${escapeHtml(material.createdBy)}<br/>
      内容摘要 <code style="background:rgba(255,255,255,.12);color:#e8e2d2">${material.verification.contentDigest.slice(0, 24)}…</code>
    </div>
  </div>
  <div class="kpis">
    <div class="kpi"><b>${fmtMoney(material.totals.paymentCents)}</b><span>支付金额（元，去重）</span></div>
    <div class="kpi"><b>${material.totals.hitCount}</b><span>规则命中（条）</span></div>
    <div class="kpi"><b>${material.totals.pendingRows}</b><span>待核 / 待结论</span></div>
    <div class="kpi"><b>${fmtMoney(material.totals.dedupeSavedCents)}</b><span>剔除重复计额（元）</span></div>
  </div>
</header>
<main>
  <div class="bar">
    <input type="search" id="q" placeholder="搜索结算行号 / 机构 / 项目 / 规则编码" />
    <select id="state">
      <option value="">全部复核状态</option>
      <option value="待核">待核</option>
      <option value="待结论">待结论</option>
      <option value="已复核">已复核</option>
    </select>
    <button class="chip" id="multi">仅看多规则命中</button>
    <button class="chip" id="verify">校验信息</button>
    <span id="count" style="color:var(--muted);font-size:12px"></span>
  </div>
  <div class="layout">
    <div class="panel" style="padding:0;overflow:hidden">
      <div class="scroll">
        <table>
          <thead><tr><th>行号</th><th>结算行</th><th>服务日</th><th>项目</th><th>机构</th><th class="num">支付金额</th><th>命中</th><th>资质</th><th>结论</th></tr></thead>
          <tbody id="rows"></tbody>
        </table>
      </div>
    </div>
    <div id="detail" class="panel"><div class="empty">选择左侧任意结算行，核对支付金额及其依据</div></div>
  </div>
  <section id="verifyPanel" class="panel" style="margin-top:16px;display:none">
    <h2>材料校验信息</h2>
    <div id="verifyBody"></div>
  </section>
</main>
<footer>
  本文件由稽核证据台离线生成，所有校验信息内嵌，不需要网络即可打开。金额以“分”为最小单位在材料中存储，界面显示为元。
  若同一结算行命中多条规则，支付金额仅在行主表计一次，规则命中作为独立证据逐条解释。资质重叠或空档一律列为待核，不指定版本。
</footer>
<script>
const MATERIAL = ${payload};
const byId = new Map(MATERIAL.rows.map(r => [r.settlementId, r]));
const hitById = new Map(MATERIAL.evidence.hits.map(h => [h.id, h]));
const qualById = new Map(MATERIAL.evidence.qualifications.map(q => [q.id, q]));
const conById = new Map(MATERIAL.evidence.conclusions.map(c => [c.id, c]));
let selected = null;
let onlyMulti = false;

function fmt(c){return (c/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});}
function esc(s){return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function stateTag(state){
  const cls = state === '已复核' ? 'ok' : state === '待核' ? 'bad' : 'warn';
  return '<span class="tag '+cls+'">'+esc(state)+'</span>';
}
function qualTag(row){
  if (row.qualificationStatus === 'ok') return '<span class="tag ok">'+esc(row.qualificationLabel)+'</span>';
  if (row.qualificationStatus === 'inactive') return '<span class="tag warn">'+esc(row.qualificationLabel)+'</span>';
  return '<span class="tag bad">'+esc(row.qualificationLabel)+'</span>';
}

function filtered(){
  const q = document.getElementById('q').value.trim().toLowerCase();
  const state = document.getElementById('state').value;
  return MATERIAL.rows.filter(r => {
    if (state && r.reviewState !== state) return false;
    if (onlyMulti && r.hitIds.length < 2) return false;
    if (!q) return true;
    const hay = [r.settlementId, r.rowNumber, r.institutionName, r.institutionCode, r.itemName, r.itemCode, r.areaName, r.hitCodes.join(' ')].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

function renderList(){
  const rows = filtered();
  document.getElementById('count').textContent = rows.length + ' / ' + MATERIAL.rows.length + ' 行';
  document.getElementById('rows').innerHTML = rows.map(r => {
    return '<tr data-id="'+esc(r.settlementId)+'" class="'+(selected===r.settlementId?'sel':'')+'">'
      + '<td class="num">'+(r.rowNumber-1)+'</td>'
      + '<td><code>'+esc(r.settlementId)+'</code></td>'
      + '<td>'+esc(r.serviceDate)+'</td>'
      + '<td>'+esc(r.itemName)+'</td>'
      + '<td>'+esc(r.institutionName)+'</td>'
      + '<td class="num">'+fmt(r.paymentAmountCents)+'</td>'
      + '<td><div class="pill-row">'+r.hitCodes.map(c => '<span class="tag mute">'+esc(c)+'</span>').join('')+'</div></td>'
      + '<td>'+qualTag(r)+'</td>'
      + '<td>'+stateTag(r.reviewState)+'</td>'
      + '</tr>';
  }).join('') || '<tr><td colspan="9" class="empty">没有符合条件的结算行</td></tr>';
}

function renderDetail(){
  const el = document.getElementById('detail');
  const row = selected ? byId.get(selected) : null;
  if (!row){ el.innerHTML = '<div class="empty">选择左侧任意结算行，核对支付金额及其依据</div>'; return; }
  const hits = row.hitIds.map(id => hitById.get(id)).filter(Boolean);
  const quals = row.qualificationCandidateIds.map(id => qualById.get(id)).filter(Boolean);
  const con = row.conclusionId ? conById.get(row.conclusionId) : null;
  const hintSum = hits.reduce((a,h)=>a+h.hintAmountCents,0);
  el.innerHTML = ''
    + '<h2>结算行 '+esc(row.settlementId)+'</h2>'
    + '<dl class="kv">'
    + '<dt>支付金额</dt><dd><b>'+fmt(row.paymentAmountCents)+'</b> 元 <span class="tag mute">仅计一次</span></dd>'
    + '<dt>疑似金额</dt><dd>'+fmt(row.suspectedAmountCents)+' 元</dd>'
    + '<dt>服务日</dt><dd>'+esc(row.serviceDate)+'</dd>'
    + '<dt>项目</dt><dd>'+esc(row.itemName)+'（'+esc(row.itemCode)+'）</dd>'
    + '<dt>机构</dt><dd>'+esc(row.institutionName)+'（'+esc(row.institutionCode)+'）</dd>'
    + '<dt>统筹区</dt><dd>'+esc(row.areaName)+'</dd>'
    + '<dt>险种 / 就诊</dt><dd>'+esc(row.fundType)+' / '+esc(row.visitType)+'</dd>'
    + '<dt>行摘要</dt><dd><code>'+esc(row.inputDigest)+'</code></dd>'
    + '</dl>'
    + '<h3>规则命中 · '+hits.length+' 条（金额不参与汇总）</h3>'
    + (hits.length ? hits.map(h => '<div class="evidence"><b>'+esc(h.ruleCode)+' '+esc(h.ruleName)+'</b> '
        + '<span class="tag '+(h.severity==='高'?'bad':h.severity==='中'?'warn':'mute')+'">'+esc(h.severity)+'</span>'
        + '<p>'+esc(h.clause)+'</p><p>'+esc(h.finding)+'</p>'
        + '<p>置信度 '+h.confidence+' · 仅解释金额 '+fmt(h.hintAmountCents)+' 元 · 批次 '+esc(h.sourceBatchId)+'</p></div>').join('')
        : '<p style="color:var(--muted);font-size:12px">本行无规则命中。</p>')
    + (hits.length > 1 ? '<p style="font-size:11.5px;color:var(--amber)">提示：'+hits.length+' 条命中若逐一累加将得到 '+fmt(hintSum)+' 元，与实际支付 '+fmt(row.paymentAmountCents)+' 元不可直接相加；材料按行唯一计额。</p>' : '')
    + '<h3>资质依据 · '+(quals.length)+' 份快照</h3>'
    + (quals.length ? quals.map(q => '<div class="evidence"><b>'+esc(q.id)+'</b> '
        + '<span class="tag '+(q.state==='有效'?'ok':'bad')+'">'+esc(q.state)+'</span>'
        + (row.primaryQualificationId === q.id ? ' <span class="tag ok">本次采用</span>' : '')
        + '<p>'+esc(q.certNo)+' · 有效期 '+(q.validTo?'':'自 ')+esc(q.validFrom)+' 至 '+(q.validTo?esc(q.validTo):'长期')+'</p>'
        + '<p>'+esc(q.note)+'</p></div>').join('')
        : '<p style="font-size:12px"><span class="tag bad">资质空档</span> 服务日无快照覆盖，列为待核，不推定版本。</p>')
    + '<h3>处理结论</h3>'
    + (con ? '<div class="evidence"><b>'+esc(con.code)+'</b><p>'+esc(con.label)+'</p><p>追回金额 '+fmt(con.deductionCents)+' 元 · 经办人 '+esc(con.handler)+' · 决定日 '+esc(con.decidedAt)+'</p></div>'
        : '<p style="color:var(--muted);font-size:12px">尚无处理结论，列为待结论。</p>');
}

document.getElementById('rows').addEventListener('click', e => {
  const tr = e.target.closest('tr[data-id]');
  if (!tr) return;
  selected = tr.getAttribute('data-id');
  renderList(); renderDetail();
});
document.getElementById('q').addEventListener('input', renderList);
document.getElementById('state').addEventListener('change', renderList);
document.getElementById('multi').addEventListener('click', () => {
  onlyMulti = !onlyMulti;
  document.getElementById('multi').classList.toggle('on', onlyMulti);
  renderList();
});

function renderVerification(){
  const v = MATERIAL.verification;
  const rows = (v.checks || []).map(c => '<div class="evidence"><b>'
    + (c.passed ? '<span class="tag ok">通过</span>' : '<span class="tag bad">失败</span>') + ' '
    + esc(c.label) + '</b><p>期望：' + esc(c.expected) + '</p><p>实际：' + esc(c.actual) + '</p></div>').join('');
  document.getElementById('verifyBody').innerHTML = ''
    + '<p style="font-size:12px;color:var(--muted)">算法 ' + esc(v.algorithm) + ' · 生成于 ' + esc(v.generatedAt) + ' · 整体'
    + (v.passed ? ' <span class="tag ok">通过</span>' : ' <span class="tag bad">未通过</span>') + '</p>'
    + '<p style="font-size:11.5px;margin:8px 0 4px;color:var(--muted)">内容摘要</p><code>' + esc(v.contentDigest) + '</code>'
    + '<p style="font-size:11.5px;margin:8px 0 4px;color:var(--muted)">汇总摘要</p><code>' + esc(v.totalsDigest) + '</code>'
    + '<div style="margin-top:12px">' + rows + '</div>'
    + '<h3>来源清单</h3>'
    + MATERIAL.manifest.map(m => '<div class="evidence"><b>' + esc(m.kind) + '</b><p>'
      + esc(m.fileName) + ' · 批次 ' + esc(m.batchId) + ' · 版本 ' + esc(m.sourceVersion)
      + ' · ' + m.rowCount + ' 条</p><p style="word-break:break-all">' + esc(m.sha256) + '</p></div>').join('');
}
document.getElementById('verify').addEventListener('click', () => {
  const panel = document.getElementById('verifyPanel');
  const show = panel.style.display === 'none';
  panel.style.display = show ? 'block' : 'none';
  document.getElementById('verify').classList.toggle('on', show);
  if (show) renderVerification();
});
renderList();
</script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

function fmtMoney(cents: number): string {
  return (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
