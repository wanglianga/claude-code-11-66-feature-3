import type {
  Conclusion,
  ConclusionCode,
  Dataset,
  DatasetAnalysis,
  QualificationResolution,
  QualificationSnapshot,
  ReviewState,
  RowAnalysis,
  ScopeFilter,
  Severity,
} from '../types/domain';

export const EMPTY_SCOPE: ScopeFilter = {
  itemCodes: [],
  areaCodes: [],
  institutionCodes: [],
  ruleCodes: [],
  dateFrom: '2025-01-01',
  dateTo: '2025-06-30',
  onlyPending: false,
};

/**
 * 资质解析：同一机构×项目在服务日的快照可能重叠、空档或状态异常。
 * 更正快照通过 supersedes 声明其取代替换的旧版本，避免“用当前状态改写历史”。
 */
export function resolveQualification(
  snapshots: QualificationSnapshot[],
  serviceDate: string,
): QualificationResolution {
  const candidates = snapshots.filter((snapshot) => {
    if (serviceDate < snapshot.validFrom) return false;
    if (snapshot.validTo && serviceDate > snapshot.validTo) return false;
    return true;
  });

  const replaced = new Set<string>();
  for (const snapshot of candidates) {
    for (const id of snapshot.supersedes ?? []) replaced.add(id);
  }
  const effective = candidates.filter((snapshot) => !replaced.has(snapshot.id));

  if (effective.length === 0) {
    return {
      status: 'gap',
      label: '资质空档',
      candidates,
      primary: null,
      detail: `服务日 ${serviceDate} 无任何生效资质快照，列为待核，不推定版本。`,
    };
  }
  if (effective.length > 1) {
    return {
      status: 'overlap',
      label: '资质重叠',
      candidates,
      primary: null,
      detail: `服务日 ${serviceDate} 存在 ${effective.length} 份并行快照（${effective
        .map((snapshot) => snapshot.id)
        .join('、')}），列入待核，不任选一版。`,
    };
  }
  const primary = effective[0]!;
  if (primary.state !== '有效') {
    return {
      status: 'inactive',
      label: `资质${primary.state}`,
      candidates,
      primary,
      detail: `服务日 ${serviceDate} 唯一快照 ${primary.id} 状态为「${primary.state}」：${primary.note}`,
    };
  }
  return {
    status: 'ok',
    label: '资质有效',
    candidates,
    primary,
    detail: `服务日 ${serviceDate} 由快照 ${primary.id}（${primary.certNo}）覆盖。`,
  };
}

export function latestConclusions(conclusions: Conclusion[]): Map<string, Conclusion> {
  const map = new Map<string, Conclusion>();
  for (const conclusion of conclusions) {
    const current = map.get(conclusion.settlementId);
    if (!current || conclusion.version > current.version) {
      map.set(conclusion.settlementId, conclusion);
    }
  }
  return map;
}

export function reviewStateOf(
  status: QualificationResolution['status'],
  conclusionCode: ConclusionCode | null,
): ReviewState {
  if (status === 'gap' || status === 'overlap') return '待核';
  if (!conclusionCode || conclusionCode === '待核') return '待结论';
  return '已复核';
}

