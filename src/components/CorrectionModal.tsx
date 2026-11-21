import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, GitBranch } from 'lucide-react';
import { Modal } from './Overlay';
import { Badge } from './Badge';
import { useApp } from '../store/AppStore';
import { buildConclusionCorrection, buildQualificationCorrection } from '../core/sample';
import { applyConclusionCorrection, applyQualificationCorrection } from '../core/corrections';
import { analyzeDataset } from '../core/analysis';
import { buildMaterial, diffMaterials } from '../core/material';
import { formatCents, formatCount } from '../lib/money';
import type { MaterialPackage } from '../types/domain';
import { nowLocalIso } from '../lib/time';

type Scenario = 'conclusion' | 'qualification';

export function CorrectionModal({
  open,
  onClose,
  basis,
}: {
  open: boolean;
  onClose: () => void;
  basis: MaterialPackage | null;
}) {
  const { dataset, materials, applyCorrection, recordMaterial, toast } = useApp();
  const [scenario, setScenario] = useState<Scenario>('conclusion');
  const [working, setWorking] = useState(false);

  const preview = useMemo(() => {
    if (!dataset) return null;
    if (scenario === 'conclusion') {
      const correction = buildConclusionCorrection(dataset);
      const applied = applyConclusionCorrection(dataset, correction);
      return {
        nextDataset: applied.dataset,
        affected: correction.affectedSettlementIds,
        batch: correction.batch,
        sourceVersion: correction.sourceVersion,
        title: '处理结论更正',
        reason: '省局复核补充病历与说明后，调整 3 条处理结论；原结论保留在历史批次。',
        batchIds: [correction.batch.id],
      };
    }
    const correction = buildQualificationCorrection(dataset);
    const applied = applyQualificationCorrection(dataset, correction);
    return {
      nextDataset: applied.dataset,
      affected: correction.affectedSettlementIds,
      batch: correction.batch,
      sourceVersion: correction.sourceVersion,
      title: '资质快照补正',
      reason: '机构补交备案材料：撤销 H007 重复备案，补录 H005 在 2025-03 的资质；旧快照保留并标记被取代。',
      batchIds: [correction.batch.id],
    };
  }, [dataset, scenario]);

  const baseMaterial = basis ?? materials[0] ?? null;

  const nextMaterial = useMemo(() => {
    if (!preview || !baseMaterial || !dataset) return null;
    const nextAnalysis = analyzeDataset(preview.nextDataset);
    return buildMaterial({
      analysis: nextAnalysis,
      dataset: preview.nextDataset,
      scope: baseMaterial.scope,
      version: baseMaterial.version + 1,
      basisPackageId: baseMaterial.id,
      correction: {
        reason: preview.reason,
        batchIds: preview.batchIds,
        affectedRowIds: preview.affected,
        appliedAt: nowLocalIso(),
        sourceVersion: preview.sourceVersion,
      },
      createdBy: '稽核一组 · 王敏',
      createdAt: nowLocalIso(),
      title: `${baseMaterial.title}（更正版 V${baseMaterial.version + 1}）`,
      pinRowIds: baseMaterial.rows.map((row) => row.settlementId),
    });
  }, [preview, baseMaterial, dataset]);

  const comparison = useMemo(() => {
    if (!baseMaterial || !nextMaterial) return null;
    return diffMaterials(baseMaterial, nextMaterial);
  }, [baseMaterial, nextMaterial]);

  const apply = async () => {
    if (!preview || !nextMaterial || !baseMaterial) return;
    setWorking(true);
    try {
      await applyCorrection(preview.nextDataset, {
        kind: '更正',
        title: `${preview.title} · ${preview.batch.id}`,
        detail: `影响 ${preview.affected.length} 行：${preview.affected.join('、')}；已封存材料 ${baseMaterial.id} 保持不变，派生新材料 ${nextMaterial.id}。`,
        materialId: nextMaterial.id,
      });
      await recordMaterial(nextMaterial, {
        kind: '冻结',
        title: `生成更正材料 ${nextMaterial.id}`,
        detail: `基于 ${baseMaterial.id}，受影响 ${nextMaterial.correction?.affectedRowIds.length ?? 0} 行；原因：${preview.reason}`,
        materialId: nextMaterial.id,
      });
      toast(`已生成更正材料 ${nextMaterial.id}，原材料 ${baseMaterial.id} 保持不变`);
      onClose();
    } catch (error) {
      toast(`更正失败：${error instanceof Error ? error.message : String(error)}`, 'warn');
    } finally {
      setWorking(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span className="row" style={{ gap: 8 }}>
          <GitBranch size={17} /> 处理来源更正
        </span>
      }
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={working}>取消</button>
          <button className="btn primary" onClick={apply} disabled={working || !nextMaterial}>
            {working ? '生成中…' : '生成更正后新材料'}
          </button>
        </>
      }
    >
      {!baseMaterial ? (
        <div className="callout">尚未封存材料，请先在「范围冻结」生成基准材料，再处理更正。</div>
      ) : (
        <>
          <div className="seg" style={{ marginBottom: 14 }}>
            <button className={scenario === 'conclusion' ? 'on' : ''} onClick={() => setScenario('conclusion')}>
              处理结论更正
            </button>
            <button className={scenario === 'qualification' ? 'on' : ''} onClick={() => setScenario('qualification')}>
              资质快照补正
            </button>
          </div>

          <div className="callout info" style={{ fontSize: 12.5 }}>
            <div>
              <b>基准材料：</b>{baseMaterial.id}（V{baseMaterial.version}，封存于 {baseMaterial.createdAt}）
              <div className="tiny" style={{ marginTop: 3 }}>
                更正只会派生新材料，已封存包保持不变；新材料会标注受影响明细。
              </div>
            </div>
          </div>

          {preview ? (
            <>
              <div className="section-title mt-16">更正内容</div>
              <div className="stack tight" style={{ fontSize: 12.5 }}>
                <div className="row between">
                  <span className="muted">场景</span>
                  <span>{preview.title}</span>
                </div>
                <div className="row between">
                  <span className="muted">更正批次</span>
                  <span className="mono tiny">{preview.batch.id} / {preview.sourceVersion}</span>
                </div>
                <div className="row between">
                  <span className="muted">受影响结算行</span>
                  <span>{preview.affected.length} 行</span>
                </div>
              </div>
              <p className="small muted mt-8">{preview.reason}</p>

              <div className="section-title mt-16">受影响明细</div>
              <div className="table-wrap" style={{ maxHeight: 190 }}>
                <table className="data">
                  <thead><tr><th>结算行</th><th>机构 / 项目</th><th className="num">支付金额</th><th>更正前</th><th>更正后</th></tr></thead>
                  <tbody>
                    {preview.affected.map((id) => {
                      const before = baseMaterial.rows.find((row) => row.settlementId === id);
                      const after = nextMaterial?.rows.find((row) => row.settlementId === id);
                      return (
                        <tr key={id}>
                          <td className="mono nowrap">{id}</td>
                          <td className="tiny">
                            {before?.institutionName ?? after?.institutionName}
                            <div className="muted">{before?.itemName ?? after?.itemName}</div>
                          </td>
                          <td className="num">¥{formatCents(after?.paymentAmountCents ?? before?.paymentAmountCents ?? 0)}</td>
                          <td className="tiny">
                            <div>资质：{before?.qualificationLabel ?? '—'}</div>
                            <div>结论：{before?.conclusionCode ?? '无'}</div>
                          </td>
                          <td className="tiny">
                            <div>资质：{after?.qualificationLabel ?? '—'}</div>
                            <div>结论：{after?.conclusionCode ?? '无'}</div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {comparison ? (
                <>
                  <div className="section-title mt-16">新材料差异预览</div>
                  <div className="grid cols-3" style={{ gap: 10 }}>
                    <div>
                      <div className="tiny muted">变化行</div>
                      <div style={{ fontSize: 18, fontWeight: 600 }}>{comparison.changedRows.length}</div>
                    </div>
                    <div>
                      <div className="tiny muted">不变行</div>
                      <div style={{ fontSize: 18, fontWeight: 600 }}>{formatCount(comparison.unchangedRows)}</div>
                    </div>
                    <div>
                      <div className="tiny muted">金额差额</div>
                      <div style={{ fontSize: 18, fontWeight: 600 }}>{formatCents(comparison.amountDeltaCents)}</div>
                    </div>
                  </div>
                  <div className="callout mt-12" style={{ fontSize: 11.5 }}>
                    <ArrowRight size={14} style={{ flex: '0 0 auto', marginTop: 2 }} />
                    <div>
                      新材料 <span className="mono">{nextMaterial?.id}</span>，基于 {baseMaterial.id}，共 {formatCount(nextMaterial?.rowCount ?? 0)} 行，
                      支付金额 ¥{formatCents(nextMaterial?.totals.paymentCents ?? 0)}。
                      封存材料 {baseMaterial.id} 的金额 ¥{formatCents(baseMaterial.totals.paymentCents)} 不会改变。
                    </div>
                  </div>
                </>
              ) : null}
            </>
          ) : (
            <div className="callout"><AlertTriangle size={15} /> 预览生成失败，请检查数据是否已载入。</div>
          )}
        </>
      )}
    </Modal>
  );
}
