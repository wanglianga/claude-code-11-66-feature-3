import type { BatchRecord } from '../types/domain';
import type {
  CatalogCorrection,
  CatalogEntry,
  CatalogVersion,
  CodeMapping,
  NationalCategory,
  StatSettlementRow,
  StatsState,
} from '../types/stats';
import { digestOf } from './hash';

/**
 * 医保服务项目代码沿革样例库。
 *
 * 覆盖题目要求的全部沿革形态：
 * - 更名：CS100 仅规范名称，代码与内涵不变（MAP-01）
 * - 等价替换：MR550 停用、MR551 同义替换（MAP-02）
 * - 一对多拆分（有分摊依据）：ZL700 → ZL701/702/703，权重 0.5/0.3/0.2（MAP-03）
 * - 一对多拆分（无分摊依据）：ZH600 → ZH601/ZH602，候选跨上级类别（MAP-04）
 * - 合并：XL101 + XL102 → XL100（MAP-05）
 * - 代码复用：A100 在 2023 版为「红外线治疗」，2025 版重新赋义为「中医定向透药治疗」
 * - 无依据映射：QT500 → QT501 证据缺失（MAP-06，更正批次补证据后生效）
 * - 停用无后继：XT500 2025 年起调出目录，无映射
 * - 目录外代码：TP999 从未收录
 */

export const STATS_SCHEMA_VERSION = '1.0.0';
export const CURRENT_CATALOG_ID = 'CAT-2025';
export const STATS_SEED = 20250915;

export const NATIONAL_CATEGORIES: NationalCategory[] = [
  { code: '10', name: '检查检验', level: 1, parentCode: null },
  { code: '1001', name: '影像检查', level: 2, parentCode: '10' },
  { code: '100101', name: 'X线摄影', level: 3, parentCode: '1001' },
  { code: '100102', name: 'CT检查', level: 3, parentCode: '1001' },
  { code: '100103', name: '磁共振检查', level: 3, parentCode: '1001' },
  { code: '100104', name: '超声检查', level: 3, parentCode: '1001' },
  { code: '1002', name: '内镜检查', level: 2, parentCode: '10' },
  { code: '100201', name: '消化道内镜', level: 3, parentCode: '1002' },
  { code: '1003', name: '心电与功能检查', level: 2, parentCode: '10' },
  { code: '100301', name: '心电检查', level: 3, parentCode: '1003' },
  { code: '100302', name: '脑电与脑功能检查', level: 3, parentCode: '1003' },
  { code: '20', name: '治疗', level: 1, parentCode: null },
  { code: '2001', name: '物理治疗', level: 2, parentCode: '20' },
  { code: '200101', name: '光疗与热疗', level: 3, parentCode: '2001' },
  { code: '200102', name: '电疗与磁疗', level: 3, parentCode: '2001' },
  { code: '2002', name: '康复治疗', level: 2, parentCode: '20' },
  { code: '200201', name: '运动康复', level: 3, parentCode: '2002' },
  { code: '200202', name: '作业与言语康复', level: 3, parentCode: '2002' },
  { code: '30', name: '中医及民族医', level: 1, parentCode: null },
  { code: '3001', name: '中医治疗', level: 2, parentCode: '30' },
  { code: '300101', name: '中医外治', level: 3, parentCode: '3001' },
];

const CATEGORY_BY_CODE = new Map(NATIONAL_CATEGORIES.map((category) => [category.code, category]));

export function categoryOf(code: string): NationalCategory {
  const found = CATEGORY_BY_CODE.get(code);
  if (!found) throw new Error(`未知国家项目类别：${code}`);
  return found;
}

/** 上级（二级）类别：两种可比口径中「共同稳定上级」的汇总层级。 */
export function level2Ancestor(code: string): NationalCategory {
  let current = categoryOf(code);
  while (current.level > 2 && current.parentCode) {
    current = categoryOf(current.parentCode);
  }
  return current;
}

export function categoryPath(code: string): NationalCategory[] {
  const path: NationalCategory[] = [];
  let current: NationalCategory | null = categoryOf(code);
  while (current) {
    path.unshift(current);
    current = current.parentCode ? categoryOf(current.parentCode) : null;
  }
  return path;
}

export function categoryLabel(code: string): string {
  const category = CATEGORY_BY_CODE.get(code);
  return category ? `${category.code} ${category.name}` : code;
}

