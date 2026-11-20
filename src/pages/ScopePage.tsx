import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderLock, RotateCcw, Check, CalendarRange, Layers3 } from 'lucide-react';
import { useApp } from '../store/AppStore';
import { PageHeader, Stat } from '../components/Page';
import { Badge } from '../components/Badge';
import { filterRows, isScopeEmpty, scopeFingerprint } from '../core/analysis';
import { formatCents, formatCount } from '../lib/money';
import { buildMaterial, diffMaterials, MANIFEST_SCHEMA } from '../core/material';
import { sha256Hex } from '../core/hash';
import { nowLocalIso } from '../lib/time';
import type { MaterialPackage, ScopeFilter } from '../types/domain';

const SAMPLE_SCOPES: Array<{ id: string; label: string; hint: string; scope: Partial<ScopeFilter> }> = [
  {
    id: 'pending',
    label: '全部待核行',
    hint: '资质空档 / 重叠 / 状态异常',
    scope: { onlyPending: true },
  },
  {
    id: 'jc06',
    label: '无痛胃肠镜 + 临江',
    hint: '检查项目 JC06 / 统筹区 3201',
    scope: { itemCodes: ['JC06'], areaCodes: ['3201'] },
  },
  {
    id: 'h005',
    label: '临江市人民医院 · 手术',
    hint: '机构 H005 / 项目 JC08',
    scope: { institutionCodes: ['H005'], itemCodes: ['JC08'] },
  },
  {
    id: 'r201',
    label: '命中 R-201 的行',
    hint: '无资质开展类规则',
    scope: { ruleCodes: ['R-201'] },
  },
];

