import type {
  AreaDef,
  BatchRecord,
  Conclusion,
  ConclusionCode,
  Dataset,
  DatasetConfig,
  DatasetMeta,
  FieldDictionaryEntry,
  FundType,
  Institution,
  ItemDef,
  QualificationSnapshot,
  QualificationState,
  ReviewState,
  RuleDef,
  RuleHit,
  SettlementRow,
  VisitType,
} from '../types/domain';
import { digestOf } from './hash';

export const SCHEMA_VERSION = '1.4.0';
export const DATASET_ID = 'MED-AUDIT-DEMO-2025H1';

export const DEFAULT_CONFIG: DatasetConfig = {
  rowCount: 720,
  seed: 20250630,
  anomalyRate: 0.42,
  pendingConclusions: 26,
};

export const AREAS: AreaDef[] = [
  { code: '3101', name: '江省城东统筹区', shortName: '城东' },
  { code: '3102', name: '江省城西统筹区', shortName: '城西' },
  { code: '3201', name: '江省临江统筹区', shortName: '临江' },
  { code: '3202', name: '江省云岭统筹区', shortName: '云岭' },
];

export const ITEMS: ItemDef[] = [
  { code: 'JC01', name: '磁共振平扫（单部位）', shortName: '磁共振平扫', category: '大型设备检查', baseMinCents: 46000, baseMaxCents: 72000 },
  { code: 'JC02', name: 'CT 增强扫描', shortName: 'CT增强', category: '大型设备检查', baseMinCents: 28000, baseMaxCents: 46000 },
  { code: 'JC03', name: '彩色多普勒超声（心脏）', shortName: '心脏彩超', category: '常规影像', baseMinCents: 15000, baseMaxCents: 24000 },
  { code: 'JC04', name: '数字化 X 线摄影', shortName: 'DR摄影', category: '常规影像', baseMinCents: 6000, baseMaxCents: 11000 },
  { code: 'JC05', name: '动态心电图（24 小时）', shortName: '动态心电图', category: '功能检查', baseMinCents: 18000, baseMaxCents: 26000 },
  { code: 'JC06', name: '无痛胃肠镜检查', shortName: '无痛胃肠镜', category: '内镜检查', baseMinCents: 42000, baseMaxCents: 68000 },
  { code: 'JC07', name: '肿瘤标志物组合检测', shortName: '肿瘤标志物', category: '检验组合', baseMinCents: 22000, baseMaxCents: 36000 },
  { code: 'JC08', name: '骨科内固定取出术', shortName: '内固定取出', category: '手术治疗', baseMinCents: 88000, baseMaxCents: 132000 },
  { code: 'JC09', name: '康复训练评定（综合）', shortName: '康复评定', category: '康复治疗', baseMinCents: 9000, baseMaxCents: 16000 },
  { code: 'JC10', name: '血液透析（单次）', shortName: '血液透析', category: '特殊治疗', baseMinCents: 32000, baseMaxCents: 48000 },
];

export const RULES: RuleDef[] = [
  {
    code: 'R-101',
    name: '超标准收费',
    clause: '《医疗服务价格项目规范》第 12 条：实际支付高于同级别机构最高限价 15% 以上。',
    severity: '高',
    description: '支付金额显著高于项目限价，需核对计价单位与加收政策。',
    itemCodes: ['JC01', 'JC02', 'JC06', 'JC08', 'JC10'],
  },
  {
    code: 'R-201',
    name: '无资质开展',
    clause: '《定点医疗机构服务协议》第 7 条：服务发生日机构未取得对应检查项目资质。',
    severity: '高',
    description: '服务日资质快照为空档、重叠或状态非有效，需人工核定。适用于全部检查项目。',
    itemCodes: ['JC01', 'JC02', 'JC03', 'JC04', 'JC05', 'JC06', 'JC07', 'JC08', 'JC09', 'JC10'],
  },
  {
    code: 'R-301',
    name: '疑似分解收费',
    clause: '《稽核规则库》R-301：同一人员同一日同一检查项目出现多条结算行。',
    severity: '中',
    description: '同日同项目多行结算，需辨别是否为分解收费或合理多次检查。',
    itemCodes: ['JC02', 'JC03', 'JC05', 'JC07'],
  },
  {
    code: 'R-401',
    name: '基金支付范围不符',
    clause: '《医保基金支付目录》附件 3：限特定险种或就诊类型支付的项目。',
    severity: '中',
    description: '项目支付范围与险种、就诊类型不匹配。',
    itemCodes: ['JC06', 'JC09', 'JC10'],
  },
  {
    code: 'R-501',
    name: '高频就诊异常',
    clause: '《稽核规则库》R-501：同一人员 7 日内同项目就诊次数超过 3 次。',
    severity: '低',
    description: '短期内重复检查频次异常，建议结合病历复核必要性。',
    itemCodes: ['JC01', 'JC03', 'JC05', 'JC07'],
  },
  {
    code: 'R-601',
    name: '项目与明细不符',
    clause: '《结算明细校验规范》第 4.2 条：支付金额与项目计价结构不一致。',
    severity: '中',
    description: '支付金额拆分与项目计价结构不匹配，可能串换项目。',
    itemCodes: ['JC02', 'JC04', 'JC06', 'JC08'],
  },
];