export const CATALOG_VERSIONS: CatalogVersion[] = [
  {
    id: 'CAT-2023',
    label: '江省医疗服务项目目录（2023 版）',
    effectiveFrom: '2023-01-01',
    effectiveTo: '2023-12-31',
    issuedAt: '2022-12-15',
    note: '江医保发〔2022〕90 号发布，2023 年度执行。',
  },
  {
    id: 'CAT-2024',
    label: '江省医疗服务项目目录（2024 版）',
    effectiveFrom: '2024-01-01',
    effectiveTo: '2024-12-31',
    issuedAt: '2023-12-20',
    note: '江医保发〔2023〕48 号发布：规范部分项目名称，合并心电图项目。',
  },
  {
    id: 'CAT-2025',
    label: '江省医疗服务项目目录（2025 版，现行）',
    effectiveFrom: '2025-01-01',
    effectiveTo: null,
    issuedAt: '2024-12-18',
    note: '江医保发〔2024〕112 号发布：磁共振换码、康复与中西医结合项目拆分、A100 重新赋义。',
  },
];

function entry(
  catalogVersionId: string,
  localCode: string,
  itemName: string,
  nationalCategoryCode: string,
  definition: string,
  validFrom: string,
  validTo: string | null,
  status: '现行' | '停用',
  note = '',
): CatalogEntry {
  return {
    id: `E-${catalogVersionId.slice(4)}-${localCode}`,
    catalogVersionId,
    localCode,
    itemName,
    nationalCategoryCode,
    definition,
    validFrom,
    validTo,
    status,
    note,
  };
}

/**
 * 初始目录条目（更正前状态）。
 * 注意：XL100 在 2024 / 2025 版初始被误录为 100302（脑电与脑功能检查），
 * 由更正批次 B-CAT-C1 修正为 100301（心电检查），用于演示「目录更正只重建涉及范围」。
 */
