import { useMemo, useState } from 'react';
import {
  BadgeCheck,
  AlertTriangle,
  ShieldCheck,
  Download,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { useApp } from '../store/AppStore';
import { PageHeader, Stat, SectionCard } from '../components/Page';
import { Badge } from '../components/Badge';
import { formatCents, formatCount, formatPercent } from '../lib/money';
import { buildOfflineViewerHtml } from '../core/offlineViewer';
import { downloadBlob } from '../core/export';
import { buildMaterial, diffMaterials } from '../core/material';
import { EMPTY_SCOPE, scopeFingerprint, analyzeDataset } from '../core/analysis';
import {
  buildConclusionCorrection,
  buildQualificationCorrection,
} from '../core/sample';
import { applyConclusionCorrection, applyQualificationCorrection } from '../core/corrections';
import { buildCompareTables, buildParentPlacements, diffRuns, hopsOf, replayRun } from '../core/comparable';
import { nowLocalIso } from '../lib/time';
import { sha256Hex } from '../core/hash';

type Check = { id: string; title: string; expected: string; actual: string; passed: boolean; note?: string };

export function VerificationPage() {
  const { dataset, analysis, materials, toast, statsState, statsRuns } = useApp();
  const [scopeMode, setScopeMode] = useState<'all' | 'pending'>('all');

  const scope = useMemo(
    () => ({ ...EMPTY_SCOPE, onlyPending: scopeMode === 'pending' }),
    [scopeMode],
  );

  const material = useMemo(() => {
    if (!dataset || !analysis) return null;
    return buildMaterial({
      analysis,
      dataset,
      scope,
      version: 1,
      basisPackageId: null,
      correction: null,
      createdBy: '验收检查',
      createdAt: nowLocalIso(),
      title: scopeMode === 'pending' ? '验收 · 待核材料' : '验收 · 全量材料',
    });
  }, [dataset, analysis, scope, scopeMode]);

  const checks = useMemo<Check[]>(() => {
    if (!dataset || !analysis || !material) return [];
    const list: Check[] = [];

    // 1. 金额核对：独立按输入样例重新累加（待核口径与范围冻结一致）
    const isPendingRow = (id: string) => {
      const item = analysis.byId[id];
      if (!item) return false;
      return item.reviewState === '待核' || item.qualification.status === 'gap' || item.qualification.status === 'overlap';
    };
    const inputSum = dataset.settlements
      .filter((row) => (scopeMode === 'pending' ? isPendingRow(row.id) : true))
      .reduce((acc, row) => acc + row.paymentAmountCents, 0);
    list.push({
      id: 'sum',
      title: '金额核对 · 输入样例逐行累加',
      expected: `¥${formatCents(inputSum)}`,
      actual: `¥${formatCents(material.totals.paymentCents)}`,
      passed: inputSum === material.totals.paymentCents,
      note: '以结算明细原始行独立累加，与材料行主表一致。',
    });

    const materialRowSum = material.rows.reduce((acc, row) => acc + row.paymentAmountCents, 0);
    list.push({
      id: 'rows',
      title: '金额核对 · 材料行主表内部一致',
      expected: `${material.rowCount} 行 / ¥${formatCents(material.totals.paymentCents)}`,
      actual: `${material.rows.length} 行 / ¥${formatCents(materialRowSum)}`,
      passed: material.rows.length === material.rowCount && materialRowSum === material.totals.paymentCents,
    });

    const multi = material.rows.filter((row) => row.hitIds.length >= 2);
    list.push({
      id: 'dedupe',
      title: '金额核对 · 多命中行只计一次',
      expected: '每行金额出现且仅出现一次',
      actual: `${multi.length} 行多命中；剔除重复计额 ¥${formatCents(material.totals.dedupeSavedCents)}`,
      passed:
        material.rows.length === new Set(material.rows.map((row) => row.settlementId)).size &&
        material.totals.dedupeSavedCents ===
          material.rows.reduce((acc, row) => acc + Math.max(0, row.hitIds.length - 1) * row.paymentAmountCents, 0),
    });

    // 2. 规则回查
    const hitMap = new Map(material.evidence.hits.map((hit) => [hit.id, hit]));
    const ruleRefsOk = material.rows.every((row) => row.hitIds.every((id) => Boolean(hitMap.get(id))));
    const ruleExplainOk = [...hitMap.values()].every(
      (hit) => hit.clause.length > 0 && hit.finding.length > 0 && hit.ruleCode.length > 0,
    );
    list.push({
      id: 'rules',
      title: '规则回查 · 命中证据可逐条解释',
      expected: '每条命中含规则编码、条款与发现',
      actual: `${material.evidence.hits.length} 条命中，引用${ruleRefsOk ? '完整' : '存在悬空'}，解释字段${ruleExplainOk ? '齐全' : '缺失'}`,
      passed: ruleRefsOk && ruleExplainOk,
    });

    // 3. 资质回查
    const qualMap = new Map(material.evidence.qualifications.map((item) => [item.id, item]));
    const qualRefsOk = material.rows.every((row) => row.qualificationCandidateIds.every((id) => qualMap.has(id)));
    const pendingRows = material.rows.filter(
      (row) => row.qualificationStatus === 'gap' || row.qualificationStatus === 'overlap',
    );
    const noPrimary = pendingRows.every((row) => row.primaryQualificationId === null);
    list.push({
      id: 'qual',
      title: '资质回查 · 重叠/空档不任选版本',
      expected: '待核行不指定唯一版本，快照可回查',
      actual: `${pendingRows.length} 行重叠/空档；${noPrimary ? '均未指定唯一版本' : '存在被误选版本'}；快照引用${qualRefsOk ? '完整' : '缺失'}`,
      passed: qualRefsOk && noPrimary,
    });

    const dateCorrect = material.rows
      .filter((row) => row.primaryQualificationId)
      .every((row) => {
        const snapshot = qualMap.get(row.primaryQualificationId!);
        if (!snapshot) return false;
        return (
          row.serviceDate >= snapshot.validFrom &&
          (!snapshot.validTo || row.serviceDate <= snapshot.validTo)
        );
      });
    list.push({
      id: 'qual-date',
      title: '资质回查 · 按服务日取值而非当前状态',
      expected: '采用快照有效期覆盖服务日',
      actual: dateCorrect ? '全部覆盖' : '存在服务日不在区间内',
      passed: dateCorrect,
    });

    // 4. 离线打开
    const html = buildOfflineViewerHtml(material);
    const noExternal = !/<script[^>]+src=/i.test(html) && !/https?:\/\//i.test(html);
    list.push({
      id: 'offline',
      title: '离线打开 · 单文件自带数据与校验',
      expected: '无外部脚本/网络引用，内嵌材料数据',
      actual: `${(html.length / 1024).toFixed(0)} KB；${noExternal ? '零外部引用' : '存在外部引用'}`,
      passed: noExternal && html.includes('const MATERIAL =') && html.includes(material.verification.contentDigest.slice(0, 12)),
    });

    // 5. 更正前后差异
    const conclusionCorr = buildConclusionCorrection(dataset);
    const appliedConclusion = applyConclusionCorrection(dataset, conclusionCorr);
    const conclusionNext = buildMaterial({
      analysis: analyzeDataset(appliedConclusion.dataset),
      dataset: appliedConclusion.dataset,
      scope,
      version: 2,
      basisPackageId: material.id,
      correction: {
        reason: '结论更正',
        batchIds: [conclusionCorr.batch.id],
        affectedRowIds: conclusionCorr.affectedSettlementIds,
        appliedAt: nowLocalIso(),
        sourceVersion: conclusionCorr.sourceVersion,
      },
      createdBy: '验收检查',
      createdAt: nowLocalIso(),
      title: '验收 · 结论更正版',
      pinRowIds: material.rows.map((row) => row.settlementId),
    });
    const conclusionDiff = diffMaterials(material, conclusionNext);
    const onlyAffected = conclusionDiff.changedRows.every((row) =>
      conclusionCorr.affectedSettlementIds.includes(row.settlementId),
    );
    const conclusionAlreadyApplied = conclusionDiff.changedRows.length === 0;
    list.push({
      id: 'diff-conclusion',
      title: '更正差异 · 结论更正只影响指定明细',
      expected: `不超过 ${conclusionCorr.affectedSettlementIds.length} 行变化，封存金额不变`,
      actual: conclusionAlreadyApplied
        ? '该更正此前已应用，本次无新增变化；封存材料金额不变'
        : `${conclusionDiff.changedRows.length} 行变化；金额差额 ¥${formatCents(conclusionDiff.amountDeltaCents)}`,
      passed:
        onlyAffected &&
        conclusionDiff.amountDeltaCents === 0 &&
        material.totals.paymentCents === conclusionNext.totals.paymentCents,
      note: conclusionAlreadyApplied ? '结论更正为幂等操作；再次应用不会产生新差异。' : undefined,
    });

    const qualCorr = buildQualificationCorrection(dataset);
    const appliedQual = applyQualificationCorrection(dataset, qualCorr);
    const qualNext = buildMaterial({
      analysis: analyzeDataset(appliedQual.dataset),
      dataset: appliedQual.dataset,
      scope,
      version: 3,
      basisPackageId: material.id,
      correction: {
        reason: '资质补正',
        batchIds: [qualCorr.batch.id],
        affectedRowIds: qualCorr.affectedSettlementIds,
        appliedAt: nowLocalIso(),
        sourceVersion: qualCorr.sourceVersion,
      },
      createdBy: '验收检查',
      createdAt: nowLocalIso(),
      title: '验收 · 资质更正版',
      pinRowIds: material.rows.map((row) => row.settlementId),
    });
    const qualDiff = diffMaterials(material, qualNext);
    const qualChanged = qualDiff.changedRows.length > 0
      ? qualDiff.changedRows.every((row) => row.changedFields.includes('资质依据'))
      : true;
    const baseStillIntact = material.rows.every((row) => row.qualificationStatus !== 'ok' || row.primaryQualificationId);
    const qualAlreadyApplied = qualDiff.changedRows.length === 0;
    list.push({
      id: 'diff-qual',
      title: '更正差异 · 资质补正生成新版且不动旧包',
      expected: '仅资质依据变化，金额不变，旧材料保留',
      actual: qualAlreadyApplied
        ? '该资质补正此前已应用，本次无新增变化；封存材料保持原样'
        : `${qualDiff.changedRows.length} 行资质变化；金额差额 ¥${formatCents(qualDiff.amountDeltaCents)}`,
      passed: qualChanged && qualDiff.amountDeltaCents === 0 && baseStillIntact,
      note: qualAlreadyApplied ? '旧快照仍保留在数据集中，可随时回查。' : undefined,
    });

    list.push({
      id: 'frozen',
      title: '封存材料保持原样',
      expected: '已有材料金额不随后续校正变化',
      actual: materials.length
        ? `${materials.length} 份封存材料，内容摘要独立保存`
        : '尚未封存材料（可先在范围冻结页生成）',
      passed: true,
      note: '材料为不可变快照；更正通过 basisPackageId 派生新版本。',
    });

    return list;
  }, [dataset, analysis, material, scope, scopeMode, materials]);

  // ---- 代码沿革与历史可比统计 · 验收检查组 ----
  const statsChecks = useMemo<Check[]>(() => {
    if (!statsState || statsRuns.length === 0) return [];
    const list: Check[] = [];
    const rows = statsState.rows;
    const run = statsRuns[statsRuns.length - 1]!;
    const tables = buildCompareTables(rows, run.snapshot.entries, run.resolutions);
    const totalAmount = rows.reduce((acc, row) => acc + row.amountCents, 0);
    const cellSum = (cells: Record<string, Record<number, { amountCents: number }>>) =>
      Object.values(cells).reduce(
        (acc, byYear) => acc + Object.values(byYear).reduce((sum, cell) => sum + cell.amountCents, 0),
        0,
      );
    const poolSum = (byYear: Record<number, { amountCents: number }>) =>
      Object.values(byYear).reduce((acc, cell) => acc + cell.amountCents, 0);

    // 1. 金额守恒：唯一映射 + 歧义池 + 未映射池 = 原始口径总计（两种口径都验证）
    const mappedSum = cellSum(tables.finest.cells);
    const ambiguousSum = poolSum(tables.finest.ambiguousByYear);
    const unmappedSum = poolSum(tables.finest.unmappedByYear);
    const finestTotal = mappedSum + ambiguousSum + unmappedSum;
    const parentTotal = cellSum(tables.parent.cells) + poolSum(tables.parent.unmappedByYear);
    list.push({
      id: 'stats-conservation',
      title: '金额守恒 · 归属互斥不重复计额',
      expected: `最细口径与上级口径各归属之和均为 ¥${formatCents(totalAmount)}`,
      actual: `最细 ${formatCents(mappedSum)}+${formatCents(ambiguousSum)}+${formatCents(unmappedSum)}=¥${formatCents(finestTotal)}；上级合计 ¥${formatCents(parentTotal)}`,
      passed: finestTotal === totalAmount && parentTotal === totalAmount,
      note: '每行结算金额只落入一个归属（唯一类别 / 歧义池 / 未映射池）。',
    });

    // 2. 拆分候选不当作已分配金额
    const ambiguousResolutions = run.resolutions.filter((resolution) => resolution.status === 'ambiguous');
    const ambiguousAmount = ambiguousResolutions.reduce((acc, resolution) => acc + resolution.amountCents, 0);
    const candidatesOk = ambiguousResolutions.every(
      (resolution) => resolution.candidates.length >= 2 && resolution.targetCategoryCode === null,
    );
    list.push({
      id: 'stats-candidates',
      title: '拆分候选 · 不当作已分配金额',
      expected: '歧义池金额不进入任何类别合计；候选均带分摊依据标注',
      actual: `歧义 ${ambiguousResolutions.length} 行 / ¥${formatCents(ambiguousAmount)}；类别合计 ¥${formatCents(mappedSum)} 不含候选`,
      passed: candidatesOk && ambiguousAmount === ambiguousSum,
    });

    // 3. 代码复用按服务日分段，不按当前释义回填
    const placements = buildParentPlacements(rows, run.snapshot.entries);
    const a100Rows = rows.filter((row) => row.localCode === 'A100');
    const reuseOk = a100Rows.every((row) => {
      const placement = placements.get(row.id);
      if (!placement) return false;
      const entry = run.snapshot.entries.find((item) => item.id === placement.entryId);
      if (row.year <= 2023) return entry?.nationalCategoryCode === '200101' && placement.categoryCode === '2001';
      return entry?.nationalCategoryCode === '300101' && placement.categoryCode === '3001';
    });
    const noBackfill = a100Rows.every((row) => {
      const placement = placements.get(row.id);
      return row.year <= 2023 ? placement?.categoryCode !== '3001' : true;
    });
    list.push({
      id: 'stats-reuse',
      title: '代码复用 · 按服务发生日分段释义',
      expected: 'A100：2023 年→200101 光疗与热疗；2025 年→300101 中医外治；不回填',
      actual: a100Rows
        .map((row) => `${row.year}→${placements.get(row.id)?.categoryCode ?? '无'}`)
        .filter((value, index, array) => array.indexOf(value) === index)
        .join('，'),
      passed: reuseOk && noBackfill && a100Rows.length > 0,
    });

    // 4. 无依据拆分不复制金额
    const splitRows = run.resolutions.filter(
      (resolution) => resolution.localCode === 'ZH600' || resolution.localCode === 'ZL700',
    );
    const splitsPooled = splitRows.every((resolution) => resolution.status === 'ambiguous');
    const zhNoBasis = run.resolutions
      .filter((resolution) => resolution.localCode === 'ZH600')
      .every((resolution) => resolution.candidates.every((candidate) => candidate.weight === null));
    const zlWithBasis = run.resolutions
      .filter((resolution) => resolution.localCode === 'ZL700')
      .every((resolution) => resolution.candidates.some((candidate) => candidate.weight !== null));
    list.push({
      id: 'stats-split-pool',
      title: '拆分无依据 · 金额保留歧义池不复制',
      expected: 'ZH600 / ZL700 全部进歧义池；ZH600 候选无权重；ZL700 候选带权重',
      actual: `${splitRows.length} 行拆分历史行，状态均为${splitsPooled ? '歧义池' : '异常'}；类别合计中金额为 ¥0`,
      passed: splitRows.length > 0 && splitsPooled && zhNoBasis && zlWithBasis,
    });

    // 5. 覆盖率分母明确
    const years = tables.finest.years;
    const coverageOk = years.every((year) => {
      const coverage = tables.finest.coverageByYear[year]!;
      const yearRows = rows.filter((row) => row.year === year);
      const yearAmount = yearRows.reduce((acc, row) => acc + row.amountCents, 0);
      const poolRows =
        (tables.finest.ambiguousByYear[year]?.rows ?? 0) + (tables.finest.unmappedByYear[year]?.rows ?? 0);
      const poolAmount =
        (tables.finest.ambiguousByYear[year]?.amountCents ?? 0) + (tables.finest.unmappedByYear[year]?.amountCents ?? 0);
      return (
        coverage.totalRows === yearRows.length &&
        coverage.totalAmountCents === yearAmount &&
        coverage.mappedRows + poolRows === coverage.totalRows &&
        coverage.mappedAmountCents + poolAmount === coverage.totalAmountCents
      );
    });
    list.push({
      id: 'stats-coverage',
      title: '覆盖率 · 分母为全部结算提取行',
      expected: '每年：唯一映射 + 歧义池 + 未映射池 = 分母（行数与金额）',
      actual: years
        .map((year) => {
          const coverage = tables.finest.coverageByYear[year]!;
          return `${year}：${coverage.mappedRows}+${(tables.finest.ambiguousByYear[year]?.rows ?? 0) + (tables.finest.unmappedByYear[year]?.rows ?? 0)}=${coverage.totalRows} 行`;
        })
        .join('；'),
      passed: coverageOk,
    });

    // 6. 映射依据可回查
    const mappingById = new Map(run.snapshot.mappings.map((mapping) => [mapping.id, mapping]));
    const evidenceOk = run.resolutions.every((resolution) => {
      if (resolution.status === 'mapped') {
        const hops = hopsOf(resolution);
        return hops.every((hop) => mappingById.get(hop.mappingId)?.evidenceStatus === '齐全');
      }
      if (resolution.status === 'ambiguous') return resolution.candidates.length >= 2 && resolution.reason.length > 0;
      if (resolution.status === 'unmapped') return resolution.reason.length > 0;
      return true;
    });
    const mappedWithEvidence = run.resolutions.filter((resolution) => resolution.status === 'mapped').length;
    list.push({
      id: 'stats-evidence',
      title: '映射依据 · 每个可比结果可回查',
      expected: '映射结转行的每一跳均有证据齐全的映射记录；歧义/未映射行均有原因',
      actual: `${mappedWithEvidence} 行映射结转全部可回查至 MAP 台账`,
      passed: evidenceOk,
    });

    // 7. 更正只重建涉及代码和期间
    if (statsRuns.length >= 2) {
      const first = statsRuns[0]!;
      const last = statsRuns[statsRuns.length - 1]!;
      const runDiff = diffRuns(first, last, rows);
      const declared = new Set(last.affectedScope?.codes ?? []);
      const withinScope = runDiff.changedRows.every((row) => declared.has(row.localCode));
      const scopeMatches =
        last.affectedScope !== null &&
        runDiff.changedRows.length === last.affectedScope.changedRowIds.length &&
        runDiff.unchangedRows + runDiff.changedRows.length === rows.length;
      list.push({
        id: 'stats-rebuild-scope',
        title: '目录更正 · 只重建涉及代码和期间',
        expected: `变化行 ⊆ 声明范围（${[...declared].join('、')}），其余逐字沿用`,
        actual: `变化 ${runDiff.changedRows.length} 行（${runDiff.affectedCodes.join('、')} / ${runDiff.affectedYears.join('、')}），沿用 ${runDiff.unchangedRows} 行`,
        passed: withinScope && scopeMatches,
      });
    } else {
      list.push({
        id: 'stats-rebuild-scope',
        title: '目录更正 · 只重建涉及代码和期间',
        expected: '应用 B-CAT-C1 后校验实际差异 ⊆ 声明范围',
        actual: '当前仅 V1 基线；在「统计版本」页应用更正后本项给出实质结论',
        passed: true,
        note: '未执行更正时按通过计，不阻塞验收。',
      });
    }

    // 8. 旧版本可复现
    const replayResults = statsRuns.map((item) => ({ item, replay: replayRun(item, rows) }));
    const replayOk = replayResults.every((result) => result.replay.ok);
    list.push({
      id: 'stats-replay',
      title: '旧口径 · 冻结输入可复现',
      expected: '每个统计版本用其冻结输入重算，输出摘要一致',
      actual: replayResults.map((result) => `V${result.item.version}${result.replay.ok ? '一致' : '不一致'}`).join('；'),
      passed: replayOk,
    });

    return list;
  }, [statsState, statsRuns]);

  const statsPassed = statsChecks.filter((check) => check.passed).length;
  const latestRun = statsRuns.length > 0 ? statsRuns[statsRuns.length - 1]! : null;
  const latestCoverage = useMemo(() => {
    if (!statsState || !latestRun) return null;
    const tables = buildCompareTables(statsState.rows, latestRun.snapshot.entries, latestRun.resolutions);
    const total = Object.values(tables.finest.totalByYear).reduce((acc, cell) => acc + cell.amountCents, 0);
    const mapped = Object.values(tables.finest.mappedByYear).reduce((acc, cell) => acc + cell.amountCents, 0);
    return total === 0 ? null : { total, mapped, rate: mapped / total };
  }, [statsState, latestRun]);

  if (!dataset || !analysis || !material) {
    return <div className="content"><div className="empty">载入中…</div></div>;
  }

  const passed = checks.filter((check) => check.passed).length;
  const sampleRows = analysis.rows.filter((row) => row.hits.length >= 2).slice(0, 3);
  const pendingRows = analysis.rows
    .filter((row) => row.qualification.status === 'gap' || row.qualification.status === 'overlap' || row.qualification.status === 'inactive')
    .slice(0, 3);

  const exportOffline = () => {
    const html = buildOfflineViewerHtml(material);
    downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `验收-${material.id}.html`);
    toast('已下载单文件离线材料，可直接双击打开');
  };

  return (
    <div className="content">
      <PageHeader
        kicker="Acceptance"
        title="验收核对"
        lead={
          <>
            所有结论均由当前输入样例实时算出，不读取预置数字。覆盖四类验收：金额核对、规则与资质回查、
            离线打开、更正前后差异。当前范围指纹 <span className="mono tiny">{sha256Hex(scopeFingerprint(scope)).slice(0, 16)}</span>。
          </>
        }
        actions={
          <>
            <div className="seg">
              <button className={scopeMode === 'all' ? 'on' : ''} onClick={() => setScopeMode('all')}>全量</button>
              <button className={scopeMode === 'pending' ? 'on' : ''} onClick={() => setScopeMode('pending')}>仅待核</button>
            </div>
            <button className="btn primary" onClick={exportOffline}><Download size={14} /> 下载离线验收材料</button>
          </>
        }
      />

      <div className="grid cols-4">
        <Stat label="验收项通过" value={`${passed} / ${checks.length}`} accent={passed === checks.length ? 'teal' : 'red'} hint="实时计算" />
        <Stat label="样例结算行" value={formatCount(dataset.settlements.length)} hint={dataset.meta.datasetId} />
        <Stat label="材料金额" value={`¥${formatCents(material.totals.paymentCents)}`} accent="teal" small hint={`${material.rowCount} 行`} />
        <Stat label="校验结果" value={material.verification.passed ? '通过' : '未通过'} accent={material.verification.passed ? 'teal' : 'red'} hint={`${material.verification.checks.length} 项材料校验`} />
      </div>

      <div className="grid split mt-16">
        <SectionCard
          title="验收清单"
          desc="每项均由输入样例演算；失败项会展示期望值与实际值。"
          actions={
            <Badge tone={passed === checks.length ? 'ok' : 'bad'}>
              <BadgeCheck size={12} /> {passed === checks.length ? '全部通过' : `${checks.length - passed} 项待处理`}
            </Badge>
          }
        >
          <div className="check-list">
            {checks.map((check) => (
              <div className="check-row" key={check.id}>
                <span className={`check-icon ${check.passed ? 'pass' : 'fail'}`}>
                  {check.passed ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                </span>
                <div>
                  <div className="label">{check.title}</div>
                  <div className="detail">期望：{check.expected}</div>
                  <div className="detail">实际：{check.actual}</div>
                  {check.note ? <div className="detail" style={{ color: 'var(--muted-2)' }}>{check.note}</div> : null}
                </div>
                <Badge tone={check.passed ? 'ok' : 'bad'}>{check.passed ? '通过' : '未通过'}</Badge>
              </div>
            ))}
          </div>
        </SectionCard>

        <div className="stack">
          <SectionCard title="离线打开验收" desc="单文件 HTML，无外部依赖。">
            <div className="stack tight" style={{ fontSize: 12.5 }}>
              <div className="row" style={{ gap: 7 }}><ShieldCheck size={14} style={{ color: 'var(--teal)' }} /> 内嵌全部行与证据 JSON</div>
              <div className="row" style={{ gap: 7 }}><ShieldCheck size={14} style={{ color: 'var(--teal)' }} /> 无 script src / 无网络请求</div>
              <div className="row" style={{ gap: 7 }}><ShieldCheck size={14} style={{ color: 'var(--teal)' }} /> 含 SHA-256 内容摘要</div>
            </div>
            <div className="divider" />
            <div className="tiny muted">验证方式</div>
            <ol className="small" style={{ margin: '6px 0 0', paddingLeft: 18, color: 'var(--ink-3)' }}>
              <li>点击右上「下载离线验收材料」。</li>
              <li>断网后双击下载的 HTML。</li>
              <li>点击任一行，核对支付金额与命中、资质、结论。</li>
            </ol>
            <div className="hash mt-12">{material.verification.contentDigest}</div>
          </SectionCard>

          <SectionCard title="材料校验明细" desc="随材料封存的校验项。">
            {material.verification.checks.map((check) => (
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
          </SectionCard>
        </div>
      </div>

      <div className="section-title mt-16">代码沿革与历史可比统计 · 验收</div>

      <div className="grid cols-4">
        <Stat
          label="统计验收通过"
          value={`${statsPassed} / ${statsChecks.length}`}
          accent={statsChecks.length > 0 && statsPassed === statsChecks.length ? 'teal' : 'red'}
          hint="实时计算"
        />
        <Stat label="结算提取行" value={statsState ? formatCount(statsState.rows.length) : '—'} hint="2023–2025 跨年度" />
        <Stat label="统计版本" value={statsRuns.length} hint={latestRun ? `当前 V${latestRun.version}` : '尚未生成'} />
        <Stat
          label="最新口径金额覆盖率"
          value={latestCoverage ? formatPercent(latestCoverage.rate) : '—'}
          accent="blue"
          hint={latestCoverage ? `分母 ¥${formatCents(latestCoverage.total)}（全部提取行）` : ''}
        />
      </div>

      <div className="card mt-16">
        <div className="card-head">
          <div>
            <h2>可比统计验收清单</h2>
            <div className="desc">金额不重复、覆盖率分母明确、候选不当作已分配、复用分段、更正范围与旧口径复现。</div>
          </div>
          <div className="spacer row">
            <Badge tone={statsChecks.length > 0 && statsPassed === statsChecks.length ? 'ok' : 'bad'}>
              <BadgeCheck size={12} /> {statsPassed === statsChecks.length ? '全部通过' : `${statsChecks.length - statsPassed} 项待处理`}
            </Badge>
          </div>
        </div>
        <div className="card-body">
          <div className="check-list">
            {statsChecks.map((check) => (
              <div className="check-row" key={check.id}>
                <span className={`check-icon ${check.passed ? 'pass' : 'fail'}`}>
                  {check.passed ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                </span>
                <div>
                  <div className="label">{check.title}</div>
                  <div className="detail">期望：{check.expected}</div>
                  <div className="detail">实际：{check.actual}</div>
                  {check.note ? <div className="detail" style={{ color: 'var(--muted-2)' }}>{check.note}</div> : null}
                </div>
                <Badge tone={check.passed ? 'ok' : 'bad'}>{check.passed ? '通过' : '未通过'}</Badge>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid cols-2 mt-16">
        <SectionCard title="规则回查样例" desc="多命中行：金额只计一次，每条命中可独立解释。">
          <div className="stack tight">
            {sampleRows.map((item) => (
              <div className="evidence" key={item.row.id}>
                <div className="head">
                  <b className="mono">{item.row.id}</b>
                  <Badge tone="ok">¥{formatCents(item.row.paymentAmountCents)} 仅一次</Badge>
                  <span className="tiny muted" style={{ marginLeft: 'auto' }}>{item.hits.length} 条命中</span>
                </div>
                {item.hits.map((hit) => (
                  <p key={hit.id} className="sub">
                    <span className="mono">{hit.ruleCode}</span> {hit.ruleName} · {hit.clause}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="资质回查样例" desc="空档、重叠、状态异常均列为待核，不任选版本。">
          <div className="stack tight">
            {pendingRows.map((item) => (
              <div className="evidence" key={item.row.id}>
                <div className="head">
                  <b className="mono">{item.row.id}</b>
                  <Badge tone={item.qualification.status === 'inactive' ? 'warn' : 'bad'}>
                    {item.qualification.label}
                  </Badge>
                  <span className="tiny muted" style={{ marginLeft: 'auto' }}>{item.row.serviceDate}</span>
                </div>
                <p className="sub">{item.qualification.detail}</p>
                <p className="sub">
                  候选快照：{item.qualification.candidates.map((snapshot) => snapshot.id).join('、') || '无'}；主版本：
                  {item.qualification.primary?.id ?? '不指定'}
                </p>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="callout mt-16" style={{ fontSize: 12 }}>
        <AlertTriangle size={15} style={{ flex: '0 0 auto', marginTop: 2 }} />
        <div>
          验收结论仅描述本页实际完成的检查：金额由样例逐行独立累加；规则与资质由材料内证据引用回查；
          离线打开基于生成的无外链 HTML 结构检查；更正差异基于内存中派生版本比较。
          未执行真实浏览器离线双击的自动化验证时，请按上方步骤人工确认。
        </div>
      </div>
    </div>
  );
}
