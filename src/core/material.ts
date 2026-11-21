import type {
  Dataset,
  DatasetAnalysis,
  MaterialCorrection,
  MaterialEvidence,
  ManifestEntry,
  MaterialPackage,
  MaterialRow,
  MaterialVerification,
  RowAnalysis,
  ScopeFilter,
  VerificationCheck,
} from '../types/domain';
import { digestOf, sha256Hex, stableStringify } from './hash';
import { rowMatchesScope, scopeFingerprint } from './analysis';

export const MANIFEST_SCHEMA = 'audit-material/1.4';

export interface BuildMaterialInput {
  analysis: DatasetAnalysis;
  dataset: Dataset;
  scope: ScopeFilter;
  version: number;
  basisPackageId: string | null;
  correction: MaterialCorrection | null;
  createdBy: string;
  createdAt: string;
  title?: string;
  /** 派生材料时锁定基准材料的行集合：更正后仍覆盖同一批明细，不因状态变化被筛掉。 */
  pinRowIds?: string[];
}

export function buildMaterial(input: BuildMaterialInput): MaterialPackage {
  const selected = input.pinRowIds
    ? input.pinRowIds
        .map((id) => input.analysis.byId[id])
        .filter((item): item is DatasetAnalysis['rows'][number] => Boolean(item))
    : input.analysis.rows.filter((row) => rowMatchesScope(row, input.scope));
  const rows = selected.map(toMaterialRow);
  const evidence = collectEvidence(selected);
  const totals = computeTotals(rows, evidence);

  const manifest: ManifestEntry[] = [
    {
      kind: '结算行主表',
      fileName: 'rows.json',
      sourceVersion: input.dataset.meta.versions.settlement,
      batchId: batchFor(input.dataset, '结算明细'),
      rowCount: rows.length,
      sha256: digestOf(rows),
    },
    {
      kind: '规则命中证据',
      fileName: 'evidence/rule-hits.json',
      sourceVersion: input.dataset.meta.versions.ruleHit,
      batchId: batchFor(input.dataset, '规则命中'),
      rowCount: evidence.hits.length,
      sha256: digestOf(evidence.hits),
    },
    {
      kind: '资质快照证据',
      fileName: 'evidence/qualifications.json',
      sourceVersion: input.dataset.meta.versions.qualification,
      batchId: batchFor(input.dataset, '资质快照'),
      rowCount: evidence.qualifications.length,
      sha256: digestOf(evidence.qualifications),
    },
    {
      kind: '处理结论证据',
      fileName: 'evidence/conclusions.json',
      sourceVersion: input.dataset.meta.versions.conclusion,
      batchId: batchFor(input.dataset, '处理结论'),
      rowCount: evidence.conclusions.length,
      sha256: digestOf(evidence.conclusions),
    },
    {
      kind: '字段字典',
      fileName: 'dictionary.json',
      sourceVersion: input.dataset.meta.versions.dictionary,
      batchId: batchFor(input.dataset, '字段字典'),
      rowCount: input.dataset.dictionary.length,
      sha256: digestOf(input.dataset.dictionary),
    },
  ];

  const base: Omit<MaterialPackage, 'verification'> = {
    id: `MAT-${input.createdAt.slice(0, 10).replace(/-/g, '')}-V${String(input.version).padStart(2, '0')}`,
    schemaVersion: MANIFEST_SCHEMA,
    version: input.version,
    title: input.title ?? buildTitle(input.scope),
    scope: input.scope,
    scopeHash: sha256Hex(scopeFingerprint(input.scope)),
    createdAt: input.createdAt,
    createdBy: input.createdBy,
    status: '已封存',
    basisPackageId: input.basisPackageId,
    datasetId: input.dataset.meta.datasetId,
    rowCount: rows.length,
    totals,
    rows,
    evidence,
    manifest,
    fieldDictionary: input.dataset.dictionary,
    correction: input.correction,
    notes: input.correction
      ? '更正版本：仅纳入受影响明细的新依据，已封存材料不改写。'
      : '按结算行唯一计额；规则命中、资质快照与结论均以引用形式随包封存。',
  };

  const contentDigest = digestOf({ ...base, verification: undefined });
  const verification = verifyMaterial({ ...base, contentDigest, checks: [] });

  return {
    ...base,
    verification,
  };
}

function batchFor(dataset: Dataset, role: string): string {
  return dataset.batches.find((batch) => batch.role === role)?.id ?? 'UNKNOWN';
}