export function buildCatalogEntries(): CatalogEntry[] {
  return [
    // ---- CAT-2023 ----
    entry('CAT-2023', 'CT280', 'CT 平扫', '100102', 'X 线计算机体层平扫，单部位。', '2023-01-01', '2023-12-31', '停用', '跨版沿用，释义不变。'),
    entry('CAT-2023', 'CS100', '彩色多普勒超声检查', '100104', '彩色多普勒超声常规部位检查。', '2023-01-01', '2023-12-31', '停用', '2024 版起规范名称。'),
    entry('CAT-2023', 'MR550', '磁共振平扫', '100103', '磁共振平扫，单部位，不含增强。', '2023-01-01', '2023-12-31', '停用', '2025 版起等价换码 MR551。'),
    entry('CAT-2023', 'ZL700', '综合康复治疗', '200201', '综合运动、作业与言语训练的打包康复项目。', '2023-01-01', '2023-12-31', '停用', '2025 版拆分为三个单项。'),
    entry('CAT-2023', 'ZH600', '中西医结合综合治疗', '300101', '中医与物理疗法联合的综合治疗项目。', '2023-01-01', '2023-12-31', '停用', '2025 版拆分，分摊依据缺失。'),
    entry('CAT-2023', 'XL101', '静息心电图检查', '100301', '十二导联静息心电图。', '2023-01-01', '2023-12-31', '停用', '2024 版与 XL102 合并为 XL100。'),
    entry('CAT-2023', 'XL102', '负荷心电图检查', '100301', '运动负荷心电图试验。', '2023-01-01', '2023-12-31', '停用', '2024 版与 XL101 合并为 XL100。'),
    entry('CAT-2023', 'A100', '红外线治疗', '200101', '红外线照射治疗，每次。', '2023-01-01', '2023-12-31', '停用', '2024 年起停用；2025 版该代码被重新赋义，不得按新义回填。'),
    entry('CAT-2023', 'XT500', '石蜡疗法', '200101', '石蜡热敷治疗，每部位。', '2023-01-01', '2023-12-31', '停用', '2025 版调出目录，无后继映射。'),
    entry('CAT-2023', 'QT500', '经颅磁刺激治疗', '200102', '重复经颅磁刺激治疗，每疗程次。', '2023-01-01', '2023-12-31', '停用', '2025 版换码 QT501，对照证据待补。'),
    // ---- CAT-2024 ----
    entry('CAT-2024', 'CT280', 'CT 平扫', '100102', 'X 线计算机体层平扫，单部位。', '2024-01-01', '2024-12-31', '停用', '跨版沿用，释义不变。'),
    entry('CAT-2024', 'CS100', '彩色多普勒超声常规检查', '100104', '彩色多普勒超声常规部位检查（规范名称）。', '2024-01-01', '2024-12-31', '停用', '更名：仅规范名称，内涵不变。'),
    entry('CAT-2024', 'MR550', '磁共振平扫', '100103', '磁共振平扫，单部位，不含增强。', '2024-01-01', '2024-12-31', '停用', '2025 版起等价换码 MR551。'),
    entry('CAT-2024', 'ZL700', '综合康复治疗', '200201', '综合运动、作业与言语训练的打包康复项目。', '2024-01-01', '2024-12-31', '停用', '2025 版拆分为三个单项。'),
    entry('CAT-2024', 'ZH600', '中西医结合综合治疗', '300101', '中医与物理疗法联合的综合治疗项目。', '2024-01-01', '2024-12-31', '停用', '2025 版拆分，分摊依据缺失。'),
    entry('CAT-2024', 'XL100', '心电图检查（含静息与负荷）', '100302', '静息与负荷心电图检查合并项目。', '2024-01-01', '2024-12-31', '停用', '类别误录为脑电与脑功能检查，待更正（B-CAT-C1 修正为 100301）。'),
    entry('CAT-2024', 'XT500', '石蜡疗法', '200101', '石蜡热敷治疗，每部位。', '2024-01-01', '2024-12-31', '停用', '2025 版调出目录，无后继映射。'),
    entry('CAT-2024', 'QT500', '经颅磁刺激治疗', '200102', '重复经颅磁刺激治疗，每疗程次。', '2024-01-01', '2024-12-31', '停用', '2025 版换码 QT501，对照证据待补。'),
    // ---- CAT-2025（现行） ----
    entry('CAT-2025', 'CT280', 'CT 平扫', '100102', 'X 线计算机体层平扫，单部位。', '2025-01-01', null, '现行', '跨版沿用，释义不变。'),
    entry('CAT-2025', 'CS100', '彩色多普勒超声常规检查', '100104', '彩色多普勒超声常规部位检查（规范名称）。', '2025-01-01', null, '现行', '沿用 2024 版规范名称。'),
    entry('CAT-2025', 'MR551', '磁共振平扫（单部位）', '100103', '磁共振平扫，单部位，不含增强。', '2025-01-01', null, '现行', '等价替换 MR550。'),
    entry('CAT-2025', 'ZL701', '运动疗法', '200201', '器械与徒手运动训练，每次。', '2025-01-01', null, '现行', 'ZL700 拆分单项之一。'),
    entry('CAT-2025', 'ZL702', '作业疗法', '200202', '作业治疗训练，每次。', '2025-01-01', null, '现行', 'ZL700 拆分单项之一。'),
    entry('CAT-2025', 'ZL703', '言语训练', '200202', '言语功能障碍训练，每次。', '2025-01-01', null, '现行', 'ZL700 拆分单项之一。'),
    entry('CAT-2025', 'ZH601', '中医综合治疗', '300101', '中医外治综合项目，每次。', '2025-01-01', null, '现行', 'ZH600 拆分单项之一。'),
    entry('CAT-2025', 'ZH602', '物理综合治疗', '200102', '物理因子综合治疗，每次。', '2025-01-01', null, '现行', 'ZH600 拆分单项之一。'),
    entry('CAT-2025', 'XL100', '心电图检查（含静息与负荷）', '100302', '静息与负荷心电图检查合并项目。', '2025-01-01', null, '现行', '类别误录为脑电与脑功能检查，待更正（B-CAT-C1 修正为 100301）。'),
    entry('CAT-2025', 'A100', '中医定向透药治疗', '300101', '中医定向透药治疗，每部位。', '2025-01-01', null, '现行', '代码复用：与 2023 版「红外线治疗」为不同项目，按服务日分段。'),
    entry('CAT-2025', 'QT501', '经颅磁刺激治疗', '200102', '重复经颅磁刺激治疗，每疗程次。', '2025-01-01', null, '现行', '替换 QT500；对照证据见 MAP-06。'),
  ];
}

