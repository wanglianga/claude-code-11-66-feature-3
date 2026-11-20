export type Severity = '高' | '中' | '低';

export type QualificationStatus = 'ok' | 'gap' | 'overlap' | 'inactive';

export type QualificationState = '有效' | '暂停' | '注销';

export type VisitType = '住院' | '门诊' | '门诊慢特病' | '日间手术';

export type FundType = '职工医保' | '城乡居民' | '大病保险' | '医疗救助';

export type BatchRole =
  | '结算明细'
  | '规则命中'
  | '资质快照'
  | '处理结论'
  | '字段字典'
  | '规则目录'
  | '更正批次';

export type ConclusionCode = '合规' | '违规' | '待核' | '整改';

export type ReviewState = '已复核' | '待核' | '待结论';

export interface AreaDef {
  code: string;
  name: string;
  shortName: string;
}

export interface ItemDef {
  code: string;
  name: string;
  shortName: string;
  category: string;
  baseMinCents: number;
  baseMaxCents: number;
}

export interface RuleDef {
  code: string;
  name: string;
  clause: string;
  severity: Severity;
  description: string;
  itemCodes: string[];
}

export interface Institution {
  code: string;
  name: string;
  shortName: string;
  areaCode: string;
  areaName: string;
  level: string;
  type: string;
}

export interface SettlementRow {
  id: string;
  personRef: string;
  itemCode: string;
  itemName: string;
  poolingAreaCode: string;
  poolingAreaName: string;
  institutionCode: string;
  institutionName: string;
  institutionLevel: string;
  serviceDate: string;
  totalAmountCents: number;
  paymentAmountCents: number;
  selfPayCents: number;
  suspectedAmountCents: number;
  fundType: FundType;
  visitType: VisitType;
  sourceBatchId: string;
  sourceVersion: string;
  rowNumber: number;
  inputDigest: string;
  correctedByBatchId?: string;
}

export interface RuleHit {
  id: string;
  settlementId: string;
  ruleCode: string;
  ruleName: string;
  severity: Severity;
  clause: string;
  finding: string;
  confidence: number;
  sequence: number;
  detectedAt: string;
  sourceBatchId: string;
  /** 单条命中提示金额，仅用于解释，不进入任何汇总。 */
  hintAmountCents: number;
}

export interface QualificationSnapshot {
  id: string;
  institutionCode: string;
  institutionName: string;
  checkItemCode: string;
  checkItemName: string;
  certNo: string;
  validFrom: string;
  validTo: string | null;
  state: QualificationState;
  revision: number;
  sourceBatchId: string;
  revisedAt: string;
  note: string;
  /** 更正快照声明其取代的旧快照；仅影响后续分析，不改写已封存材料。 */
  supersedes?: string[];
}

export interface Conclusion {
  id: string;
  settlementId: string;
  code: ConclusionCode;
  label: string;
  deductionCents: number;
  handler: string;
  decidedAt: string;
  sourceBatchId: string;
  version: number;
  note: string;
}

export interface BatchRecord {
  id: string;
  batchNo: string;
  role: BatchRole;
  fileName: string;
  sourceVersion: string;
  rowCount: number;
  sha256: string;
  importedAt: string;
  status: '生效' | '已被更正' | '更正批次';
  note: string;
}

export interface FieldDictionaryEntry {
  code: string;
  label: string;
  dataType: string;
  required: boolean;
  sourceTable: string;
  description: string;
  example: string;
  version: string;
}

export interface BatchCatalog {
  batches: BatchRecord[];
  dictionary: FieldDictionaryEntry[];
}

export interface DatasetConfig {
  rowCount: number;
  seed: number;
  anomalyRate: number;
  pendingConclusions: number;
}

export interface DatasetMeta {
  datasetId: string;
  schemaVersion: string;
  province: string;
  sourceLabel: string;
  generatedAt: string;
  seed: number;
  config: DatasetConfig;
  versions: {
    settlement: string;
    ruleHit: string;
    qualification: string;
    conclusion: string;
    dictionary: string;
  };
  correctionCount: number;
}

export interface Dataset {
  meta: DatasetMeta;
  areas: AreaDef[];
  items: ItemDef[];
  institutions: Institution[];
  rules: RuleDef[];
  settlements: SettlementRow[];
  hits: RuleHit[];
  qualifications: QualificationSnapshot[];
  conclusions: Conclusion[];
  batches: BatchRecord[];
  dictionary: FieldDictionaryEntry[];
}

export interface QualificationResolution {
  status: QualificationStatus;
  label: string;
  candidates: QualificationSnapshot[];
  primary: QualificationSnapshot | null;
  detail: string;
}

