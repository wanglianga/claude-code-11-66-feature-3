import type { Dataset } from '../types/domain';

export interface ApplyCorrectionResult {
  dataset: Dataset;
  affectedSettlementIds: string[];
  batchId: string;
  sourceVersion: string;
}

/** 以 id 去重合并：同一更正重复应用保持幂等，后到的同 id 记录覆盖前值。 */
function mergeById<T extends { id: string }>(base: T[], additions: T[]): T[] {
  const map = new Map(base.map((item) => [item.id, item]));
  for (const item of additions) map.set(item.id, item);
  return [...map.values()];
}

/** 结论更正：追加新版本结论，旧版本保留；批次状态标注已被更正。 */
export function applyConclusionCorrection(
  dataset: Dataset,
  correction: {
    conclusions: Dataset['conclusions'];
    affectedSettlementIds: string[];
    batch: Dataset['batches'][number];
    sourceVersion: string;
  },
): ApplyCorrectionResult {
  const affected = new Set(correction.affectedSettlementIds);
  const batches = dataset.batches.map((batch) =>
    batch.role === '处理结论' ? { ...batch, status: '已被更正' as const } : batch,
  );
  const settlements = dataset.settlements.map((row) =>
    affected.has(row.id) ? { ...row, correctedByBatchId: correction.batch.id } : row,
  );
  return {
    dataset: {
      ...dataset,
      settlements,
      // 历史结论版本保留，latestConclusions 只取最大 version；重复应用同一更正不会产生重复记录。
      conclusions: mergeById(dataset.conclusions, correction.conclusions),
      batches: [...batches, correction.batch],
      meta: {
        ...dataset.meta,
        correctionCount: dataset.meta.correctionCount + 1,
        versions: { ...dataset.meta.versions, conclusion: correction.sourceVersion },
      },
    },
    affectedSettlementIds: [...affected],
    batchId: correction.batch.id,
    sourceVersion: correction.sourceVersion,
  };
}

/** 资质更正：追加补正快照并声明取代关系，不改写旧快照。 */
export function applyQualificationCorrection(
  dataset: Dataset,
  correction: {
    qualifications: Dataset['qualifications'];
    affectedSettlementIds: string[];
    batch: Dataset['batches'][number];
    sourceVersion: string;
  },
): ApplyCorrectionResult {
  const affected = new Set(correction.affectedSettlementIds);
  const batches = dataset.batches.map((batch) =>
    batch.role === '资质快照' ? { ...batch, status: '已被更正' as const } : batch,
  );
  const settlements = dataset.settlements.map((row) =>
    affected.has(row.id) ? { ...row, correctedByBatchId: correction.batch.id } : row,
  );
  return {
    dataset: {
      ...dataset,
      settlements,
      qualifications: mergeById(dataset.qualifications, correction.qualifications),
      batches: [...batches, correction.batch],
      meta: {
        ...dataset.meta,
        correctionCount: dataset.meta.correctionCount + 1,
        versions: { ...dataset.meta.versions, qualification: correction.sourceVersion },
      },
    },
    affectedSettlementIds: [...affected],
    batchId: correction.batch.id,
    sourceVersion: correction.sourceVersion,
  };
}