/** 初始映射关系（更正前状态）：MAP-06 证据缺失，不用于金额分配。 */
export function buildMappings(): CodeMapping[] {
  return [
    {
      id: 'MAP-01',
      kind: '更名',
      fromCatalogId: 'CAT-2023',
      toCatalogId: 'CAT-2024',
      fromCodes: ['CS100'],
      toCodes: ['CS100'],
      effectiveDate: '2024-01-01',
      evidenceSource: '江医保发〔2023〕48 号《关于规范部分医疗服务项目名称的通知》第 3 条',
      evidenceStatus: '齐全',
      allocationBasis: '',
      weights: null,
      note: '仅规范项目名称，代码与内涵不变，统计上视为连续。',
    },
    {
      id: 'MAP-02',
      kind: '等价替换',
      fromCatalogId: 'CAT-2024',
      toCatalogId: 'CAT-2025',
      fromCodes: ['MR550'],
      toCodes: ['MR551'],
      effectiveDate: '2025-01-01',
      evidenceSource: '江医保发〔2024〕112 号附件 2《停用与替换代码对照表》',
      evidenceStatus: '齐全',
      allocationBasis: '',
      weights: null,
      note: 'MR550 停用，MR551 内涵完全一致（一对一）。',
    },
    {
      id: 'MAP-03',
      kind: '拆分',
      fromCatalogId: 'CAT-2024',
      toCatalogId: 'CAT-2025',
      fromCodes: ['ZL700'],
      toCodes: ['ZL701', 'ZL702', 'ZL703'],
      effectiveDate: '2025-01-01',
      evidenceSource: '江医保发〔2024〕112 号附件 3《拆分项目对照表》',
      evidenceStatus: '齐全',
      allocationBasis: '按《省属医院 2024 年康复项目用量调查》结构分摊：运动 0.5 / 作业 0.3 / 言语 0.2',
      weights: { ZL701: 0.5, ZL702: 0.3, ZL703: 0.2 },
      note: '一对多拆分：候选与权重仅供审核参考，未审核前不得当作已分配金额。',
    },
    {
      id: 'MAP-04',
      kind: '拆分',
      fromCatalogId: 'CAT-2024',
      toCatalogId: 'CAT-2025',
      fromCodes: ['ZH600'],
      toCodes: ['ZH601', 'ZH602'],
      effectiveDate: '2025-01-01',
      evidenceSource: '江医保发〔2024〕112 号附件 3《拆分项目对照表》',
      evidenceStatus: '齐全',
      allocationBasis: '',
      weights: null,
      note: '拆分事实有据，但无患者级/项目级转换依据：金额保留在歧义池，不复制给多个新类。',
    },
    {
      id: 'MAP-05',
      kind: '合并',
      fromCatalogId: 'CAT-2023',
      toCatalogId: 'CAT-2024',
      fromCodes: ['XL101', 'XL102'],
      toCodes: ['XL100'],
      effectiveDate: '2024-01-01',
      evidenceSource: '江医保发〔2023〕48 号附件 1《项目合并对照表》',
      evidenceStatus: '齐全',
      allocationBasis: '',
      weights: null,
      note: '多对一合并：静息与负荷心电图合并为 XL100，目标唯一。',
    },
    {
      id: 'MAP-06',
      kind: '等价替换',
      fromCatalogId: 'CAT-2024',
      toCatalogId: 'CAT-2025',
      fromCodes: ['QT500'],
      toCodes: ['QT501'],
      effectiveDate: '2025-01-01',
      evidenceSource: '',
      evidenceStatus: '缺失',
      allocationBasis: '',
      weights: null,
      note: '对照关系由系统初筛生成，正式文件待补；证据补齐前不参与金额分配。',
    },
  ];
}

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

interface CodePlan {
  code: string;
  name: string;
  baseCents: number;
  /** 该代码在各年度生效的月份数（2025 年为上半年）。 */
  years: number[];
}