export interface RowAnalysis {
  row: SettlementRow;
  hits: RuleHit[];
  qualification: QualificationResolution;
  conclusion: Conclusion | null;
  reviewState: ReviewState;
  evidenceRefs: string[];
}

export interface DatasetAnalysis {
  rows: RowAnalysis[];
  byId: Record<string, RowAnalysis>;
  totals: {
    rowCount: number;
    paymentCents: number;
    suspectedCents: number;
    hitCount: number;
    hitHintCents: number;
    duplicatedHintCents: number;
    /** 待核 + 待结论的行数。 */
    pendingRows: number;
    /** 仅资质待核（重叠/空档）的行数。 */
    pendingReviewRows: number;
    resolvedQualifications: number;
    gapRows: number;
    overlapRows: number;
    conclusionRows: number;
  };
  ruleCounts: Record<string, number>;
  severityCounts: Record<Severity, number>;
  itemCounts: Record<string, number>;
  areaCounts: Record<string, number>;
  pendingSamples: string[];
}

export interface ScopeFilter {
  itemCodes: string[];
  areaCodes: string[];
  institutionCodes: string[];
  ruleCodes: string[];
  dateFrom: string;
  dateTo: string;
  onlyPending: boolean;
}

export interface MaterialRow {
  settlementId: string;
  rowNumber: number;
  serviceDate: string;
  itemCode: string;
  itemName: string;
  areaCode: string;
  areaName: string;
  institutionCode: string;
  institutionName: string;
  paymentAmountCents: number;
  suspectedAmountCents: number;
  visitType: VisitType;
  fundType: FundType;
  reviewState: ReviewState;
  qualificationStatus: QualificationStatus;
  qualificationLabel: string;
  qualificationCandidateIds: string[];
  primaryQualificationId: string | null;
  hitIds: string[];
  hitCodes: string[];
  conclusionId: string | null;
  conclusionCode: ConclusionCode | null;
  inputDigest: string;
}

export interface MaterialEvidence {
  hits: RuleHit[];
  qualifications: QualificationSnapshot[];
  conclusions: Conclusion[];
}

export interface ManifestEntry {
  kind: string;
  fileName: string;
  sourceVersion: string;
  batchId: string;
  rowCount: number;
  sha256: string;
}

export interface VerificationCheck {
  id: string;
  label: string;
  expected: string;
  actual: string;
  passed: boolean;
}

export interface MaterialRowCheck {
  settlementId: string;
  rowPaymentCents: number;
  materialPaymentCents: number;
  hitCount: number;
  matched: boolean;
}

export interface MaterialVerification {
  algorithm: 'SHA-256';
  contentDigest: string;
  totalsDigest: string;
  generatedAt: string;
  checks: VerificationCheck[];
  rowChecks: MaterialRowCheck[];
  networkFree: boolean;
  passed: boolean;
}

export interface MaterialCorrection {
  reason: string;
  batchIds: string[];
  affectedRowIds: string[];
  appliedAt: string;
  sourceVersion: string;
}

export interface MaterialPackage {
  id: string;
  schemaVersion: string;
  version: number;
  title: string;
  scope: ScopeFilter;
  scopeHash: string;
  createdAt: string;
  createdBy: string;
  status: '已封存';
  basisPackageId: string | null;
  datasetId: string;
  rowCount: number;
  totals: {
    paymentCents: number;
    suspectedCents: number;
    pendingRows: number;
    hitCount: number;
    uniqueRules: number;
    dedupeSavedCents: number;
  };
  rows: MaterialRow[];
  evidence: MaterialEvidence;
  manifest: ManifestEntry[];
  fieldDictionary: FieldDictionaryEntry[];
  verification: MaterialVerification;
  correction: MaterialCorrection | null;
  notes: string;
}

export interface AuditEvent {
  id: string;
  at: string;
  kind: '导入' | '冻结' | '更正' | '校验' | '导出' | '初始化';
  title: string;
  detail: string;
  materialId?: string;
}

export interface CorrectionPreview {
  scenario: 'conclusion' | 'qualification';
  title: string;
  summary: string;
  affectedSettlementIds: string[];
  newConclusions: Conclusion[];
  newQualifications: QualificationSnapshot[];
  batches: BatchRecord[];
  effectiveFrom: string;
}

export interface AppSnapshot {
  dataset: Dataset;
  analysis: DatasetAnalysis;
  batches: BatchRecord[];
  events: AuditEvent[];
  materials: MaterialPackage[];
  activeCorrectionIds: string[];
}
