import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GitCompareArrows, Diff, ShieldAlert } from 'lucide-react';
import { useApp } from '../store/AppStore';
import { PageHeader, Stat, SectionCard } from '../components/Page';
import { Badge } from '../components/Badge';
import { formatCents, formatCount, diffCents } from '../lib/money';
import { diffMaterials } from '../core/material';

export function DiffPage() {
  const { materials, dataset, analysis } = useApp();
  const navigate = useNavigate();
  const [basisId, setBasisId] = useState<string>(materials[1]?.id ?? materials[0]?.id ?? '');
  const [nextId, setNextId] = useState<string>(materials[0]?.id ?? '');

  const basis = materials.find((material) => material.id === basisId) ?? null;
  const next = materials.find((material) => material.id === nextId) ?? null;
  const diff = useMemo(() => diffMaterials(basis, next), [basis, next]);
  const [onlyChanged, setOnlyChanged] = useState(true);

  const correctionBatches = dataset?.batches.filter((batch) => batch.status === '更正批次') ?? [];

  const changedFieldsSummary = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const row of diff.changedRows) {
      for (const field of row.changedFields) {
        counts[field] = (counts[field] ?? 0) + 1;
      }
    }
    return counts;
  }, [diff]);

  useEffect(() => {
    if (materials.length === 0) return;
    if (!materials.some((material) => material.id === nextId)) setNextId(materials[0].id);
    if (!materials.some((material) => material.id === basisId)) {
      setBasisId(materials[1]?.id ?? materials[0].id);
    }
  }, [materials, basisId, nextId]);

  if (materials.length < 1) {
    return (
      <div className="content">
        <PageHeader
          title="更正差异"
          lead="冻结材料并处理来源更正后，可在此比较版本差异与受影响明细。"
          actions={<button className="btn primary" onClick={() => navigate('/scope')}>去冻结范围</button>}
        />
        <div className="card"><div className="empty">尚无材料可供比较。</div></div>
      </div>
    );
  }

  return (
    <div className="content">
      <PageHeader
        kicker="Correction diff"
        title="更正差异"
        lead={
          <>
            展示来源批次或结论被更正后，受影响明细在新版材料中的变化。已封存材料保持原值，
            新版材料通过 basisPackageId 派生并列出受影响行；金额差额只反映行级变化。
          </>
        }
        actions={
          <button className="btn" onClick={() => navigate('/materials')}>
            回到材料库
          </button>
        }
      />

      <div className="grid cols-3">
        <Stat label="变更明细" value={formatCount(diff.changedRows.length)} accent="amber" hint={`新增 ${diff.addedRows} · 移除 ${diff.removedRows}`} />
        <Stat label="金额差额" value={`${diff.amountDeltaCents >= 0 ? '+' : ''}¥${formatCents(diff.amountDeltaCents)}`} accent="teal" small hint="按结算行口径" />
        <Stat label="未变明细" value={formatCount(diff.unchangedRows)} hint="依据与状态均未变化" />
      </div>

      <SectionCard
        title="选择比较版本"
        desc="默认选择最近两次封存，或选择更正版与它的基准材料。"
        actions={<Badge tone="info"><GitCompareArrows size={12} /> 封存快照只读</Badge>}
      >
        <div className="grid cols-2" style={{ gap: 14 }}>
          <div className="field">
            <label>基准材料（更正前）</label>
            <select value={basisId} onChange={(event) => setBasisId(event.target.value)}>
              <option value="">未选择</option>
              {materials.map((material) => (
                <option key={material.id} value={material.id}>
                  {material.id} · V{material.version} · ¥{formatCents(material.totals.paymentCents)}
                </option>
              ))}
            </select>
            {basis ? (
              <div className="help">
                {basis.title} · {formatCount(basis.rowCount)} 行 · {basis.createdAt}
              </div>
            ) : null}
          </div>
          <div className="field">
            <label>比较材料（更正后 / 较新版本）</label>
            <select value={nextId} onChange={(event) => setNextId(event.target.value)}>
              <option value="">未选择</option>
              {materials.map((material) => (
                <option key={material.id} value={material.id}>
                  {material.id} · V{material.version} · ¥{formatCents(material.totals.paymentCents)}
                </option>
              ))}
            </select>
            {next ? (
              <div className="help">
                {next.title} · {formatCount(next.rowCount)} 行 · {next.createdAt}
              </div>
            ) : null}
          </div>
        </div>
        {basis && next && basis.id === next.id ? (
          <div className="callout mt-12">请选择两份不同的材料进行比较。</div>
        ) : null}
        {basis?.correction || next?.correction ? (
          <div className="callout info mt-12" style={{ fontSize: 12 }}>
            <div>
              <b>更正依据：</b>
              {(next?.correction ?? basis?.correction)?.reason}
              <div className="tiny" style={{ marginTop: 3 }}>
                受影响行：{(next?.correction ?? basis?.correction)?.affectedRowIds.join('、')}
              </div>
            </div>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard
        title="差异明细"
        desc={`共 ${diff.changedRows.length} 行变化，按支付金额差额排序。`}
        actions={
          <button className={`btn sm ${onlyChanged ? 'primary' : ''}`} onClick={() => setOnlyChanged((v) => !v)}>
            {onlyChanged ? '仅看变更行' : '显示全部变更'}
          </button>
        }
        bodyStyle={{ padding: 0 }}
        noBody
      >
        <div className="table-wrap" style={{ maxHeight: 520 }}>
          <table className="data">
            <thead>
              <tr>
                <th>结算行</th><th>项目 / 服务日</th><th>变更项</th>
                <th className="num">更正前金额</th><th className="num">更正后金额</th><th className="num">差额</th>
                <th>资质依据</th><th>处理结论</th>
              </tr>
            </thead>
            <tbody>
              {diff.changedRows
                .filter((row) => !onlyChanged || row.changedFields.length > 0)
                .map((row) => (
                  <tr key={row.settlementId}>
                    <td className="mono nowrap">{row.settlementId}</td>
                    <td>
                      <div>{row.itemName}</div>
                      <div className="tiny muted">{row.serviceDate}</div>
                    </td>
                    <td>
                      <div className="pill-row">
                        {row.changedFields.map((field) => (
                          <Badge key={field} tone={field === '支付金额' ? 'bad' : 'warn'}>
                            {field}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="num">¥{formatCents(row.beforePaymentCents)}</td>
                    <td className="num">¥{formatCents(row.afterPaymentCents)}</td>
                    <td className="num" style={{ color: row.afterPaymentCents === row.beforePaymentCents ? undefined : 'var(--amber)' }}>
                      {diffCents(row.afterPaymentCents, row.beforePaymentCents)}
                    </td>
                    <td className="tiny">
                      <div>{row.beforeQualification}</div>
                      <div style={{ color: 'var(--teal)' }}>→ {row.afterQualification}</div>
                    </td>
                    <td className="tiny">
                      <div>{row.beforeConclusion ?? '无'}</div>
                      <div style={{ color: 'var(--teal)' }}>→ {row.afterConclusion ?? '无'}</div>
                    </td>
                  </tr>
                ))}
              {diff.changedRows.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <div className="empty">
                      <Diff size={26} className="icon" />
                      <div>两份材料在该范围内没有差异。</div>
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <div className="grid split mt-16">
        <SectionCard title="变更项统计" desc="按变更类型计数。">
          {Object.keys(changedFieldsSummary).length === 0 ? (
            <div className="small muted">暂无变更项。</div>
          ) : (
            <div className="stack tight">
              {Object.entries(changedFieldsSummary).map(([field, count]) => (
                <div key={field}>
                  <div className="row between" style={{ fontSize: 12.5 }}>
                    <span>{field}</span>
                    <span className="num muted">{count} 行</span>
                  </div>
                  <div className="bar-track" style={{ marginTop: 3 }}>
                    <div
                      className={`bar-fill ${field === '支付金额' ? 'red' : field === '处理结论' ? 'amber' : ''}`}
                      style={{ width: `${(count / Math.max(1, diff.changedRows.length)) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="更正批次记录" desc="来自批次目录的更正来源。">
          {correctionBatches.length === 0 ? (
            <div className="small muted">尚未应用更正批次。可在材料库点击「处理来源更正」生成。</div>
          ) : (
            <div className="stack tight">
              {correctionBatches.map((batch) => (
                <div className="evidence" key={batch.id}>
                  <div className="head">
                    <b className="mono">{batch.id}</b>
                    <Badge tone="warn">更正批次</Badge>
                  </div>
                  <p>{batch.note}</p>
                  <p className="sub">
                    {batch.fileName} · {batch.rowCount} 条 · {batch.importedAt.slice(0, 10)}
                  </p>
                </div>
              ))}
            </div>
          )}
          {analysis ? (
            <div className="callout mt-12" style={{ fontSize: 11.5 }}>
              <ShieldAlert size={14} style={{ flex: '0 0 auto', marginTop: 2 }} />
              <div>
                当前分析口径的结算行 {formatCount(analysis.totals.rowCount)} 条，支付金额 ¥{formatCents(analysis.totals.paymentCents)}；
                该口径服务于“新材料生成”，不会回写已封存材料。
              </div>
            </div>
          ) : null}
        </SectionCard>
      </div>
    </div>
  );
}