const CODE_PLANS: CodePlan[] = [
  { code: 'CT280', name: 'CT 平扫', baseCents: 32000, years: [2023, 2024, 2025] },
  { code: 'CS100', name: '彩色多普勒超声检查', baseCents: 16000, years: [2023] },
  { code: 'CS100', name: '彩色多普勒超声常规检查', baseCents: 16000, years: [2024, 2025] },
  { code: 'MR550', name: '磁共振平扫', baseCents: 54000, years: [2023, 2024] },
  { code: 'MR551', name: '磁共振平扫（单部位）', baseCents: 54000, years: [2025] },
  { code: 'ZL700', name: '综合康复治疗', baseCents: 13000, years: [2023, 2024] },
  { code: 'ZL701', name: '运动疗法', baseCents: 7500, years: [2025] },
  { code: 'ZL702', name: '作业疗法', baseCents: 6200, years: [2025] },
  { code: 'ZL703', name: '言语训练', baseCents: 4800, years: [2025] },
  { code: 'ZH600', name: '中西医结合综合治疗', baseCents: 15500, years: [2023, 2024] },
  { code: 'ZH601', name: '中医综合治疗', baseCents: 9200, years: [2025] },
  { code: 'ZH602', name: '物理综合治疗', baseCents: 7100, years: [2025] },
  { code: 'XL101', name: '静息心电图检查', baseCents: 5800, years: [2023] },
  { code: 'XL102', name: '负荷心电图检查', baseCents: 8800, years: [2023] },
  { code: 'XL100', name: '心电图检查（含静息与负荷）', baseCents: 6900, years: [2024, 2025] },
  { code: 'A100', name: '红外线治疗', baseCents: 4200, years: [2023] },
  { code: 'A100', name: '中医定向透药治疗', baseCents: 6600, years: [2025] },
  { code: 'XT500', name: '石蜡疗法', baseCents: 3200, years: [2023, 2024] },
  { code: 'QT500', name: '经颅磁刺激治疗', baseCents: 21500, years: [2023, 2024] },
  { code: 'QT501', name: '经颅磁刺激治疗', baseCents: 21500, years: [2025] },
];

export const STAT_BATCH_IDS = {
  2023: 'B-STAT-2023',
  2024: 'B-STAT-2024',
  2025: 'B-STAT-2025',
} as Record<number, string>;

export const CORRECTION_BATCH_ID = 'B-CAT-C1';

/** 确定性生成跨年度结算提取行（2023-01 至 2025-06）。 */
export function generateStatRows(seed: number = STATS_SEED): StatSettlementRow[] {
  const rng = mulberry32(seed);
  const rows: StatSettlementRow[] = [];
  const sequences: Record<number, number> = { 2023: 0, 2024: 0, 2025: 0 };

  const push = (year: number, month: number, code: string, name: string, baseCents: number) => {
    sequences[year] += 1;
    const day = 1 + Math.floor(rng() * 28);
    rows.push({
      id: `T-${year}-${pad(sequences[year], 4)}`,
      serviceDate: `${year}-${pad(month)}-${pad(day)}`,
      year,
      localCode: code,
      itemName: name,
      amountCents: Math.round(baseCents * (0.85 + rng() * 0.35)),
      sourceBatchId: STAT_BATCH_IDS[year],
    });
  };

  for (const plan of CODE_PLANS) {
    for (const year of plan.years) {
      const months = year === 2025 ? 6 : 12;
      for (let month = 1; month <= months; month += 1) {
        const count = 1 + Math.floor(rng() * 2);
        for (let index = 0; index < count; index += 1) {
          push(year, month, plan.code, plan.name, plan.baseCents);
        }
      }
    }
  }

  // 目录外代码：TP999 从未收录，各年度零星出现。
  for (const [year, month] of [
    [2023, 4],
    [2023, 10],
    [2024, 3],
    [2024, 9],
    [2025, 2],
  ] as const) {
    push(year, month, 'TP999', '穴位贴敷治疗（目录外）', 4600);
  }
  // 停用后仍结算：XT500 于 2025 年调出目录后仍出现两笔（服务日无有效目录条目）。
  push(2025, 2, 'XT500', '石蜡疗法', 3200);
  push(2025, 5, 'XT500', '石蜡疗法', 3200);

  return rows.sort((a, b) => a.id.localeCompare(b.id));
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
  importedAt = '2025-07-20T09:00:00+08:00',
): BatchRecord {
  return {
    id,
    batchNo: id.replace(/^B-/, ''),
    role,
    fileName,
    sourceVersion,
    rowCount,
    sha256: digestOf(payload),
    importedAt,
    status,
    note,
  };
}