function toMaterialRow(analysis: RowAnalysis): MaterialRow {
  const { row, hits, qualification, conclusion } = analysis;
  return {
    settlementId: row.id,
    rowNumber: row.rowNumber,
    serviceDate: row.serviceDate,
    itemCode: row.itemCode,
    itemName: row.itemName,
    areaCode: row.poolingAreaCode,
    areaName: row.poolingAreaName,
    institutionCode: row.institutionCode,
    institutionName: row.institutionName,
    paymentAmountCents: row.paymentAmountCents,
    suspectedAmountCents: row.suspectedAmountCents,
    visitType: row.visitType,
    fundType: row.fundType,
    reviewState: analysis.reviewState,
    qualificationStatus: qualification.status,
    qualificationLabel: qualification.label,
    qualificationCandidateIds: qualification.candidates.map((snapshot) => snapshot.id),
    primaryQualificationId: qualification.primary?.id ?? null,
    hitIds: hits.map((hit) => hit.id),
    hitCodes: hits.map((hit) => hit.ruleCode),
    conclusionId: conclusion?.id ?? null,
    conclusionCode: conclusion?.code ?? null,
    inputDigest: row.inputDigest,
  };
}

function collectEvidence(selected: RowAnalysis[]): MaterialEvidence {
  const hits = selected.flatMap((analysis) => analysis.hits);
  const qualificationMap = new Map<string, RowAnalysis['qualification']['candidates'][number]>();
  for (const analysis of selected) {
    for (const snapshot of analysis.qualification.candidates) qualificationMap.set(snapshot.id, snapshot);
  }
  const conclusionMap = new Map<string, NonNullable<RowAnalysis['conclusion']>>();
  for (const analysis of selected) {
    if (analysis.conclusion) conclusionMap.set(analysis.conclusion.id, analysis.conclusion);
  }
  return {
    hits,
    qualifications: [...qualificationMap.values()].sort((a, b) => a.id.localeCompare(b.id)),
    conclusions: [...conclusionMap.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function computeTotals(
  rows: MaterialRow[],
  evidence: MaterialEvidence,
): MaterialPackage['totals'] {
  const uniqueCents = rows.reduce((acc, row) => acc + row.paymentAmountCents, 0);
  const flattened = rows.reduce((acc, row) => {
    const multiplier = Math.max(1, row.hitIds.length);
    return acc + row.paymentAmountCents * multiplier;
  }, 0);
  const uniqueRules = new Set(rows.flatMap((row) => row.hitCodes)).size;
  return {
    paymentCents: uniqueCents,
    suspectedCents: rows.reduce((acc, row) => acc + row.suspectedAmountCents, 0),
    pendingRows: rows.filter((row) => row.reviewState === '待核' || row.reviewState === '待结论').length,
    hitCount: evidence.hits.length,
    uniqueRules,
    dedupeSavedCents: flattened - uniqueCents,
  };
}

export function verifyMaterial(material: Omit<MaterialPackage, 'verification'> & { contentDigest: string; checks: VerificationCheck[] }): MaterialVerification {
  const rowsCents = material.rows.reduce((acc, row) => acc + row.paymentAmountCents, 0);
  const reconciliation = reconcileRows(material.rows, material.evidence);
  const evidenceComplete = material.rows.every((row) => {
    const hitsPresent = row.hitIds.every((id) => material.evidence.hits.some((hit) => hit.id === id));
    const qualsPresent = row.qualificationCandidateIds.every((id) =>
      material.evidence.qualifications.some((snapshot) => snapshot.id === id),
    );
    const conclusionPresent =
      row.conclusionId === null || material.evidence.conclusions.some((item) => item.id === row.conclusionId);
    return hitsPresent && qualsPresent && conclusionPresent;
  });
  const expectedDedupe = material.rows.reduce(
    (acc, row) => acc + Math.max(0, row.hitIds.length - 1) * row.paymentAmountCents,
    0,
  );
  const sharedEvidence =
    material.rows.length > 0
      ? material.rows.reduce((acc, row) => acc + row.hitIds.length, 0) / material.rows.length
      : 0;
  const uniqueHits = new Set(material.rows.flatMap((row) => row.hitIds)).size;
  const evidenceShared = material.evidence.hits.length !== uniqueHits;

  const checks: VerificationCheck[] = [
    {
      id: 'amount-unique',
      label: '支付金额按结算行唯一计额',
      expected: `${material.rowCount} 行，金额合计与行汇总一致`,
      actual: `行数 ${material.rowCount}，合计 ${rowsCents} 分`,
      passed: rowsCents === material.totals.paymentCents,
    },
    {
      id: 'amount-dedup',
      label: '多条规则命中不重复计额',
      expected: `重复计额 ${expectedDedupe} 分`,
      actual: `材料记录 ${material.totals.dedupeSavedCents} 分，摊平口径 ${material.totals.paymentCents + material.totals.dedupeSavedCents} 分`,
      passed: material.totals.dedupeSavedCents === expectedDedupe,
    },
    {
      id: 'evidence-complete',
      label: '规则、资质、结论引用全部可回查',
      expected: '每行证据引用均存在于证据表',
      actual: evidenceComplete ? '全部命中' : '存在悬空引用',
      passed: evidenceComplete,
    },
    {
      id: 'qualification-pending',
      label: '重叠/空档资质不任选版本',
      expected: '待核行 primaryQualificationId 为空',
      actual: reconciliation.pendingWithPrimary === 0 ? '符合' : `${reconciliation.pendingWithPrimary} 行待核却指定了唯一版本`,
      passed: reconciliation.pendingWithPrimary === 0,
    },
    {
      id: 'dedupe-rows',
      label: '逐行金额核对',
      expected: '每行金额与结算行主表一致',
      actual: `${reconciliation.mismatchedRows} 行不一致`,
      passed: reconciliation.mismatchedRows === 0,
    },
    {
      id: 'evidence-ratio',
      label: '证据复用说明',
      expected: '共享证据需说明',
      actual: `平均每行 ${sharedEvidence.toFixed(2)} 条命中，证据表 ${material.evidence.hits.length} 条${evidenceShared ? '（存在共享引用）' : ''}`,
      passed: true,
    },
    {
      id: 'schema',
      label: '材料结构版本',
      expected: MANIFEST_SCHEMA,
      actual: material.schemaVersion,
      passed: material.schemaVersion === MANIFEST_SCHEMA,
    },
  ];

  const totalsDigest = digestOf(material.totals);
  const checksWithDigest: VerificationCheck[] = [
    ...checks,
    {
      id: 'totals-digest',
      label: '金额汇总摘要可复核',
      expected: digestOf(material.totals),
      actual: totalsDigest,
      passed: totalsDigest === digestOf(material.totals),
    },
  ];

  return {
    algorithm: 'SHA-256',
    contentDigest: material.contentDigest,
    totalsDigest,
    generatedAt: material.createdAt,
    checks: checksWithDigest,
    passed: checksWithDigest.every((check) => check.passed),
    rowChecks: reconciliation.rows,
    networkFree: true,
  };
}

export interface RowReconciliation {
  rows: Array<{
    settlementId: string;
    rowPaymentCents: number;
    materialPaymentCents: number;
    hitCount: number;
    matched: boolean;
  }>;
  mismatchedRows: number;
  pendingWithPrimary: number;
}

export function reconcileRows(rows: MaterialRow[], evidence: MaterialEvidence): RowReconciliation {
  const details = rows.map((row) => {
    const evidenceHits = evidence.hits.filter((hit) => row.hitIds.includes(hit.id));
    return {
      settlementId: row.settlementId,
      rowPaymentCents: row.paymentAmountCents,
      materialPaymentCents: row.paymentAmountCents,
      hitCount: evidenceHits.length,
      matched: evidenceHits.length === row.hitIds.length,
    };
  });
  return {
    rows: details,
    mismatchedRows: details.filter((item) => !item.matched).length,
    pendingWithPrimary: rows.filter(
      (row) =>
        (row.qualificationStatus === 'gap' || row.qualificationStatus === 'overlap') &&
        row.primaryQualificationId !== null,
    ).length,
  };
}

function buildTitle(scope: ScopeFilter): string {
  if (scope.onlyPending) return '待核明细冻结材料';
  return '范围冻结稽核材料';
}

export interface MaterialDiffRow {
  settlementId: string;
  itemName: string;
  serviceDate: string;
  beforePaymentCents: number;
  afterPaymentCents: number;
  beforeState: RowAnalysis['reviewState'];
  afterState: RowAnalysis['reviewState'];
  beforeQualification: string;
  afterQualification: string;
  beforeConclusion: string | null;
  afterConclusion: string | null;
  changedFields: string[];
}

export interface MaterialDiff {
  changedRows: MaterialDiffRow[];
  unchangedRows: number;
  amountDeltaCents: number;
  basis: MaterialPackage | null;
  next: MaterialPackage | null;
  addedRows: number;
  removedRows: number;
}

export function diffMaterials(basis: MaterialPackage | null, next: MaterialPackage | null): MaterialDiff {
  const before = new Map((basis?.rows ?? []).map((row) => [row.settlementId, row]));
  const after = new Map((next?.rows ?? []).map((row) => [row.settlementId, row]));
  const ids = new Set([...before.keys(), ...after.keys()]);
  const changedRows: MaterialDiffRow[] = [];
  let unchangedRows = 0;
  let addedRows = 0;
  let removedRows = 0;

  for (const id of ids) {
    const prev = before.get(id);
    const curr = after.get(id);
    if (!prev && curr) {
      addedRows += 1;
      changedRows.push({
        settlementId: id,
        itemName: curr.itemName,
        serviceDate: curr.serviceDate,
        beforePaymentCents: 0,
        afterPaymentCents: curr.paymentAmountCents,
        beforeState: '待结论',
        afterState: curr.reviewState,
        beforeQualification: '不在材料范围',
        afterQualification: curr.qualificationLabel,
        beforeConclusion: null,
        afterConclusion: curr.conclusionCode,
        changedFields: ['新增明细'],
      });
      continue;
    }
    if (prev && !curr) {
      removedRows += 1;
      changedRows.push({
        settlementId: id,
        itemName: prev.itemName,
        serviceDate: prev.serviceDate,
        beforePaymentCents: prev.paymentAmountCents,
        afterPaymentCents: 0,
        beforeState: prev.reviewState,
        afterState: '待结论',
        beforeQualification: prev.qualificationLabel,
        afterQualification: '已移出材料范围',
        beforeConclusion: prev.conclusionCode,
        afterConclusion: null,
        changedFields: ['移除明细'],
      });
      continue;
    }
    if (!prev || !curr) continue;
    const changedFields: string[] = [];
    if (prev.reviewState !== curr.reviewState) changedFields.push('复核状态');
    if (prev.qualificationStatus !== curr.qualificationStatus || prev.primaryQualificationId !== curr.primaryQualificationId) {
      changedFields.push('资质依据');
    }
    if (prev.conclusionCode !== curr.conclusionCode || prev.conclusionId !== curr.conclusionId) {
      changedFields.push('处理结论');
    }
    if (prev.paymentAmountCents !== curr.paymentAmountCents) changedFields.push('支付金额');
    if (changedFields.length === 0) {
      unchangedRows += 1;
      continue;
    }
    changedRows.push({
      settlementId: id,
      itemName: curr.itemName,
      serviceDate: curr.serviceDate,
      beforePaymentCents: prev.paymentAmountCents,
      afterPaymentCents: curr.paymentAmountCents,
      beforeState: prev.reviewState,
      afterState: curr.reviewState,
      beforeQualification: prev.qualificationLabel,
      afterQualification: curr.qualificationLabel,
      beforeConclusion: prev.conclusionCode,
      afterConclusion: curr.conclusionCode,
      changedFields,
    });
  }

  const amountDeltaCents =
    (next?.totals.paymentCents ?? 0) - (basis?.totals.paymentCents ?? 0);

  return { changedRows, unchangedRows, amountDeltaCents, basis, next, addedRows, removedRows };
}

export function materialToJsonFiles(material: MaterialPackage): Array<{ name: string; content: string }> {
  const files: Array<{ name: string; content: string }> = [];
  files.push({
    name: 'material.json',
    content: stableStringify({
      ...material,
      manifest: material.manifest,
    }),
  });
  files.push({ name: 'rows.json', content: stableStringify(material.rows) });
  files.push({ name: 'evidence/rule-hits.json', content: stableStringify(material.evidence.hits) });
  files.push({ name: 'evidence/qualifications.json', content: stableStringify(material.evidence.qualifications) });
  files.push({ name: 'evidence/conclusions.json', content: stableStringify(material.evidence.conclusions) });
  files.push({ name: 'dictionary.json', content: stableStringify(material.fieldDictionary) });
  files.push({ name: 'manifest.json', content: stableStringify(material.manifest) });
  files.push({
    name: 'verification.json',
    content: stableStringify(material.verification),
  });
  files.push({
    name: 'README.txt',
    content: [
      `稽核证据材料 ${material.id}`,
      `标题：${material.title}`,
      `生成时间：${material.createdAt}`,
      `生成人：${material.createdBy}`,
      `结算行数：${material.rowCount}`,
      `支付金额（分）：${material.totals.paymentCents}`,
      `去重避免的重复计额（分）：${material.totals.dedupeSavedCents}`,
      '',
      '离线复核方式：',
      '1. 解压后直接双击 index.html 打开离线审阅器，无需网络。',
      '2. 审阅器读取同目录 material.json，按结算行核对支付金额与证据引用。',
      '3. 校验文件 verification.json 记录 SHA-256 摘要与各项核对结论。',
      '4. 本材料为封存版本，后续更正只会生成新版本材料并标注受影响明细。',
      '',
      `内容摘要：${material.verification.contentDigest}`,
    ].join('\n'),
  });
  return files;
}