export function analyzeDataset(dataset: Dataset): DatasetAnalysis {
  const hitsBySettlement = new Map<string, Dataset['hits']>();
  for (const hit of dataset.hits) {
    const bucket = hitsBySettlement.get(hit.settlementId) ?? [];
    bucket.push(hit);
    hitsBySettlement.set(hit.settlementId, bucket);
  }
  for (const bucket of hitsBySettlement.values()) {
    bucket.sort((a, b) => a.sequence - b.sequence);
  }

  const snapshotsByKey = new Map<string, QualificationSnapshot[]>();
  for (const snapshot of dataset.qualifications) {
    const key = `${snapshot.institutionCode}|${snapshot.checkItemCode}`;
    const bucket = snapshotsByKey.get(key) ?? [];
    bucket.push(snapshot);
    snapshotsByKey.set(key, bucket);
  }

  const conclusions = latestConclusions(dataset.conclusions);
  const rows: RowAnalysis[] = [];
  const byId: Record<string, RowAnalysis> = {};

  let paymentCents = 0;
  let suspectedCents = 0;
  let hitCount = 0;
  let hitHintCents = 0;
  let pendingRows = 0;
  let pendingReviewRows = 0;
  let resolvedQualifications = 0;
  let gapRows = 0;
  let overlapRows = 0;
  let conclusionRows = 0;
  const ruleCounts: Record<string, number> = {};
  const severityCounts: Record<Severity, number> = { 高: 0, 中: 0, 低: 0 };
  const itemCounts: Record<string, number> = {};
  const areaCounts: Record<string, number> = {};
  const pendingSamples: string[] = [];

  for (const row of dataset.settlements) {
    const hits = hitsBySettlement.get(row.id) ?? [];
    const snapshots = snapshotsByKey.get(`${row.institutionCode}|${row.itemCode}`) ?? [];
    const qualification = resolveQualification(snapshots, row.serviceDate);
    const conclusion = conclusions.get(row.id) ?? null;
    const reviewState = reviewStateOf(qualification.status, conclusion?.code ?? null);
    const evidenceRefs = [
      ...hits.map((hit) => hit.id),
      ...qualification.candidates.map((snapshot) => snapshot.id),
      ...(conclusion ? [conclusion.id] : []),
    ];

    const analysis: RowAnalysis = {
      row,
      hits,
      qualification,
      conclusion,
      reviewState,
      evidenceRefs,
    };
    rows.push(analysis);
    byId[row.id] = analysis;

    // 金额只按结算行累计一次；命中条数不参与金额乘法。
    paymentCents += row.paymentAmountCents;
    suspectedCents += row.suspectedAmountCents;
    hitCount += hits.length;
    for (const hit of hits) {
      hitHintCents += hit.hintAmountCents;
      ruleCounts[hit.ruleCode] = (ruleCounts[hit.ruleCode] ?? 0) + 1;
      severityCounts[hit.severity] += 1;
    }
    itemCounts[row.itemCode] = (itemCounts[row.itemCode] ?? 0) + 1;
    areaCounts[row.poolingAreaCode] = (areaCounts[row.poolingAreaCode] ?? 0) + 1;
    if (qualification.status === 'ok' || qualification.status === 'inactive') resolvedQualifications += 1;
    if (qualification.status === 'gap') {
      gapRows += 1;
      if (pendingSamples.length < 40) pendingSamples.push(row.id);
    }
    if (qualification.status === 'overlap') {
      overlapRows += 1;
      if (pendingSamples.length < 40) pendingSamples.push(row.id);
    }
    if (reviewState === '待核') pendingReviewRows += 1;
    if (reviewState === '待核' || reviewState === '待结论') pendingRows += 1;
    if (conclusion) conclusionRows += 1;
  }

  // 若按“规则命中摊平”汇总，每行支付金额会被重复计入 —— 用于展示重复计额风险。
  const flattenedExtraCents = rows.reduce(
    (acc, analysis) =>
      acc + Math.max(0, analysis.hits.length - 1) * analysis.row.paymentAmountCents,
    0,
  );

  return {
    rows,
    byId,
    totals: {
      rowCount: rows.length,
      paymentCents,
      suspectedCents,
      hitCount,
      hitHintCents,
      duplicatedHintCents: flattenedExtraCents,
      pendingRows,
      pendingReviewRows,
      resolvedQualifications,
      gapRows,
      overlapRows,
      conclusionRows,
    },
    ruleCounts,
    severityCounts,
    itemCounts,
    areaCounts,
    pendingSamples,
  };
}

export function rowMatchesScope(analysis: RowAnalysis, scope: ScopeFilter): boolean {
  const { row, hits, qualification } = analysis;
  if (scope.itemCodes.length > 0 && !scope.itemCodes.includes(row.itemCode)) return false;
  if (scope.areaCodes.length > 0 && !scope.areaCodes.includes(row.poolingAreaCode)) return false;
  if (scope.institutionCodes.length > 0 && !scope.institutionCodes.includes(row.institutionCode)) return false;
  if (scope.ruleCodes.length > 0 && !hits.some((hit) => scope.ruleCodes.includes(hit.ruleCode))) return false;
  if (scope.dateFrom && row.serviceDate < scope.dateFrom) return false;
  if (scope.dateTo && row.serviceDate > scope.dateTo) return false;
  if (scope.onlyPending) {
    const pending = analysis.reviewState === '待核' || qualification.status === 'gap' || qualification.status === 'overlap';
    if (!pending) return false;
  }
  return true;
}

export function filterRows(analysis: DatasetAnalysis, scope: ScopeFilter): RowAnalysis[] {
  return analysis.rows.filter((row) => rowMatchesScope(row, scope));
}

export function scopeFingerprint(scope: ScopeFilter): string {
  return JSON.stringify({
    itemCodes: [...scope.itemCodes].sort(),
    areaCodes: [...scope.areaCodes].sort(),
    institutionCodes: [...scope.institutionCodes].sort(),
    ruleCodes: [...scope.ruleCodes].sort(),
    dateFrom: scope.dateFrom,
    dateTo: scope.dateTo,
    onlyPending: scope.onlyPending,
  });
}

export function isScopeEmpty(scope: ScopeFilter): boolean {
  return (
    scope.itemCodes.length === 0 &&
    scope.areaCodes.length === 0 &&
    scope.institutionCodes.length === 0 &&
    scope.ruleCodes.length === 0 &&
    !scope.onlyPending &&
    scope.dateFrom === EMPTY_SCOPE.dateFrom &&
    scope.dateTo === EMPTY_SCOPE.dateTo
  );
}