/** 组装统计模块初始状态（目录 + 映射 + 结算提取 + 批次）。 */
export function buildStatsState(seed: number = STATS_SEED): StatsState {
  const entries = buildCatalogEntries();
  const mappings = buildMappings();
  const rows = generateStatRows(seed);
  const batches: BatchRecord[] = [
    ...CATALOG_VERSIONS.map((catalog, index) =>
      makeBatch(
        `B-CAT-${catalog.id.slice(4)}`,
        '目录版本',
        `catalog_${catalog.id.slice(4)}.csv`,
        `${catalog.id}-r1`,
        entries.filter((item) => item.catalogVersionId === catalog.id).length,
        entries.filter((item) => item.catalogVersionId === catalog.id),
        '生效',
        `${catalog.label}，${catalog.issuedAt} 发布。`,
        `202${3 + index}-01-05T09:00:00+08:00`,
      ),
    ),
    makeBatch('B-MAP-2024', '映射批次', 'mapping_2024.csv', 'MAP-2024-r1', 2, mappings.filter((item) => item.toCatalogId === 'CAT-2024'), '生效', '2023→2024 版对照：更名与合并。', '2023-12-25T09:00:00+08:00'),
    makeBatch('B-MAP-2025', '映射批次', 'mapping_2025.csv', 'MAP-2025-r1', 4, mappings.filter((item) => item.toCatalogId === 'CAT-2025'), '生效', '2024→2025 版对照：等价替换、拆分与待补证据对照。', '2024-12-22T09:00:00+08:00'),
    ...([2023, 2024, 2025] as const).map((year) =>
      makeBatch(
        STAT_BATCH_IDS[year],
        '结算明细',
        `stat_extract_${year}.csv`,
        `STAT-${year}-r1`,
        rows.filter((row) => row.year === year).length,
        rows.filter((row) => row.year === year),
        '生效',
        `${year} 年度结算提取（脱敏），含服务日期与地方项目编码。`,
        '2025-07-20T09:00:00+08:00',
      ),
    ),
  ];
  return {
    catalogs: CATALOG_VERSIONS,
    entries,
    mappings,
    rows,
    batches,
    correctionsApplied: [],
  };
}

/**
 * 目录更正批次 B-CAT-C1：
 * 1. MAP-06（QT500→QT501）补录正式证据文件，证据状态转为「齐全」；
 * 2. XL100 在 2024 / 2025 版的国家类别由误录的 100302 修正为 100301。
 * 只声明受影响代码，重建时仅这些代码与对应期间的统计被重算。
 */
export function buildCatalogCorrection(state: StatsState): CatalogCorrection {
  const fixedMapping: CodeMapping = {
    ...state.mappings.find((mapping) => mapping.id === 'MAP-06')!,
    evidenceSource: '江医保办发〔2025〕36 号《经颅磁刺激治疗项目代码对照确认函》',
    evidenceStatus: '齐全',
    note: '补录正式文件：QT500→QT501 等价替换关系确认，可追溯至本批次。',
  };
  const fixedEntries = state.entries
    .filter((item) => item.localCode === 'XL100')
    .map((item) => ({
      ...item,
      nationalCategoryCode: '100301',
      note: '类别更正：心电图检查归入心电检查 100301（原误录 100302），由 B-CAT-C1 修正。',
    }));
  const affectedCodes = ['QT500', 'QT501', 'XL100', 'XL101', 'XL102'];
  const batch = makeBatch(
    CORRECTION_BATCH_ID,
    '更正批次',
    'catalog_correction_20250820.csv',
    'CAT-2025.08.20-c1',
    fixedEntries.length + 1,
    { entries: fixedEntries, mappings: [fixedMapping] },
    '更正批次',
    `补录 MAP-06 证据并更正 XL100 国家类别；涉及代码：${affectedCodes.join('、')}。`,
    '2025-08-20T10:30:00+08:00',
  );
  return {
    batch,
    entries: fixedEntries,
    mappings: [fixedMapping],
    affectedCodes,
    note: '补录 QT500→QT501 对照证据；XL100 国家类别 100302→100301。',
  };
}

/** 应用目录更正：按 id  upsert 条目与映射，追加更正批次；旧统计版本不受影响。 */
export function applyCatalogCorrection(state: StatsState, correction: CatalogCorrection): StatsState {
  const entryMap = new Map(state.entries.map((item) => [item.id, item]));
  for (const item of correction.entries) entryMap.set(item.id, item);
  const mappingMap = new Map(state.mappings.map((item) => [item.id, item]));
  for (const item of correction.mappings) mappingMap.set(item.id, item);
  return {
    ...state,
    entries: [...entryMap.values()],
    mappings: [...mappingMap.values()],
    batches: [...state.batches, correction.batch],
    correctionsApplied: [...state.correctionsApplied, correction.batch.id],
  };
}