export function ScopePage() {
  const { dataset, analysis, scope, setScope, materials, recordMaterial, toast, events } = useApp();
  const navigate = useNavigate();
  const [title, setTitle] = useState('2025 上半年抽查冻结材料');
  const [createdBy, setCreatedBy] = useState('稽核一组 · 王敏');
  const [showPreview, setShowPreview] = useState(true);

  const rows = useMemo(() => (analysis ? filterRows(analysis, scope) : []), [analysis, scope]);
  const totals = useMemo(() => {
    const paymentCents = rows.reduce((acc, item) => acc + item.row.paymentAmountCents, 0);
    const flatCents = rows.reduce(
      (acc, item) => acc + item.row.paymentAmountCents * Math.max(1, item.hits.length),
      0,
    );
    return {
      paymentCents,
      repeatCents: flatCents - paymentCents,
      hits: rows.reduce((acc, item) => acc + item.hits.length, 0),
      pending: rows.filter((item) => item.reviewState === '待核').length,
      hitRuleCodes: [...new Set(rows.flatMap((item) => item.hits.map((hit) => hit.ruleCode)))].sort(),
    };
  }, [rows]);

  const fingerprint = scopeFingerprint(scope);
  const fingerprintHash = useMemo(() => sha256Hex(fingerprint), [fingerprint]);
  const existingSameScope = useMemo(
    () => materials.find((material) => material.scopeHash === fingerprintHash),
    [materials, fingerprintHash],
  );

  const lastEvent = events.find((event) => event.kind === '冻结');

  const preview = useMemo(() => {
    if (!dataset) return null;
    return buildMaterial({
      analysis: analysis!,
      dataset,
      scope,
      version: materials.length + 1,
      basisPackageId: materials[0]?.id ?? null,
      correction: null,
      createdBy,
      createdAt: nowLocalIso(),
      title,
    });
  }, [analysis, dataset, scope, materials, createdBy, title]);

  const compareDiff = useMemo(() => {
    if (!preview || !materials[0]) return null;
    return diffMaterials(materials[0], preview);
  }, [preview, materials]);

  if (!dataset || !analysis) {
    return <div className="content"><div className="empty">载入中…</div></div>;
  }


  const toggle = (key: 'itemCodes' | 'areaCodes' | 'institutionCodes' | 'ruleCodes', code: string) => {
    const current = scope[key];
    const next = current.includes(code) ? current.filter((item) => item !== code) : [...current, code];
    setScope({ ...scope, [key]: next });
  };

  const reset = () => setScope({ ...scope, itemCodes: [], areaCodes: [], institutionCodes: [], ruleCodes: [], onlyPending: false });

  const freeze = async () => {
    if (rows.length === 0) {
      toast('当前范围没有结算行，无法冻结材料', 'warn');
      return;
    }
    const latest = materials[0];
    const version = materials.length + 1;
    const material: MaterialPackage = buildMaterial({
      analysis,
      dataset,
      scope,
      version,
      basisPackageId: latest?.id ?? null,
      correction: null,
      createdBy,
      createdAt: nowLocalIso(),
      title,
    });
    await recordMaterial(material, {
      kind: '冻结',
      title: `封存材料 ${material.id}`,
      detail: `范围 ${scopeLabel(scope)}，${material.rowCount} 行，支付金额 ¥${formatCents(material.totals.paymentCents)}；校验 ${material.verification.passed ? '通过' : '存在未通过项'}。`,
      materialId: material.id,
    });
    toast(`已封存材料 ${material.id}`);
    navigate('/materials');
  };

  return (
    <div className="content">
      <PageHeader
        kicker="Scope freeze"
        title="范围冻结"
        lead={
          <>
            按检查项目、统筹区、机构、规则与服务日期组合范围，材料只收纳范围内的结算行及其证据引用。
            冻结后生成带来源清单与 SHA-256 校验的本地材料包，可在完全离线环境打开复核。
          </>
        }
        actions={
          <>
            <button className="btn" onClick={reset}><RotateCcw size={14} /> 清空条件</button>
            <button className="btn primary" onClick={freeze} disabled={rows.length === 0}>
              <FolderLock size={15} /> 冻结为材料
            </button>
          </>
        }
      />

      <div className="grid cols-4">
        <Stat label="范围内结算行" value={formatCount(rows.length)} hint={`全量 ${formatCount(analysis.totals.rowCount)} 行`} />
        <Stat label="支付金额（行口径）" value={`¥${formatCents(totals.paymentCents)}`} accent="teal" small hint="一条行只计一次" />
        <Stat label="命中条数" value={formatCount(totals.hits)} accent="blue" hint={`${totals.hitRuleCodes.length} 类规则`} />
        <Stat label="重复计额风险" value={`¥${formatCents(totals.repeatCents)}`} accent="red" small hint="按命中摊平将多计的部分" />
      </div>

      <div className="grid split mt-16">
        <section className="card">
          <div className="card-head">
            <div>
              <h2>筛选维度</h2>
              <div className="desc">多个维度之间取交集，维度内部取并集。</div>
            </div>
            <div className="spacer">
              <span className="badge outline" title={fingerprint}>
                {existingSameScope ? `同范围材料 ${existingSameScope.id}` : '新范围'}
              </span>
            </div>
          </div>
          <div className="card-body">
            <div className="field">
              <label>快捷范围</label>
              <div className="chips">
                {SAMPLE_SCOPES.map((sample) => (
                  <button
                    key={sample.id}
                    className="chip"
                    onClick={() => setScope({ ...scope, ...sample.scope })}
                    title={sample.hint}
                  >
                    {sample.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-16">
              <div className="section-title"><Layers3 size={13} /> 检查项目</div>
              <div className="chips">
                {dataset.items.map((item) => (
                  <button
                    key={item.code}
                    className={`chip ${scope.itemCodes.includes(item.code) ? 'on' : ''}`}
                    onClick={() => toggle('itemCodes', item.code)}
                  >
                    {item.shortName}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-16">
              <div className="section-title">统筹区</div>
              <div className="chips">
                {dataset.areas.map((area) => (
                  <button
                    key={area.code}
                    className={`chip ${scope.areaCodes.includes(area.code) ? 'on' : ''}`}
                    onClick={() => toggle('areaCodes', area.code)}
                  >
                    {area.shortName} <span className="tiny muted mono">{area.code}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-16">
              <div className="section-title">机构</div>
              <div className="chips">
                {dataset.institutions.map((institution) => (
                  <button
                    key={institution.code}
                    className={`chip ${scope.institutionCodes.includes(institution.code) ? 'on' : ''}`}
                    onClick={() => toggle('institutionCodes', institution.code)}
                  >
                    {institution.shortName}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-16">
              <div className="section-title">规则</div>
              <div className="chips">
                {dataset.rules.map((rule) => (
                  <button
                    key={rule.code}
                    className={`chip ${scope.ruleCodes.includes(rule.code) ? 'on' : ''}`}
                    onClick={() => toggle('ruleCodes', rule.code)}
                  >
                    <span className="mono">{rule.code}</span> {rule.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-16 grid cols-2">
              <div className="field">
                <label><CalendarRange size={13} /> 服务日期起</label>
                <input type="date" value={scope.dateFrom} onChange={(event) => setScope({ ...scope, dateFrom: event.target.value })} />
              </div>
              <div className="field">
                <label>服务日期止</label>
                <input type="date" value={scope.dateTo} onChange={(event) => setScope({ ...scope, dateTo: event.target.value })} />
              </div>
            </div>

            <label className="row mt-16" style={{ gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={scope.onlyPending}
                onChange={(event) => setScope({ ...scope, onlyPending: event.target.checked })}
                style={{ width: 'auto' }}
              />
              仅纳入待核 / 待结论行
            </label>

            <div className="divider" />
            <div className="grid cols-2">
              <div className="field">
                <label>材料标题</label>
                <input value={title} onChange={(event) => setTitle(event.target.value)} />
              </div>
              <div className="field">
                <label>生成人</label>
                <input value={createdBy} onChange={(event) => setCreatedBy(event.target.value)} />
              </div>
            </div>
            <div className="tiny muted mt-8">
              当前条件指纹 <span className="mono">{scopeFingerprintHash(scope)}</span>
              {isScopeEmpty(scope) ? ' · 全量范围' : ''}
            </div>
          </div>
        </section>

        <div className="stack">
          <section className="card">
            <div className="card-head">
              <div>
                <h2>冻结预览</h2>
                <div className="desc">封存前预演材料结构与校验项。</div>
              </div>
              <div className="spacer">
                <button className="btn ghost sm" onClick={() => setShowPreview((value) => !value)}>
                  {showPreview ? '收起' : '展开'}
                </button>
              </div>
            </div>
            {showPreview && preview ? (
              <div className="card-body">
                <div className="stack tight" style={{ fontSize: 12.5 }}>
                  <div className="row between"><span className="muted">材料编号</span><span className="mono">{preview.id}</span></div>
                  <div className="row between"><span className="muted">结算行</span><span>{formatCount(preview.rowCount)}</span></div>
                  <div className="row between"><span className="muted">支付金额</span><span className="num">¥{formatCents(preview.totals.paymentCents)}</span></div>
                  <div className="row between"><span className="muted">证据条目</span><span>{preview.evidence.hits.length} 命中 / {preview.evidence.qualifications.length} 资质 / {preview.evidence.conclusions.length} 结论</span></div>
                  <div className="row between"><span className="muted">结构版本</span><span className="mono">{MANIFEST_SCHEMA}</span></div>
                </div>

                <div className="section-title mt-16">校验项</div>
                <div className="check-list">
                  {preview.verification.checks.map((check) => (
                    <div className="check-row" key={check.id}>
                      <span className={`check-icon ${check.passed ? 'pass' : 'fail'}`}>
                        <Check size={12} />
                      </span>
                      <div>
                        <div className="label">{check.label}</div>
                        <div className="detail">{check.actual}</div>
                      </div>
                      <Badge tone={check.passed ? 'ok' : 'bad'}>{check.passed ? '通过' : '需处理'}</Badge>
                    </div>
                  ))}
                </div>

                <div className="callout info mt-12" style={{ fontSize: 11.5 }}>
                  材料按“结算行主表 + 证据引用表”组织：金额只落在行主表，审阅人沿 hitIds / qualificationCandidateIds / conclusionId 跟随引用查看依据。
                </div>

                {compareDiff && compareDiff.changedRows.length > 0 ? (
                  <div className="callout mt-12" style={{ fontSize: 11.5 }}>
                    与最近材料 {materials[0].id} 相比，有 {compareDiff.changedRows.length} 行依据或状态发生变化，冻结后将作为新材料版本并标注受影响明细。
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="card">
            <div className="card-head">
              <div>
                <h2>范围口径</h2>
                <div className="desc">冻结材料随包附带的说明。</div>
              </div>
            </div>
            <div className="card-body">
              <dl className="kv">
                <dt>检查项目</dt><dd>{scope.itemCodes.length ? scope.itemCodes.join('、') : '全部'}</dd>
                <dt>统筹区</dt><dd>{scope.areaCodes.length ? scope.areaCodes.join('、') : '全部'}</dd>
                <dt>机构</dt><dd>{scope.institutionCodes.length ? scope.institutionCodes.join('、') : '全部'}</dd>
                <dt>规则</dt><dd>{scope.ruleCodes.length ? scope.ruleCodes.join('、') : '全部'}</dd>
                <dt>服务日期</dt><dd>{scope.dateFrom} ~ {scope.dateTo}</dd>
                <dt>仅待核</dt><dd>{scope.onlyPending ? '是' : '否'}</dd>
              </dl>
              <div className="divider" />
              <div className="small muted">
                {lastEvent
                  ? `最近冻结：${lastEvent.title} · ${lastEvent.at.slice(0, 16).replace('T', ' ')}`
                  : '尚未生成过冻结材料。'}
              </div>
              <button className="btn block primary mt-12" onClick={freeze} disabled={rows.length === 0}>
                <FolderLock size={15} /> 冻结 {formatCount(rows.length)} 行为材料
              </button>
            </div>
          </section>
        </div>
      </div>

      <section className="card mt-16">
        <div className="card-head">
          <div>
            <h2>范围内明细预审</h2>
            <div className="desc">前 50 行，点击行号或右侧可见关键依据摘要。</div>
          </div>
          <div className="spacer"><Badge tone="outline">{formatCount(rows.length)} 行</Badge></div>
        </div>
        <div className="table-wrap" style={{ maxHeight: 380 }}>
          <table className="data">
            <thead>
              <tr>
                <th>结算行</th><th>服务日</th><th>项目</th><th>机构</th>
                <th className="num">支付金额</th><th>命中</th><th>资质</th><th>复核</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 50).map((item) => (
                <tr key={item.row.id}>
                  <td className="mono nowrap">{item.row.id}</td>
                  <td className="nowrap">{item.row.serviceDate}</td>
                  <td>{item.row.itemName}</td>
                  <td className="ellipsis">{item.row.institutionName}</td>
                  <td className="num">¥{formatCents(item.row.paymentAmountCents)}</td>
                  <td className="tiny mono">{item.hits.map((hit) => hit.ruleCode).join(' · ') || '—'}</td>
                  <td><Badge tone={item.qualification.status === 'ok' ? 'ok' : item.qualification.status === 'inactive' ? 'warn' : 'bad'}>{item.qualification.label}</Badge></td>
                  <td><Badge tone={item.reviewState === '已复核' ? 'ok' : item.reviewState === '待核' ? 'bad' : 'warn'}>{item.reviewState}</Badge></td>
                </tr>
              ))}
              {rows.length === 0 ? <tr><td colSpan={8}><div className="empty">范围内没有结算行</div></td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function scopeFingerprintHash(scope: ScopeFilter): string {
  return sha256Hex(scopeFingerprint(scope)).slice(0, 32);
}

function scopeLabel(scope: ScopeFilter): string {
  const parts: string[] = [];
  if (scope.itemCodes.length) parts.push(`项目 ${scope.itemCodes.join('/')}`);
  if (scope.areaCodes.length) parts.push(`统筹区 ${scope.areaCodes.join('/')}`);
  if (scope.institutionCodes.length) parts.push(`机构 ${scope.institutionCodes.join('/')}`);
  if (scope.ruleCodes.length) parts.push(`规则 ${scope.ruleCodes.join('/')}`);
  parts.push(`${scope.dateFrom} ~ ${scope.dateTo}`);
  if (scope.onlyPending) parts.push('仅待核');
  return parts.join('，');
}

