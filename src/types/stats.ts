import type { BatchRecord } from './domain';

/**
 * 医保服务项目代码沿革与历史可比统计 · 领域类型
 *
 * 与稽核模块（types/domain.ts）相互独立：本模块读取跨年度结算提取行的
 * 服务日期与项目编码，结合版本化目录与映射关系，输出可跨期比较的统计口径。
 */

/** 国家项目类别（稳定主干，逐级细化；跨目录版本保持不变）。 */
export interface NationalCategory {
  code: string;
  name: string;
  level: 1 | 2 | 3;
  parentCode: string | null;
}

/** 地方医疗服务项目目录版本。 */
export interface CatalogVersion {
  id: string;
  label: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  issuedAt: string;
  note: string;
}

/**
 * 目录条目：某版目录中一个地方代码的释义。
 * 同一地方代码被复用时，不同有效期各有一条条目，按服务发生日分段命中。
 */
export interface CatalogEntry {
  id: string;
  catalogVersionId: string;
  localCode: string;
  itemName: string;
  nationalCategoryCode: string;
  definition: string;
  validFrom: string;
  validTo: string | null;
  status: '现行' | '停用';
  note: string;
}

export type MappingKind = '更名' | '等价替换' | '拆分' | '合并';

/**
 * 映射关系：相邻两版目录之间的代码对照。
 * evidenceStatus 为「缺失」的映射不用于金额分配（无依据映射样例）。
 * 拆分的 weights 为分摊依据（如用量调查），仅作候选参考，不等于已分配金额。
 */
export interface CodeMapping {
  id: string;
  kind: MappingKind;
  fromCatalogId: string;
  toCatalogId: string;
  fromCodes: string[];
  toCodes: string[];
  effectiveDate: string;
  evidenceSource: string;
  evidenceStatus: '齐全' | '缺失';
  allocationBasis: string;
  weights: Record<string, number> | null;
  note: string;
}

/** 跨年度结算提取行：政策统计模块的输入明细。 */
export interface StatSettlementRow {
  id: string;
  serviceDate: string;
  year: number;
  localCode: string;
  itemName: string;
  amountCents: number;
  sourceBatchId: string;
}

/** 统计模块整体状态：目录 + 映射 + 结算提取 + 批次。 */
export interface StatsState {
  catalogs: CatalogVersion[];
  entries: CatalogEntry[];
  mappings: CodeMapping[];
  rows: StatSettlementRow[];
  batches: BatchRecord[];
  correctionsApplied: string[];
}

/** 目录更正批次：补充证据 / 修正条目类别，只声明受影响的代码。 */
export interface CatalogCorrection {
  batch: BatchRecord;
  entries: CatalogEntry[];
  mappings: CodeMapping[];
  affectedCodes: string[];
  note: string;
}

export type ResolutionStatus = 'current' | 'mapped' | 'ambiguous' | 'unmapped';

/** 解析链中的一环：某版目录中命中的一条条目，以及到达它的方式。 */
export interface ChainLink {
  catalogVersionId: string;
  localCode: string;
  itemName: string;
  nationalCategoryCode: string;
  via: '起始' | '沿用' | { mappingId: string; kind: MappingKind };
}

/** 拆分候选：目标代码、其现行最细类别与分摊权重（无依据时为 null）。 */
export interface SplitCandidate {
  toCode: string;
  itemName: string;
  categoryCode: string;
  weight: number | null;
}

/**
 * 行级解析结果（最细类别投影口径）。
 * 金额归属互斥：current/mapped 计入唯一目标类别；ambiguous 进歧义池；
 * unmapped 进未映射池。任何一行只落入一个归属，保证金额不重复。
 */
export interface RowResolution {
  rowId: string;
  year: number;
  localCode: string;
  amountCents: number;
  status: ResolutionStatus;
  entryId: string | null;
  catalogVersionId: string | null;
  targetCategoryCode: string | null;
  candidates: SplitCandidate[];
  chain: ChainLink[];
  reason: string;
}

export interface YearCell {
  rows: number;
  amountCents: number;
}

/** 统计运行版本：冻结输入快照 + 行级解析结果，旧口径可随时复现。 */
export interface StatsRun {
  id: string;
  version: number;
  label: string;
  createdAt: string;
  status: '当前' | '历史';
  rowsDigest: string;
  catalogDigest: string;
  outputDigest: string;
  snapshot: {
    entries: CatalogEntry[];
    mappings: CodeMapping[];
  };
  supersedesRunId: string | null;
  correctionNote: string | null;
  /** 更正重建时声明的影响范围；首版为 null。 */
  affectedScope: {
    codes: string[];
    years: number[];
    changedRowIds: string[];
  } | null;
  /** 相对上一版逐字沿用的未受影响行数。 */
  carriedOverRows: number;
  resolutions: RowResolution[];
}

/** 两个运行版本之间的差异。 */
export interface RunDiff {
  baseRunId: string;
  compareRunId: string;
  changedRows: Array<{
    rowId: string;
    localCode: string;
    year: number;
    beforeStatus: ResolutionStatus;
    afterStatus: ResolutionStatus;
    beforeTarget: string | null;
    afterTarget: string | null;
  }>;
  affectedCodes: string[];
  affectedYears: number[];
  unchangedRows: number;
  categoryDeltas: Array<{
    categoryCode: string;
    year: number;
    beforeCents: number;
    afterCents: number;
    deltaCents: number;
  }>;
  parentDeltas: Array<{
    categoryCode: string;
    year: number;
    beforeCents: number;
    afterCents: number;
    deltaCents: number;
  }>;
}
