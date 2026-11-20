import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  PackageCheck,
  Download,
  ExternalLink,
  ShieldCheck,
  FileJson2,
  ChevronRight,
  FileDown,
  GitBranch,
} from 'lucide-react';
import { useApp } from '../store/AppStore';
import { PageHeader, Stat, SectionCard } from '../components/Page';
import { Badge } from '../components/Badge';
import { Drawer } from '../components/Overlay';
import { formatCents, formatCount } from '../lib/money';
import { buildReviewBundle, downloadBlob } from '../core/export';
import { buildOfflineViewerHtml } from '../core/offlineViewer';
import { shortHash } from '../core/hash';
import type { MaterialPackage, MaterialRow } from '../types/domain';
import { diffMaterials } from '../core/material';
import { CorrectionModal } from '../components/CorrectionModal';

export function MaterialsPage() {
  const { materials, recordMaterial, toast } = useApp();
  const { materialId } = useParams();
  const navigate = useNavigate();
  const [selectedRow, setSelectedRow] = useState<MaterialRow | null>(null);
  const [showCorrection, setShowCorrection] = useState(false);

  const selected = useMemo(
    () => materials.find((material) => material.id === materialId) ?? materials[0] ?? null,
    [materials, materialId],
  );

  const nextId = useMemo(() => {
    if (!selected) return null;
    return materials.find((material) => material.basisPackageId === selected.id) ?? null;
  }, [materials, selected]);

  const diff = useMemo(() => {
    if (!selected || !nextId) return null;
    return diffMaterials(selected, nextId);
  }, [selected, nextId]);

  const totalSealed = materials.reduce((acc, material) => acc + material.rowCount, 0);

  if (materials.length === 0) {
    return (
      <div className="content">
        <PageHeader
          kicker="Evidence packages"
          title="证据材料"
          lead="冻结范围后会在此生成可复核的离线材料包。"
          actions={<button className="btn primary" onClick={() => navigate('/scope')}>去范围冻结</button>}
        />
        <div className="card">
          <div className="empty">
            <PackageCheck size={28} className="icon" />
            <div>还没有封存材料。请先在「范围冻结」选择范围并冻结。</div>
          </div>
        </div>
      </div>
    );
  }

  const exportZip = (material: MaterialPackage) => {
    const bundle = buildReviewBundle(material);
    downloadBlob(bundle.blob, bundle.fileName);
    void recordMaterial(material, {
      kind: '导出',
      title: `导出材料包 ${material.id}`,
      detail: `ZIP ${bundle.entries.length} 个文件，${(bundle.size / 1024).toFixed(1)} KB；包含 index.html 离线审阅器与校验信息。`,
      materialId: material.id,
    });
    toast(`已导出 ${bundle.fileName}`);
  };

  const exportViewerOnly = (material: MaterialPackage) => {
    const html = buildOfflineViewerHtml(material);
    downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `${material.id}-offline.html`);
    toast('已导出单文件离线审阅器');
  };

  const openViewer = (material: MaterialPackage) => {
    const html = buildOfflineViewerHtml(material);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  return (
    <div className="content">
      <PageHeader
        kicker="Evidence packages"
        title="证据材料"
        lead={
          <>
            每份材料都是“结算行主表 + 证据引用表”的封存快照，带来源批次清单、SHA-256 内容摘要与逐行金额核对结果。
            材料一旦封存不可修改；后续更正只会以 basisPackageId 派生新版本并列出受影响明细。
          </>
        }
        actions={
          <>
            <button className="btn" onClick={() => setShowCorrection(true)}>
              <GitBranch size={14} /> 处理来源更正
            </button>
            <button className="btn primary" onClick={() => navigate('/scope')}>新建冻结材料</button>
          </>
        }
      />

      <div className="grid cols-4">
        <Stat label="材料份数" value={materials.length} hint={`含 ${materials.filter((item) => item.correction).length} 份更正版本`} />
        <Stat label="封存行合计" value={formatCount(totalSealed)} hint="跨材料累计（含重复冻结）" />
        <Stat
          label="最近材料金额"
          value={`¥${formatCents(materials[0].totals.paymentCents)}`}
          small
          accent="teal"
          hint={`去重避免 ¥${formatCents(materials[0].totals.dedupeSavedCents)}`}
        />
        <Stat
          label="校验通过"
          value={`${materials.filter((item) => item.verification.passed).length} / ${materials.length}`}
          accent={materials.every((item) => item.verification.passed) ? 'teal' : 'red'}
          hint="含金额、引用、资质待核规则"
        />
      </div>

      <div className="grid split mt-16">
        <div className="stack">
          <SectionCard title="材料列表" desc="按封存时间倒序，点击查看明细。" bodyStyle={{ padding: 0 }} noBody>
            <div className="table-wrap" style={{ maxHeight: 420 }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>材料编号</th><th>版本</th><th className="num">行数</th><th className="num">支付金额</th><th>校验</th><th>依据</th>
                  </tr>
                </thead>
                <tbody>
                  {materials.map((material) => (
                    <tr
                      key={material.id}
                      className={`clickable ${selected?.id === material.id ? 'selected' : ''}`}
                      onClick={() => navigate(`/materials/${material.id}`)}
                    >
                      <td>
                        <div className="mono">{material.id}</div>
                        <div className="tiny muted">{material.title}</div>
                      </td>
                      <td>
                        V{material.version}
                        {material.correction ? <div className="tiny" style={{ color: 'var(--amber)' }}>更正版</div> : null}
                      </td>
                      <td className="num">{formatCount(material.rowCount)}</td>
                      <td className="num">¥{formatCents(material.totals.paymentCents)}</td>
                      <td>
                        <Badge tone={material.verification.passed ? 'ok' : 'bad'}>
                          {material.verification.passed ? '通过' : '未通过'}
                        </Badge>
                      </td>
                      <td className="tiny muted">{material.basisPackageId ?? '首版'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>

          {selected ? (
            <SectionCard
              title={
                <span className="row" style={{ gap: 8 }}>
                  <span className="mono">{selected.id}</span>
                  <Badge tone={selected.verification.passed ? 'ok' : 'bad'}>
                    {selected.verification.passed ? '校验通过' : '校验未通过'}
                  </Badge>
                  {selected.correction ? <Badge tone="warn">更正版本</Badge> : null}
                </span>
              }
              desc={`${selected.title} · 封存于 ${selected.createdAt} · ${selected.createdBy}`}
              actions={
                <>
                  <button className="btn sm" onClick={() => openViewer(selected)}><ExternalLink size={14} /> 离线预览</button>
                  <button className="btn sm" onClick={() => exportViewerOnly(selected)}><FileDown size={14} /> 单文件 HTML</button>
                  <button className="btn sm primary" onClick={() => exportZip(selected)}><Download size={14} /> 导出 ZIP</button>
                </>
              }
              bodyStyle={{ padding: 0 }}
              noBody
            >
              <div className="card-body" style={{ borderBottom: '1px solid var(--line-soft)' }}>
                <div className="grid cols-4" style={{ gap: 12 }}>
                  <MiniStat label="结算行" value={formatCount(selected.rowCount)} />
                  <MiniStat label="支付金额" value={`¥${formatCents(selected.totals.paymentCents)}`} />
                  <MiniStat label="命中 / 资质 / 结论" value={`${selected.evidence.hits.length} / ${selected.evidence.qualifications.length} / ${selected.evidence.conclusions.length}`} />
                  <MiniStat label="去重避免多计" value={`¥${formatCents(selected.totals.dedupeSavedCents)}`} />
                </div>
                {selected.correction ? (
                  <div className="callout mt-12" style={{ fontSize: 12 }}>
                    <div>
                      <b>更正版本：</b>{selected.correction.reason}
                      <div className="tiny" style={{ marginTop: 3 }}>
                        受影响行 {selected.correction.affectedRowIds.slice(0, 8).join('、')}
                        {selected.correction.affectedRowIds.length > 8 ? ` 等 ${selected.correction.affectedRowIds.length} 行` : ` 共 ${selected.correction.affectedRowIds.length} 行`}
                        ，来源批次 {selected.correction.batchIds.join('、')}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="table-wrap" style={{ maxHeight: 430 }}>
                <table className="data">
                  <thead>
                    <tr>
                      <th>结算行</th><th>服务日</th><th>项目</th><th className="num">支付金额</th>
                      <th>命中</th><th>资质</th><th>结论</th><th>复核</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.rows.slice(0, 200).map((row) => {
                      const affected = selected.correction?.affectedRowIds.includes(row.settlementId);
                      return (
                        <tr key={row.settlementId} className="clickable" onClick={() => setSelectedRow(row)}>
                          <td className="mono nowrap">
                            {row.settlementId}
                            {affected ? <span className="badge warn" style={{ marginLeft: 6 }}>更正影响</span> : null}
                          </td>
                          <td className="nowrap">{row.serviceDate}</td>
                          <td>{row.itemName}<div className="tiny muted">{row.institutionName}</div></td>
                          <td className="num">¥{formatCents(row.paymentAmountCents)}</td>
                          <td>
                            {row.hitCodes.length === 0 ? (
                              <span className="tiny muted">—</span>
                            ) : (
                              <div className="pill-row">
                                {row.hitCodes.map((code) => (
                                  <Badge key={code} tone="mute">{code}</Badge>
                                ))}
                              </div>
                            )}
                          </td>
                          <td>
                            <Badge tone={row.qualificationStatus === 'ok' ? 'ok' : row.qualificationStatus === 'inactive' ? 'warn' : 'bad'}>
                              {row.qualificationLabel}
                            </Badge>
                          </td>
                          <td><Badge tone={row.conclusionCode === '违规' ? 'bad' : row.conclusionCode === '整改' ? 'warn' : row.conclusionCode ? 'ok' : 'mute'}>{row.conclusionCode ?? '无'}</Badge></td>
                          <td><Badge tone={row.reviewState === '已复核' ? 'ok' : row.reviewState === '待核' ? 'bad' : 'warn'}>{row.reviewState}</Badge></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {selected.rows.length > 200 ? (
                <div className="tiny muted" style={{ padding: '8px 16px' }}>
                  仅显示前 200 行，完整 {formatCount(selected.rows.length)} 行请导出 ZIP 后在离线审阅器中查看。
                </div>
              ) : null}
            </SectionCard>
          ) : null}
        </div>

        <div className="stack">
          {selected ? (
            <>
              <SectionCard title="校验信息" desc="材料生成时执行，随包封存。">
                <div className="check-list">
                  {selected.verification.checks.map((check) => (
                    <div className="check-row" key={check.id}>
                      <span className={`check-icon ${check.passed ? 'pass' : 'fail'}`}>
                        <ShieldCheck size={12} />
                      </span>
                      <div>
                        <div className="label">{check.label}</div>
                        <div className="detail">{check.actual}</div>
                      </div>
                      <Badge tone={check.passed ? 'ok' : 'bad'}>{check.passed ? '通过' : '失败'}</Badge>
                    </div>
                  ))}
                </div>
                <div className="divider" />
                <div className="tiny muted">内容摘要（SHA-256）</div>
                <div className="hash" style={{ overflowWrap: 'anywhere' }}>{selected.verification.contentDigest}</div>
                <div className="tiny muted mt-8">汇总摘要</div>
                <div className="hash" style={{ overflowWrap: 'anywhere' }}>{selected.verification.totalsDigest}</div>
              </SectionCard>

              <SectionCard title="来源清单" desc="材料包含的批次与字段字典版本。">
                <div className="table-wrap">
                  <table className="data">
                    <thead><tr><th>内容</th><th>批次</th><th className="num">条数</th></tr></thead>
                    <tbody>
                      {selected.manifest.map((entry) => (
                        <tr key={entry.kind}>
                          <td>
                            <div>{entry.kind}</div>
                            <div className="tiny muted mono">{entry.fileName}</div>
                          </td>
                          <td className="tiny mono">
                            {entry.batchId}
                            <div className="muted">{entry.sourceVersion}</div>
                          </td>
                          <td className="num">{formatCount(entry.rowCount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </SectionCard>

              <SectionCard title="版本链" desc="材料之间的派生关系。">
                <div className="timeline">
                  <div className="timeline-item">
                    <div className="timeline-dot" />
                    <div className="timeline-body">
                      <div className="title">{selected.basisPackageId ? '基于前一版派生' : '首版材料'}</div>
                      <div className="meta">{selected.basisPackageId ?? '无上游版本'}</div>
                      <div className="detail">{selected.createdAt}</div>
                    </div>
                  </div>
                  {nextId ? (
                    <div className="timeline-item info">
                      <div className="timeline-dot" />
                      <div className="timeline-body">
                        <div className="title">后续版本 {nextId.id}</div>
                        <div className="meta">变更 {diff?.changedRows.length ?? 0} 行 · 金额差额 ¥{formatCents(diff?.amountDeltaCents ?? 0)}</div>
                        <button className="btn ghost sm" onClick={() => navigate('/diff')}>
                          查看差异 <ChevronRight size={13} />
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </SectionCard>

              <SectionCard title="导出内容" desc="ZIP 包结构（离线可用）。">
                <div className="stack tight" style={{ fontSize: 12 }}>
                  {['index.html（离线审阅器）', 'material.json（完整材料）', 'rows.json（结算行主表）', 'evidence/rule-hits.json', 'evidence/qualifications.json', 'evidence/conclusions.json', 'manifest.json（来源清单）', 'verification.json（校验信息）', 'sources.json（来源与基准版本）', 'dictionary.json（字段字典）', 'README.txt（复核说明）'].map((line) => (
                    <div className="row" key={line} style={{ gap: 7 }}>
                      <FileJson2 size={13} style={{ color: 'var(--teal)' }} />
                      <span className="mono tiny">{line}</span>
                    </div>
                  ))}
                </div>
                <button className="btn primary block mt-12" onClick={() => exportZip(selected)}>
                  <Download size={15} /> 导出 {selected.id}.zip
                </button>
              </SectionCard>
            </>
          ) : (
            <div className="card"><div className="empty">选择一份材料查看详情</div></div>
          )}
        </div>
      </div>

      <RowEvidenceDrawer
        material={selected}
        row={selectedRow}
        onClose={() => setSelectedRow(null)}
      />

      <CorrectionModal
        open={showCorrection}
        onClose={() => setShowCorrection(false)}
        basis={selected}
      />
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="tiny muted">{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

function RowEvidenceDrawer({
  material,
  row,
  onClose,
}: {
  material: MaterialPackage | null;
  row: MaterialRow | null;
  onClose: () => void;
}) {
  if (!material || !row) return null;
  const hits = material.evidence.hits.filter((hit) => row.hitIds.includes(hit.id));
  const quals = material.evidence.qualifications.filter((snapshot) => row.qualificationCandidateIds.includes(snapshot.id));
  const conclusion = material.evidence.conclusions.find((item) => item.id === row.conclusionId) ?? null;
  const hintSum = hits.reduce((acc, hit) => acc + hit.hintAmountCents, 0);

  return (
    <Drawer
      open
      onClose={onClose}
      width={600}
      title={<span className="mono">{row.settlementId}</span>}
      subtitle={`${material.id} · 材料内证据回查`}
    >
      <div className="card">
        <div className="card-body">
          <div className="tiny muted">支付金额（材料行主表，仅计一次）</div>
          <div style={{ fontSize: 28, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>¥{formatCents(row.paymentAmountCents)}</div>
          <div className="divider" />
          <dl className="kv">
            <dt>服务日</dt><dd>{row.serviceDate}</dd>
            <dt>项目</dt><dd>{row.itemName} <span className="mono muted">({row.itemCode})</span></dd>
            <dt>机构</dt><dd>{row.institutionName}</dd>
            <dt>统筹区</dt><dd>{row.areaName}</dd>
            <dt>行摘要</dt><dd className="hash">{row.inputDigest}</dd>
            <dt>引用</dt><dd className="tiny mono">{row.hitIds.length} 命中 · {row.qualificationCandidateIds.length} 资质 · {conclusion ? 1 : 0} 结论</dd>
          </dl>
        </div>
      </div>

      <div className="section-title">规则命中证据</div>
      {hits.length === 0 ? <div className="small muted">无命中。</div> : null}
      {hits.map((hit) => (
        <div className="evidence" key={hit.id}>
          <div className="head">
            <b>{hit.ruleCode} {hit.ruleName}</b>
            <Badge tone={hit.severity === '高' ? 'bad' : hit.severity === '中' ? 'warn' : 'mute'}>{hit.severity}</Badge>
            <span className="tiny muted mono" style={{ marginLeft: 'auto' }}>{hit.id}</span>
          </div>
          <p>{hit.clause}</p>
          <p className="sub">{hit.finding}</p>
          <p className="sub">单条提示金额 ¥{formatCents(hit.hintAmountCents)} · 仅解释</p>
        </div>
      ))}
      {hits.length > 1 ? (
        <div className="callout mt-8" style={{ fontSize: 12 }}>
          {hits.length} 条命中提示金额累加 ¥{formatCents(hintSum)}，不等于行支付金额；材料只按行计额一次。
        </div>
      ) : null}

      <div className="section-title">资质依据</div>
      {quals.length === 0 ? (
        <div className="callout danger"><div><b>资质空档</b><div>服务日无快照覆盖，材料列为待核。</div></div></div>
      ) : null}
      {quals.map((snapshot) => (
        <div className="evidence" key={snapshot.id}>
          <div className="head">
            <b className="mono">{snapshot.id}</b>
            <Badge tone={snapshot.state === '有效' ? 'ok' : 'bad'}>{snapshot.state}</Badge>
            {row.primaryQualificationId === snapshot.id ? <Badge tone="ok">本次采用</Badge> : null}
            {row.qualificationStatus === 'overlap' ? <Badge tone="bad">并行快照</Badge> : null}
          </div>
          <p className="tiny mono">{snapshot.certNo}</p>
          <p>有效期 {snapshot.validFrom} 至 {snapshot.validTo ?? '长期'}</p>
          <p className="sub">{snapshot.note}</p>
        </div>
      ))}

      <div className="section-title">处理结论</div>
      {conclusion ? (
        <div className="evidence">
          <div className="head"><b>{conclusion.code}</b><span className="tiny muted mono" style={{ marginLeft: 'auto' }}>{conclusion.id}</span></div>
          <p>{conclusion.label}</p>
          <p className="sub">追回 ¥{formatCents(conclusion.deductionCents)} · {conclusion.handler} · {conclusion.decidedAt}</p>
        </div>
      ) : (
        <div className="small muted">材料内无该行结论，复核状态为待结论。</div>
      )}

      <div className="callout info mt-16" style={{ fontSize: 11.5 }}>
        材料内容摘要 <span className="hash">{shortHash(material.verification.contentDigest, 20)}</span>；
        若要核对整包，请在离线审阅器内查看校验信息。
      </div>
    </Drawer>
  );
}