export const INSTITUTIONS: Institution[] = [
  { code: 'H001', name: '城东区第一人民医院', shortName: '城东一院', areaCode: '3101', areaName: '江省城东统筹区', level: '三级甲等', type: '综合医院' },
  { code: 'H002', name: '城东区仁和社区卫生服务中心', shortName: '仁和社区', areaCode: '3101', areaName: '江省城东统筹区', level: '一级', type: '基层医疗机构' },
  { code: 'H003', name: '城西区中心医院', shortName: '城西中心', areaCode: '3102', areaName: '江省城西统筹区', level: '三级乙等', type: '综合医院' },
  { code: 'H004', name: '城西区明德中医医院', shortName: '明德中医', areaCode: '3102', areaName: '江省城西统筹区', level: '二级甲等', type: '中医医院' },
  { code: 'H005', name: '临江市人民医院', shortName: '临江人民', areaCode: '3201', areaName: '江省临江统筹区', level: '三级甲等', type: '综合医院' },
  { code: 'H006', name: '临江市康宁康复医院', shortName: '康宁康复', areaCode: '3201', areaName: '江省临江统筹区', level: '二级', type: '康复医院' },
  { code: 'H007', name: '临江市安平影像中心', shortName: '安平影像', areaCode: '3201', areaName: '江省临江统筹区', level: '二级', type: '独立影像中心' },
  { code: 'H008', name: '云岭县人民医院', shortName: '云岭人民', areaCode: '3202', areaName: '江省云岭统筹区', level: '二级甲等', type: '综合医院' },
  { code: 'H009', name: '云岭县惠民血液净化中心', shortName: '惠民血净', areaCode: '3202', areaName: '江省云岭统筹区', level: '一级', type: '专科机构' },
  { code: 'H010', name: '城东区博爱门诊部', shortName: '博爱门诊', areaCode: '3101', areaName: '江省城东统筹区', level: '未定级', type: '门诊部' },
];

const FUND_TYPES: FundType[] = ['职工医保', '城乡居民', '大病保险', '医疗救助'];
const VISIT_TYPES: VisitType[] = ['住院', '门诊', '门诊慢特病', '日间手术'];
const RULE_BY_CODE = new Map(RULES.map((rule) => [rule.code, rule]));

const BATCH_IDS = {
  settlement: 'B-SET-2025H1',
  hit: 'B-HIT-2025H1',
  qualification: 'B-QUA-2025H1',
  conclusion: 'B-CON-2025H1',
  dictionary: 'B-DIC-2025H1',
  rulebook: 'B-RUL-2025H1',
};

const VERSIONS = {
  settlement: 'SET-2025.06.30-r3',
  ruleHit: 'HIT-2025.06.30-r2',
  qualification: 'QUA-2025.06.30-r1',
  conclusion: 'CON-2025.07.15-r1',
  dictionary: 'DIC-2025.06.30-r1',
};

export const CORRECTION_BATCHES = {
  conclusion: BATCH_IDS.conclusion + '-C1',
  qualification: BATCH_IDS.qualification + '-C1',
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pad(value: number, size = 2): string {
  return String(value).padStart(size, '0');
}

function dateToIso(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function isoToUtc(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function addDays(iso: string, days: number): string {
  return dateToIso(new Date(isoToUtc(iso) + days * 86400000));
}

function daysBetween(from: string, to: string): number {
  return Math.round((isoToUtc(to) - isoToUtc(from)) / 86400000);
}

/** 服务日是否落在快照有效区间（右端为空表示长期有效）。 */
export function coversDate(snapshot: QualificationSnapshot, date: string): boolean {
  if (date < snapshot.validFrom) return false;
  if (snapshot.validTo && date > snapshot.validTo) return false;
  return true;
}

function pick<T>(rng: () => number, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length)] as T;
}

function intBetween(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function makeSnapshot(params: Partial<QualificationSnapshot> & {
  id: string;
  institutionCode: string;
  checkItemCode: string;
  validFrom: string;
  validTo: string | null;
  state: QualificationState;
  revision: number;
}): QualificationSnapshot {
  const institution = INSTITUTIONS.find((item) => item.code === params.institutionCode)!;
  const item = ITEMS.find((entry) => entry.code === params.checkItemCode)!;
  return {
    institutionName: institution.name,
    checkItemName: item.name,
    certNo: `YLZZ-${params.institutionCode}-${params.checkItemCode}-${pad(params.revision)}`,
    sourceBatchId: BATCH_IDS.qualification,
    revisedAt: '2025-01-05',
    note: '',
    ...params,
  };
}

export function buildQualifications(): QualificationSnapshot[] {
  const list: QualificationSnapshot[] = [];
  const longTermItems: Record<string, string[]> = {
    H001: ['JC01', 'JC02', 'JC03', 'JC05', 'JC06', 'JC07', 'JC08', 'JC09'],
    H002: ['JC03', 'JC04', 'JC05', 'JC07', 'JC09'],
    H003: ['JC01', 'JC02', 'JC03', 'JC04', 'JC05', 'JC07'],
    H004: ['JC03', 'JC05', 'JC07', 'JC09'],
    H005: ['JC01', 'JC02', 'JC03', 'JC05', 'JC06', 'JC07', 'JC10'],
    H006: ['JC04', 'JC05'],
    H007: ['JC01', 'JC02', 'JC03', 'JC04'],
    H008: ['JC02', 'JC03', 'JC04', 'JC05', 'JC07'],
    H009: [],
    H010: ['JC04', 'JC05', 'JC09'],
  };

  for (const institution of INSTITUTIONS) {
    for (const itemCode of longTermItems[institution.code] ?? []) {
      const item = ITEMS.find((entry) => entry.code === itemCode)!;
      list.push(
        makeSnapshot({
          id: `Q-${institution.code}-${itemCode}-01`,
          institutionCode: institution.code,
          checkItemCode: itemCode,
          validFrom: '2024-01-01',
          validTo: null,
          state: '有效',
          revision: 1,
          note: `${item.shortName} 长期资质`,
        }),
      );
    }
  }

  // 场景一：H007 无痛胃肠镜存在两版资质，服务日 2025-03 区间重叠 → 待核。
  list.push(
    makeSnapshot({
      id: 'Q-H007-JC06-01',
      institutionCode: 'H007',
      checkItemCode: 'JC06',
      validFrom: '2025-02-01',
      validTo: '2025-04-30',
      state: '有效',
      revision: 1,
      note: '影像中心增设内镜资质，2025-02 起试运行。',
    }),
    makeSnapshot({
      id: 'Q-H007-JC06-02',
      institutionCode: 'H007',
      checkItemCode: 'JC06',
      validFrom: '2025-03-01',
      validTo: '2025-03-31',
      state: '有效',
      revision: 2,
      note: '补充备案重复登记，与首版区间重叠。',
    }),
  );

  // 场景二：H005 骨科内固定取出术在 2025-03 存在空档 → 待核。
  list.push(
    makeSnapshot({
      id: 'Q-H005-JC08-01',
      institutionCode: 'H005',
      checkItemCode: 'JC08',
      validFrom: '2024-01-01',
      validTo: '2025-02-28',
      state: '有效',
      revision: 1,
      note: '首版备案。',
    }),
    makeSnapshot({
      id: 'Q-H005-JC08-02',
      institutionCode: 'H005',
      checkItemCode: 'JC08',
      validFrom: '2025-04-01',
      validTo: null,
      state: '有效',
      revision: 2,
      note: '换证后新备案，3 月处于空档。',
    }),
  );

  // 场景三：H009 血液透析资质 2025-05 起注销；此前服务日仍按当时有效快照解释。
  list.push(
    makeSnapshot({
      id: 'Q-H009-JC10-01',
      institutionCode: 'H009',
      checkItemCode: 'JC10',
      validFrom: '2024-01-01',
      validTo: '2025-04-30',
      state: '有效',
      revision: 1,
      note: '首版血净资质，2025-05 起被注销版本取代。',
    }),
    makeSnapshot({
      id: 'Q-H009-JC10-02',
      institutionCode: 'H009',
      checkItemCode: 'JC10',
      validFrom: '2025-05-01',
      validTo: null,
      state: '注销',
      revision: 2,
      revisedAt: '2025-05-06',
      note: '血净资质自 2025-05-01 注销；服务日在 4 月及以前的结算仍按首版解释。',
      supersedes: ['Q-H009-JC10-01'],
    }),
  );

  // 场景四：H006 康复评定资质 4 月暂停。
  list.push(
    makeSnapshot({
      id: 'Q-H006-JC09-03',
      institutionCode: 'H006',
      checkItemCode: 'JC09',
      validFrom: '2024-01-01',
      validTo: null,
      state: '暂停',
      revision: 3,
      revisedAt: '2025-04-02',
      note: '康复评定资质 2025-04 起暂停，快照状态按服务日可回查。',
    }),
  );

  return list.sort((a, b) => a.id.localeCompare(b.id));
}

export interface GenerationResult {
  dataset: Dataset;
  config: DatasetConfig;
}

export function generateDataset(config: DatasetConfig = DEFAULT_CONFIG): Dataset {
  const rng = mulberry32(config.seed);
  const settlementRows: SettlementRow[] = [];
  const hits: RuleHit[] = [];
  const conclusions: Conclusion[] = [];
  const qualifications = buildQualifications();
  const qualificationsByKey = new Map<string, QualificationSnapshot[]>();
  for (const snapshot of qualifications) {
    const key = `${snapshot.institutionCode}|${snapshot.checkItemCode}`;
    const bucket = qualificationsByKey.get(key) ?? [];
    bucket.push(snapshot);
    qualificationsByKey.set(key, bucket);
  }

  // 机构实际开展的项目：常规行优先从已备案项目中选择，未备案组合仅作为异常样本出现。
  const qualifiedItemsByInstitution = new Map<string, string[]>();
  const knownItemsByInstitution = new Map<string, string[]>();
  for (const snapshot of qualifications) {
    if (snapshot.state === '有效') {
      const bucket = qualifiedItemsByInstitution.get(snapshot.institutionCode) ?? [];
      bucket.push(snapshot.checkItemCode);
      qualifiedItemsByInstitution.set(snapshot.institutionCode, bucket);
    }
    const known = knownItemsByInstitution.get(snapshot.institutionCode) ?? [];
    known.push(snapshot.checkItemCode);
    knownItemsByInstitution.set(snapshot.institutionCode, known);
  }

  const start = '2025-01-01';
  const end = '2025-06-30';
  const span = daysBetween(start, end);
  const personPool = Array.from({ length: 260 }, (_, index) => `PA-${pad(index + 1, 4)}`);

  // 预先构造同人同日同项目的重复结算，用于 R-301 解释依据。
  const seenByPersonDay = new Map<string, number>();
  const recentKeys: Array<{ personRef: string; serviceDate: string; itemCode: string }> = [];

  const scenarioPlan: Array<{
    index: number;
    settlementId: string;
    institutionCode: string;
    itemCode: string;
    serviceDate: string;
    personRef: string;
    forceRuleCodes: string[];
    /** 按项目限价上浮倍数定价，用于构造可解释的超标准收费命中。 */
    priceFactor?: number;
  }> = [
    { index: 0, settlementId: 'S-000001', institutionCode: 'H007', itemCode: 'JC06', serviceDate: '2025-03-12', personRef: 'PA-0007', forceRuleCodes: ['R-201', 'R-101'], priceFactor: 1.32 },
    { index: 1, settlementId: 'S-000002', institutionCode: 'H005', itemCode: 'JC08', serviceDate: '2025-03-18', personRef: 'PA-0042', forceRuleCodes: ['R-201', 'R-601'] },
    { index: 2, settlementId: 'S-000003', institutionCode: 'H009', itemCode: 'JC10', serviceDate: '2025-05-20', personRef: 'PA-0101', forceRuleCodes: ['R-201', 'R-401'] },
    { index: 3, settlementId: 'S-000004', institutionCode: 'H001', itemCode: 'JC02', serviceDate: '2025-04-08', personRef: 'PA-0110', forceRuleCodes: ['R-101', 'R-501', 'R-301'], priceFactor: 1.3 },
    { index: 4, settlementId: 'S-000005', institutionCode: 'H003', itemCode: 'JC02', serviceDate: '2025-04-08', personRef: 'PA-0110', forceRuleCodes: ['R-301', 'R-601'] },
    { index: 5, settlementId: 'S-000006', institutionCode: 'H006', itemCode: 'JC09', serviceDate: '2025-04-15', personRef: 'PA-0133', forceRuleCodes: ['R-201', 'R-401'] },
    { index: 6, settlementId: 'S-000007', institutionCode: 'H001', itemCode: 'JC06', serviceDate: '2025-02-11', personRef: 'PA-0007', forceRuleCodes: ['R-101', 'R-401', 'R-601'], priceFactor: 1.38 },
    { index: 7, settlementId: 'S-000008', institutionCode: 'H002', itemCode: 'JC05', serviceDate: '2025-05-06', personRef: 'PA-0203', forceRuleCodes: ['R-501'] },
    { index: 8, settlementId: 'S-000009', institutionCode: 'H005', itemCode: 'JC10', serviceDate: '2025-06-03', personRef: 'PA-0177', forceRuleCodes: ['R-101', 'R-401'], priceFactor: 1.24 },
    { index: 9, settlementId: 'S-000010', institutionCode: 'H008', itemCode: 'JC07', serviceDate: '2025-06-21', personRef: 'PA-0244', forceRuleCodes: ['R-501'] },
  ];

  const rowCount = Math.max(config.rowCount, scenarioPlan.length);

  for (let index = 0; index < rowCount; index += 1) {
    const scenario = scenarioPlan[index];
    // 约 4% 的常规行沿用近期某行的“人员+日期+项目”，形成真实的同人同日重复结算。
    const echo = !scenario && recentKeys.length > 0 && rng() < 0.04 ? recentKeys[Math.floor(rng() * recentKeys.length)] : null;
    const institutionCode = scenario?.institutionCode ?? pick(rng, INSTITUTIONS).code;
    const institution = INSTITUTIONS.find((entry) => entry.code === institutionCode)!;
    const qualifiedItems = qualifiedItemsByInstitution.get(institutionCode) ?? [];
    const knownItems = knownItemsByInstitution.get(institutionCode) ?? [];
    // 机构常规开展项目优先；少数行为跨项目异常样本，用来产生真实的空档/无资质命中。
    const anomalyPick = !scenario && rng() < 0.035;
    const itemPool = qualifiedItems.length > 0 ? qualifiedItems : knownItems;
    const itemCode =
      scenario?.itemCode ??
      echo?.itemCode ??
      (anomalyPick || itemPool.length === 0
        ? pick(rng, ITEMS).code
        : itemPool[Math.floor(rng() * itemPool.length)]!);
    const item = ITEMS.find((entry) => entry.code === itemCode)!;
    const serviceDate = scenario?.serviceDate ?? echo?.serviceDate ?? addDays(start, intBetween(rng, 0, span));
    const personRef = scenario?.personRef ?? echo?.personRef ?? pick(rng, personPool);
    if (!scenario) recentKeys.push({ personRef, serviceDate, itemCode });
    if (recentKeys.length > 400) recentKeys.shift();
    const clusterKey = `${personRef}|${serviceDate}|${itemCode}`;
    const clusterCount = seenByPersonDay.get(clusterKey) ?? 0;
    seenByPersonDay.set(clusterKey, clusterCount + 1);
    const base = intBetween(rng, item.baseMinCents, item.baseMaxCents);
    const anomaly = rng() < config.anomalyRate;
    const overcharge = anomaly && rng() < 0.55;
    const paymentAmountCents = scenario?.priceFactor
      ? Math.round(item.baseMaxCents * scenario.priceFactor)
      : overcharge
        ? Math.round(base * (1.16 + rng() * 0.32))
        : Math.round(base * (0.86 + rng() * 0.2));
    const totalAmountCents = Math.round(paymentAmountCents * (1.08 + rng() * 0.24));
    const selfPayCents = Math.max(0, totalAmountCents - paymentAmountCents);
    const fundType = pick(rng, FUND_TYPES);
    const visitType = pick(rng, VISIT_TYPES);
    const rowNumber = index + 2;
    const settlementId = scenario?.settlementId ?? `S-${pad(index + 1, 6)}`;

    const rowBase = {
      id: settlementId,
      personRef,
      itemCode,
      itemName: item.name,
      poolingAreaCode: institution.areaCode,
      poolingAreaName: institution.areaName,
      institutionCode: institution.code,
      institutionName: institution.name,
      institutionLevel: institution.level,
      serviceDate,
      totalAmountCents,
      paymentAmountCents,
      selfPayCents,
      suspectedAmountCents: 0,
      fundType,
      visitType,
      sourceBatchId: BATCH_IDS.settlement,
      sourceVersion: VERSIONS.settlement,
      rowNumber,
    };

    const row: SettlementRow = {
      ...rowBase,
      suspectedAmountCents: Math.round(paymentAmountCents * (0.1 + rng() * 0.25)),
      inputDigest: digestOf(rowBase),
    };

    const snapshots = qualificationsByKey.get(`${institution.code}|${item.code}`) ?? [];
    const covering = snapshots.filter((snapshot) => coversDate(snapshot, serviceDate));
    const qualificationBroken =
      covering.length === 0 || covering.length > 1 || covering.some((snapshot) => snapshot.state !== '有效');

    const ruleCodes = new Set<string>();
    const maxCap = item.baseMaxCents * 1.15;
    for (const code of scenario?.forceRuleCodes ?? []) {
      if (code === 'R-101' && paymentAmountCents <= maxCap) continue;
      if (!ruleDefsAllow(code, item.code)) continue;
      ruleCodes.add(code);
    }
    if (paymentAmountCents > maxCap && RULE_BY_CODE.get('R-101')?.itemCodes.includes(item.code)) {
      ruleCodes.add('R-101');
    }
    if (qualificationBroken) {
      ruleCodes.add('R-201');
    }
    if (clusterCount > 0 && ruleDefsAllow('R-301', itemCode)) {
      ruleCodes.add('R-301');
    }
    if (anomaly && rng() < 0.18) {
      const candidates = RULES.filter((rule) => rule.code !== 'R-201');
      ruleCodes.add(pick(rng, candidates).code);
    }
    if (item.category === '内镜检查' && fundType === '医疗救助') ruleCodes.add('R-401');
    if (item.code === 'JC09' && visitType === '住院') ruleCodes.add('R-401');

    let sequence = 1;
    for (const ruleCode of [...ruleCodes].sort()) {
      const rule = RULE_BY_CODE.get(ruleCode);
      if (!rule) continue;
      const hintRatio = ruleCode === 'R-101' ? 0.35 : 0.12;
      const hit: RuleHit = {
        id: `H-${settlementId}-${pad(sequence)}`,
        settlementId,
        ruleCode,
        ruleName: rule.name,
        severity: rule.severity,
        clause: rule.clause,
        finding: describeFinding(rule.code, row, rng),
        confidence: Number((0.62 + rng() * 0.36).toFixed(2)),
        sequence,
        detectedAt: '2025-07-02T09:30:00+08:00',
        sourceBatchId: BATCH_IDS.hit,
        hintAmountCents: Math.round(row.paymentAmountCents * hintRatio),
      };
      hits.push(hit);
      sequence += 1;
    }

    settlementRows.push(row);
  }

  // 结论：多数行有结论，部分待结论；场景行维护固定结论，便于验收。
  const scenarioConclusion: Record<string, { code: ConclusionCode; label: string }> = {
    'S-000001': { code: '待核', label: '资质重叠，待核定责任。' },
    'S-000002': { code: '待核', label: '资质空档，待补正材料。' },
    'S-000003': { code: '违规', label: '资质已注销仍结算，拟全额追回。' },
    'S-000006': { code: '违规', label: '暂停期内开展康复评定。' },
  };

  let conclusionIndex = 1;
  let pendingLeft = Math.max(0, config.pendingConclusions);
  for (const row of settlementRows) {
    conclusionIndex += 1;
    if (pendingLeft > 0 && conclusionIndex % 17 === 0) {
      pendingLeft -= 1;
      continue;
    }
    const forced = scenarioConclusion[row.id];
    const hasHighHit = hits.some((hit) => hit.settlementId === row.id && hit.severity === '高');
    const decided: ConclusionCode = forced?.code ?? (hasHighHit ? (rng() < 0.6 ? '整改' : '违规') : rng() < 0.72 ? '合规' : '待核');
    const deductionCents =
      decided === '违规' ? Math.round(row.paymentAmountCents * (0.3 + rng() * 0.5)) : decided === '整改' ? Math.round(row.paymentAmountCents * 0.1) : 0;
    conclusions.push({
      id: `C-${row.id}`,
      settlementId: row.id,
      code: decided,
      label: forced?.label ?? conclusionLabel(decided),
      deductionCents,
      handler: pick(rng, ['王敏', '李哲', '赵雪', '陈立', '周航']),
      decidedAt: '2025-07-15',
      sourceBatchId: BATCH_IDS.conclusion,
      version: 1,
      note: decided === '合规' ? '随机抽样复核无异常。' : '依据规则命中与资质快照作出。',
    });
  }

  const batches: BatchRecord[] = [
    makeBatch(BATCH_IDS.settlement, '结算明细', 'settlement_2025H1.csv', VERSIONS.settlement, settlementRows.length, settlementRows, '生效', '脱敏后的结算行导出，含支付金额与项目信息。'),
    makeBatch(BATCH_IDS.hit, '规则命中', 'rule_hits_2025H1.csv', VERSIONS.ruleHit, hits.length, hits, '生效', '规则引擎按结算行产生的多条命中，一行可命中多条规则。'),
    makeBatch(BATCH_IDS.qualification, '资质快照', 'qualification_snapshots.csv', VERSIONS.qualification, qualifications.length, qualifications, '生效', '按服务发生日生效的机构资质快照，含重叠与空档。'),
    makeBatch(BATCH_IDS.conclusion, '处理结论', 'conclusions_2025H1.csv', VERSIONS.conclusion, conclusions.length, conclusions, '生效', '稽核处理结论，待核与待结论行未闭环。'),
    makeBatch(BATCH_IDS.dictionary, '字段字典', 'field_dictionary.csv', VERSIONS.dictionary, 24, { entries: 24 }, '生效', '字段来源表、类型与口径说明。'),
    makeBatch(BATCH_IDS.rulebook, '规则目录', 'rule_catalog.csv', 'RUL-2025.05-r4', RULES.length, RULES, '生效', '规则条款、严重程度与适用项目。'),
  ];

  const dictionary = buildDictionary();

  const meta: DatasetMeta = {
    datasetId: DATASET_ID,
    schemaVersion: SCHEMA_VERSION,
    province: '江省',
    sourceLabel: '省医保稽核样本数据（已脱敏）',
    generatedAt: '2025-07-15T10:00:00+08:00',
    seed: config.seed,
    config,
    versions: VERSIONS,
    correctionCount: 0,
  };

  return {
    meta,
    areas: AREAS,
    items: ITEMS,
    institutions: INSTITUTIONS,
    rules: RULES,
    settlements: settlementRows,
    hits,
    qualifications,
    conclusions,
    batches,
    dictionary,
  };
}

function ruleDefsAllow(code: string, itemCode: string): boolean {
  return RULE_BY_CODE.get(code)?.itemCodes.includes(itemCode) ?? false;
}

function describeFinding(code: string, row: SettlementRow, rng: () => number): string {
  switch (code) {
    case 'R-101':
      return `支付 ${(row.paymentAmountCents / 100).toFixed(2)} 元，高于项目限价加收上限。`;
    case 'R-201':
      return `服务日 ${row.serviceDate} 资质快照不足以覆盖本次 ${row.itemName}。`;
    case 'R-301':
      return `同一人员 ${row.personRef} 于 ${row.serviceDate} 出现同项目多行结算。`;
    case 'R-401':
      return `${row.fundType}／${row.visitType} 与项目支付范围不一致。`;
    case 'R-501':
      return `7 日内同项目就诊次数超过 3 次（抽样置信度 ${(0.6 + rng() * 0.35).toFixed(2)}）。`;
    case 'R-601':
      return '支付金额拆分与项目计价结构不匹配，疑似项目串换。';
    default:
      return '规则引擎命中，待复核。';
  }
}

function conclusionLabel(code: ConclusionCode): string {
  switch (code) {
    case '合规':
      return '复核通过，不予扣减。';
    case '违规':
      return '认定违规，按比例追回基金。';
    case '整改':
      return '限期整改，暂不扣减。';
    case '待核':
      return '证据待补，暂列待核。';
  }
}

function makeBatch(
  id: string,
  role: BatchRecord['role'],
  fileName: string,
  sourceVersion: string,
  rowCount: number,
  payload: unknown,
  status: BatchRecord['status'],
  note: string,
): BatchRecord {
  return {
    id,
    batchNo: id.replace(/^B-/, ''),
    role,
    fileName,
    sourceVersion,
    rowCount,
    sha256: digestOf(payload),
    importedAt: '2025-07-15T10:00:00+08:00',
    status,
    note,
  };
}

function buildDictionary(): FieldDictionaryEntry[] {
  const entries: Array<[string, string, string, boolean, string, string, string]> = [
    ['settlement_id', '结算行标识', 'string', true, '结算明细', '结算行唯一编号，一次结算对应一条。', 'S-000001'],
    ['person_ref', '人员脱敏编号', 'string', true, '结算明细', '人员主索引脱敏后的稳定编号。', 'PA-0007'],
    ['item_code', '检查项目编码', 'string', true, '结算明细', '对应检查项目目录编码。', 'JC06'],
    ['pooling_area', '统筹区', 'string', true, '结算明细', '基金统筹区编码，用于范围冻结。', '3201'],
    ['institution_code', '机构编码', 'string', true, '结算明细', '定点医疗机构编码。', 'H007'],
    ['service_date', '服务发生日', 'date', true, '结算明细', '资质快照与规则判断的时点基准。', '2025-03-12'],
    ['payment_amount', '基金支付金额（分）', 'integer', true, '结算明细', '本条结算的基金支付金额，以分存储，禁止浮点。', '56320'],
    ['total_amount', '医疗总费用（分）', 'integer', true, '结算明细', '含个人自付与基金支付。', '70900'],
    ['suspected_amount', '疑似金额（分）', 'integer', false, '结算明细', '规则提示的疑似金额，仅用于排序，不参与汇总。', '19712'],
    ['fund_type', '险种', 'enum', true, '结算明细', '职工医保／城乡居民／大病保险／医疗救助。', '职工医保'],
    ['visit_type', '就诊类型', 'enum', true, '结算明细', '住院／门诊／门诊慢特病／日间手术。', '门诊'],
    ['source_batch', '来源批次', 'string', true, '结算明细', '来源文件批次号，用于回查与更正比对。', 'B-SET-2025H1'],
    ['input_digest', '行摘要', 'string', true, '结算明细', '结算行核心字段的 SHA-256 摘要。', '9f2c…'],
    ['rule_code', '规则编码', 'string', true, '规则命中', '规则库编码，如 R-101。', 'R-101'],
    ['rule_clause', '规则条款', 'string', true, '规则命中', '命中时生效的条款原文。', '第 12 条'],
    ['rule_severity', '严重程度', 'enum', true, '规则命中', '高／中／低。', '高'],
    ['hit_hint_amount', '命中提示金额（分）', 'integer', false, '规则命中', '仅解释单条命中，不进入任何汇总，避免重复计额。', '19712'],
    ['qualification_id', '资质快照标识', 'string', true, '资质快照', '机构×检查项目的版本化资质记录。', 'Q-H007-JC06-02'],
    ['cert_no', '资质证书号', 'string', true, '资质快照', '备案或执业许可证编号。', 'YLZZ-H007-JC06-02'],
    ['valid_from', '资质生效日', 'date', true, '资质快照', '资质区间起日（含）。', '2025-03-01'],
    ['valid_to', '资质失效日', 'date', false, '资质快照', '资质区间止日（含）；空表示长期有效。', '2025-03-31'],
    ['qualification_state', '资质状态', 'enum', true, '资质快照', '有效／暂停／注销，按快照版本记录。', '有效'],
    ['conclusion_code', '结论类型', 'enum', true, '处理结论', '合规／违规／整改／待核。', '违规'],
    ['deduction_amount', '追回金额（分）', 'integer', false, '处理结论', '按结论计算的追回金额，不摊入结算行。', '22528'],
  ];
  return entries.map(([code, label, dataType, required, sourceTable, description, example]) => ({
    code,
    label,
    dataType,
    required,
    sourceTable,
    description,
    example,
    version: VERSIONS.dictionary,
  }));
}

/** 更正场景：结论批次更正，返回新结论与受影响的结算行。 */
export function buildConclusionCorrection(dataset: Dataset): {
  conclusions: Conclusion[];
  affectedSettlementIds: string[];
  batch: BatchRecord;
  sourceVersion: string;
} {
  const targets = dataset.settlements.filter((row) =>
    ['S-000004', 'S-000006', 'S-000008'].includes(row.id),
  );
  const affectedSettlementIds = targets.map((row) => row.id);
  const revised: Conclusion[] = targets.map((row, index) => {
    const previous = dataset.conclusions.find((item) => item.settlementId === row.id);
    return {
      id: `C-${row.id}-R1`,
      settlementId: row.id,
      code: index === 1 ? '违规' : '整改',
      label: index === 1 ? '复核补充病历后认定违规，追回基金。' : '补充说明后调整为限期整改。',
      deductionCents: index === 1 ? Math.round(row.paymentAmountCents * 0.45) : Math.round(row.paymentAmountCents * 0.12),
      handler: previous?.handler ?? '王敏',
      decidedAt: '2025-08-06',
      sourceBatchId: CORRECTION_BATCHES.conclusion,
      version: (previous?.version ?? 1) + 1,
      note: '来源结论批次更正：原结论保留在历史批次，不覆盖。',
    };
  });
  const sourceVersion = 'CON-2025.08.06-c1';
  const batch: BatchRecord = {
    id: CORRECTION_BATCHES.conclusion,
    batchNo: CORRECTION_BATCHES.conclusion.replace(/^B-/, ''),
    role: '更正批次',
    fileName: 'conclusion_correction_20250806.csv',
    sourceVersion,
    rowCount: revised.length,
    sha256: digestOf(revised),
    importedAt: '2025-08-06T14:20:00+08:00',
    status: '更正批次',
    note: `更正处理结论 ${revised.length} 条，影响结算行 ${affectedSettlementIds.join('、')}。`,
  };
  return { conclusions: revised, affectedSettlementIds, batch, sourceVersion };
}

/** 更正场景：资质批次补正，新增快照并声明取代旧版，解决 H005 空档与 H007 重叠。 */
export function buildQualificationCorrection(dataset: Dataset): {
  qualifications: QualificationSnapshot[];
  affectedSettlementIds: string[];
  batch: BatchRecord;
  sourceVersion: string;
} {
  const corrections: QualificationSnapshot[] = [
    makeSnapshot({
      id: 'Q-H007-JC06-C1',
      institutionCode: 'H007',
      checkItemCode: 'JC06',
      validFrom: '2025-02-01',
      validTo: '2025-04-30',
      state: '有效',
      revision: 3,
      revisedAt: '2025-08-06',
      note: '更正：撤销重复备案，保留单一生效区间。',
      sourceBatchId: CORRECTION_BATCHES.qualification,
      supersedes: ['Q-H007-JC06-01', 'Q-H007-JC06-02'],
    }),
    makeSnapshot({
      id: 'Q-H005-JC08-C1',
      institutionCode: 'H005',
      checkItemCode: 'JC08',
      validFrom: '2025-03-01',
      validTo: '2025-03-31',
      state: '有效',
      revision: 3,
      revisedAt: '2025-08-06',
      note: '更正：补录 2025-03 期间资质，覆盖服务日空档。',
      sourceBatchId: CORRECTION_BATCHES.qualification,
      supersedes: [],
    }),
  ];

  const affected = dataset.settlements.filter((row) => {
    if (row.institutionCode === 'H007' && row.itemCode === 'JC06') return true;
    if (row.institutionCode === 'H005' && row.itemCode === 'JC08' && row.serviceDate >= '2025-03-01' && row.serviceDate <= '2025-03-31') return true;
    return false;
  });

  const sourceVersion = 'QUA-2025.08.06-c1';
  const batch: BatchRecord = {
    id: CORRECTION_BATCHES.qualification,
    batchNo: CORRECTION_BATCHES.qualification.replace(/^B-/, ''),
    role: '更正批次',
    fileName: 'qualification_correction_20250806.csv',
    sourceVersion,
    rowCount: corrections.length,
    sha256: digestOf(corrections),
    importedAt: '2025-08-06T14:35:00+08:00',
    status: '更正批次',
    note: `资质补正 ${corrections.length} 条，影响结算行 ${affected.map((row) => row.id).join('、')}。`,
  };

  return {
    qualifications: corrections,
    affectedSettlementIds: affected.map((row) => row.id),
    batch,
    sourceVersion,
  };
}

export function reviewStateOf(
  qualificationStatus: string,
  conclusionCode: ConclusionCode | null,
): ReviewState {
  if (qualificationStatus === 'gap' || qualificationStatus === 'overlap') return '待核';
  if (!conclusionCode || conclusionCode === '待核') return '待结论';
  return '已复核';
}
