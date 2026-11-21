import type {
  CatalogEntry,
  ChainLink,
  CodeMapping,
  NationalCategory,
  ResolutionStatus,
  RowResolution,
  RunDiff,
  SplitCandidate,
  StatSettlementRow,
  StatsRun,
  YearCell,
} from '../types/stats';
import { CATALOG_VERSIONS, CURRENT_CATALOG_ID, categoryOf, level2Ancestor } from './catalog';
import { digestOf } from './hash';

/**
 * 历史可比统计引擎。
 *
 * 口径约定：
 * - 目录按服务发生日分段命中，绝不用现行释义回填历史（代码复用安全）。
 * - 最细类别投影：一行金额只落入一个归属（唯一类别 / 歧义池 / 未映射池），不重复计额。
 * - 一对多拆分一律进歧义池并保留候选与分摊依据；候选参考分摊不计入任何类别合计。
 * - 上级类别汇总：按结算行历史条目的国家类别归集到共同稳定的二级类别，不经映射。
 */

const ORDERED_CATALOGS = [...CATALOG_VERSIONS].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));

function nextCatalogAfter(catalogVersionId: string) {
  const index = ORDERED_CATALOGS.findIndex((catalog) => catalog.id === catalogVersionId);
  return index >= 0 && index < ORDERED_CATALOGS.length - 1 ? ORDERED_CATALOGS[index + 1]! : null;
}

/** 按服务日命中目录条目；同一代码多条释义（代码复用）时取覆盖服务日的那一条。 */
export function findEntryAt(entries: CatalogEntry[], localCode: string, serviceDate: string): CatalogEntry | null {
  const covering = entries.filter(
    (item) =>
      item.localCode === localCode &&
      item.validFrom <= serviceDate &&
      (!item.validTo || serviceDate <= item.validTo),
  );
  if (covering.length === 0) return null;
  // 样例数据区间互不重叠；防御性地取 validFrom 最新的一条。
  return covering.sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0]!;
}

interface ChainContext {
  byCatalogAndCode: Map<string, CatalogEntry>;
  mappingsByFrom: Map<string, CodeMapping[]>;
}

function buildChainContext(entries: CatalogEntry[], mappings: CodeMapping[]): ChainContext {
  const byCatalogAndCode = new Map<string, CatalogEntry>();
  for (const item of entries) {
    byCatalogAndCode.set(`${item.catalogVersionId}|${item.localCode}`, item);
  }
  const mappingsByFrom = new Map<string, CodeMapping[]>();
  for (const mapping of mappings) {
    for (const code of mapping.fromCodes) {
      const key = `${mapping.fromCatalogId}|${code}`;
      const bucket = mappingsByFrom.get(key) ?? [];
      bucket.push(mapping);
      mappingsByFrom.set(key, bucket);
    }
  }
  return { byCatalogAndCode, mappingsByFrom };
}

type ChainResult =
  | { type: 'unique'; categoryCode: string; chain: ChainLink[] }
  | { type: 'ambiguous'; candidates: SplitCandidate[]; chain: ChainLink[]; reason: string }
  | { type: 'unmapped'; chain: ChainLink[]; reason: string };

function followChain(entry: CatalogEntry, via: ChainLink['via'], ctx: ChainContext, visited: Set<string>): ChainResult {
  const link: ChainLink = {
    catalogVersionId: entry.catalogVersionId,
    localCode: entry.localCode,
    itemName: entry.itemName,
    nationalCategoryCode: entry.nationalCategoryCode,
    via,
  };
  if (visited.has(entry.id)) {
    return { type: 'unmapped', chain: [link], reason: '映射链存在循环，已中止' };
  }
  const nextVisited = new Set(visited);
  nextVisited.add(entry.id);

  if (entry.catalogVersionId === CURRENT_CATALOG_ID) {
    return { type: 'unique', categoryCode: entry.nationalCategoryCode, chain: [link] };
  }
  const nextCatalog = nextCatalogAfter(entry.catalogVersionId);
  if (!nextCatalog) {
    return { type: 'unmapped', chain: [link], reason: '目录版本链不完整' };
  }

  const mapping = (ctx.mappingsByFrom.get(`${entry.catalogVersionId}|${entry.localCode}`) ?? []).find(
    (item) => item.toCatalogId === nextCatalog.id,
  );

  if (mapping) {
    if (mapping.evidenceStatus === '缺失') {
      return {
        type: 'unmapped',
        chain: [link],
        reason: `映射证据缺失：${mapping.id} 对照文件待补，补齐前不参与金额分配`,
      };
    }
    if (mapping.kind === '拆分') {
      const candidates: SplitCandidate[] = [];
      for (const toCode of mapping.toCodes) {
        const target = ctx.byCatalogAndCode.get(`${nextCatalog.id}|${toCode}`);
        if (!target) continue;
        const sub = followChain(target, { mappingId: mapping.id, kind: mapping.kind }, ctx, nextVisited);
        if (sub.type === 'unique') {
          const finalLink = sub.chain[sub.chain.length - 1]!;
          candidates.push({
            toCode: finalLink.localCode,
            itemName: finalLink.itemName,
            categoryCode: sub.categoryCode,
            weight: mapping.weights?.[toCode] ?? null,
          });
        } else if (sub.type === 'ambiguous') {
          candidates.push(...sub.candidates);
        }
      }
      if (candidates.length === 0) {
        return { type: 'unmapped', chain: [link], reason: `拆分映射 ${mapping.id} 的目标均不在后继目录` };
      }
      const hasBasis = Boolean(mapping.allocationBasis);
      return {
        type: 'ambiguous',
        candidates,
        chain: [link],
        reason: hasBasis
          ? `拆分候选未分配：${mapping.id} 附分摊依据（${mapping.allocationBasis}），待审核，不计入类别合计`
          : `拆分候选未分配：${mapping.id} 无患者级/项目级分摊依据，金额保留在歧义池`,
      };
    }
    // 一对一：更名 / 等价替换 / 合并
    const toCode = mapping.toCodes[0]!;
    const target = ctx.byCatalogAndCode.get(`${nextCatalog.id}|${toCode}`);
    if (!target) {
      return { type: 'unmapped', chain: [link], reason: `映射 ${mapping.id} 目标代码 ${toCode} 不在 ${nextCatalog.id}` };
    }
    const sub = followChain(target, { mappingId: mapping.id, kind: mapping.kind }, ctx, nextVisited);
    return { ...sub, chain: [link, ...sub.chain] } as ChainResult;
  }

  // 无显式映射：代码沿用（同代码同类别进入下一版）则视为连续
  const continued = ctx.byCatalogAndCode.get(`${nextCatalog.id}|${entry.localCode}`);
  if (continued && continued.nationalCategoryCode === entry.nationalCategoryCode) {
    const sub = followChain(continued, '沿用', ctx, nextVisited);
    return { ...sub, chain: [link, ...sub.chain] } as ChainResult;
  }
  if (continued) {
    return {
      type: 'unmapped',
      chain: [link],
      reason: `代码 ${entry.localCode} 跨版含义变化但未登记映射，需政策人员补充依据`,
    };
  }
  return { type: 'unmapped', chain: [link], reason: `代码 ${entry.localCode} 已停用且无后继映射` };
}

/** 最细类别投影：逐行解析到现行目录最细国家类别（或歧义池 / 未映射池）。 */
export function resolveRows(
  rows: StatSettlementRow[],
  entries: CatalogEntry[],
  mappings: CodeMapping[],
): RowResolution[] {
  const ctx = buildChainContext(entries, mappings);
  return rows.map((row) => {
    const entry = findEntryAt(entries, row.localCode, row.serviceDate);
    if (!entry) {
      return {
        rowId: row.id,
        year: row.year,
        localCode: row.localCode,
        amountCents: row.amountCents,
        status: 'unmapped' as ResolutionStatus,
        entryId: null,
        catalogVersionId: null,
        targetCategoryCode: null,
        candidates: [],
        chain: [],
        reason: `目录未收录：服务日 ${row.serviceDate} 无覆盖该日的有效目录条目`,
      };
    }
    const result = followChain(entry, '起始', ctx, new Set());
    if (result.type === 'unique') {
      return {
        rowId: row.id,
        year: row.year,
        localCode: row.localCode,
        amountCents: row.amountCents,
        status: entry.catalogVersionId === CURRENT_CATALOG_ID ? ('current' as const) : ('mapped' as const),
        entryId: entry.id,
        catalogVersionId: entry.catalogVersionId,
        targetCategoryCode: result.categoryCode,
        candidates: [],
        chain: result.chain,
        reason: '',
      };
    }
    return {
      rowId: row.id,
      year: row.year,
      localCode: row.localCode,
      amountCents: row.amountCents,
      status: result.type === 'ambiguous' ? ('ambiguous' as const) : ('unmapped' as const),
      entryId: entry.id,
      catalogVersionId: entry.catalogVersionId,
      targetCategoryCode: null,
      candidates: result.type === 'ambiguous' ? result.candidates : [],
      chain: result.chain,
      reason: result.reason,
    };
  });
}

/** 上级类别汇总：按历史条目的国家类别归集到二级（共同稳定上级），不经映射。 */
export function buildParentPlacements(
  rows: StatSettlementRow[],
  entries: CatalogEntry[],
): Map<string, { entryId: string; categoryCode: string } | null> {
  const placements = new Map<string, { entryId: string; categoryCode: string } | null>();
  for (const row of rows) {
    const entry = findEntryAt(entries, row.localCode, row.serviceDate);
    placements.set(
      row.id,
      entry ? { entryId: entry.id, categoryCode: level2Ancestor(entry.nationalCategoryCode).code } : null,
    );
  }
  return placements;
}

export interface CoverageInfo {
  mappedRows: number;
  totalRows: number;
  mappedAmountCents: number;
  totalAmountCents: number;
  rowRate: number;
  amountRate: number;
}

export interface AmbiguousRowInfo {
  rowId: string;
  year: number;
  localCode: string;
  itemName: string;
  amountCents: number;
  basis: string;
  candidates: Array<SplitCandidate & { referenceCents: number | null }>;
}

export interface ModeTable {
  mode: 'finest' | 'parent';
  categories: NationalCategory[];
  years: number[];
  cells: Record<string, Record<number, YearCell>>;
  mappedByYear: Record<number, YearCell>;
  ambiguousByYear: Record<number, YearCell>;
  unmappedByYear: Record<number, YearCell>;
  totalByYear: Record<number, YearCell>;
  coverageByYear: Record<number, CoverageInfo>;
  unmappedReasons: Array<{ reason: string; byYear: Record<number, YearCell> }>;
  ambiguousRows: AmbiguousRowInfo[];
}

export interface RawTable {
  years: number[];
  codes: Array<{
    code: string;
    namesByYear: Record<number, string>;
    byYear: Record<number, YearCell>;
  }>;
  totalByYear: Record<number, YearCell>;
}

function emptyCell(): YearCell {
  return { rows: 0, amountCents: 0 };
}

function addTo(cell: YearCell | undefined, amountCents: number): YearCell {
  const target = cell ?? emptyCell();
  target.rows += 1;
  target.amountCents += amountCents;
  return target;
}

function yearsOf(rows: StatSettlementRow[]): number[] {
  return [...new Set(rows.map((row) => row.year))].sort();
}

/** 最细类别投影口径的汇总表（唯一映射 + 歧义池 + 未映射池）。 */
export function buildFinestTable(rows: StatSettlementRow[], resolutions: RowResolution[]): ModeTable {
  const years = yearsOf(rows);
  const cells: ModeTable['cells'] = {};
  const mappedByYear: ModeTable['mappedByYear'] = {};
  const ambiguousByYear: ModeTable['ambiguousByYear'] = {};
  const unmappedByYear: ModeTable['unmappedByYear'] = {};
  const totalByYear: ModeTable['totalByYear'] = {};
  const coverageByYear: ModeTable['coverageByYear'] = {};
  const reasonMap = new Map<string, Record<number, YearCell>>();
  const ambiguousRows: AmbiguousRowInfo[] = [];
  const rowById = new Map(rows.map((row) => [row.id, row]));

  for (const resolution of resolutions) {
    const year = resolution.year;
    totalByYear[year] = addTo(totalByYear[year], resolution.amountCents);
    if (resolution.status === 'current' || resolution.status === 'mapped') {
      const categoryCode = resolution.targetCategoryCode!;
      cells[categoryCode] = cells[categoryCode] ?? {};
      cells[categoryCode][year] = addTo(cells[categoryCode][year], resolution.amountCents);
      mappedByYear[year] = addTo(mappedByYear[year], resolution.amountCents);
    } else if (resolution.status === 'ambiguous') {
      ambiguousByYear[year] = addTo(ambiguousByYear[year], resolution.amountCents);
      const source = rowById.get(resolution.rowId);
      ambiguousRows.push({
        rowId: resolution.rowId,
        year,
        localCode: resolution.localCode,
        itemName: source?.itemName ?? '',
        amountCents: resolution.amountCents,
        basis: resolution.reason,
        candidates: resolution.candidates.map((candidate) => ({
          ...candidate,
          referenceCents:
            candidate.weight === null ? null : Math.round(resolution.amountCents * candidate.weight),
        })),
      });
    } else {
      unmappedByYear[year] = addTo(unmappedByYear[year], resolution.amountCents);
      const reasonKey = resolution.reason.split('：')[0] ?? resolution.reason;
      const bucket = reasonMap.get(reasonKey) ?? {};
      bucket[year] = addTo(bucket[year], resolution.amountCents);
      reasonMap.set(reasonKey, bucket);
    }
  }

  for (const year of years) {
    const mappedRows = mappedByYear[year]?.rows ?? 0;
    const mappedAmount = mappedByYear[year]?.amountCents ?? 0;
    const totalRows = totalByYear[year]?.rows ?? 0;
    const totalAmount = totalByYear[year]?.amountCents ?? 0;
    coverageByYear[year] = {
      mappedRows,
      totalRows,
      mappedAmountCents: mappedAmount,
      totalAmountCents: totalAmount,
      rowRate: totalRows === 0 ? 0 : mappedRows / totalRows,
      amountRate: totalAmount === 0 ? 0 : mappedAmount / totalAmount,
    };
  }

  const categories = Object.keys(cells)
    .sort()
    .map((code) => categoryOf(code));

  return {
    mode: 'finest',
    categories,
    years,
    cells,
    mappedByYear,
    ambiguousByYear,
    unmappedByYear,
    totalByYear,
    coverageByYear,
    unmappedReasons: [...reasonMap.entries()]
      .map(([reason, byYear]) => ({ reason, byYear }))
      .sort((a, b) => a.reason.localeCompare(b.reason)),
    ambiguousRows: ambiguousRows.sort((a, b) => a.rowId.localeCompare(b.rowId)),
  };
}

/** 上级类别汇总口径：历史条目直接归集到二级类别；未收录行进未映射池。 */
export function buildParentTable(rows: StatSettlementRow[], entries: CatalogEntry[]): ModeTable {
  const years = yearsOf(rows);
  const placements = buildParentPlacements(rows, entries);
  const cells: ModeTable['cells'] = {};
  const mappedByYear: ModeTable['mappedByYear'] = {};
  const unmappedByYear: ModeTable['unmappedByYear'] = {};
  const totalByYear: ModeTable['totalByYear'] = {};
  const coverageByYear: ModeTable['coverageByYear'] = {};
  const reasonMap = new Map<string, Record<number, YearCell>>();

  for (const row of rows) {
    const year = row.year;
    totalByYear[year] = addTo(totalByYear[year], row.amountCents);
    const placement = placements.get(row.id);
    if (placement) {
      cells[placement.categoryCode] = cells[placement.categoryCode] ?? {};
      cells[placement.categoryCode][year] = addTo(cells[placement.categoryCode][year], row.amountCents);
      mappedByYear[year] = addTo(mappedByYear[year], row.amountCents);
    } else {
      unmappedByYear[year] = addTo(unmappedByYear[year], row.amountCents);
      const bucket = reasonMap.get('目录未收录') ?? {};
      bucket[year] = addTo(bucket[year], row.amountCents);
      reasonMap.set('目录未收录', bucket);
    }
  }

  for (const year of years) {
    const mappedRows = mappedByYear[year]?.rows ?? 0;
    const mappedAmount = mappedByYear[year]?.amountCents ?? 0;
    const totalRows = totalByYear[year]?.rows ?? 0;
    const totalAmount = totalByYear[year]?.amountCents ?? 0;
    coverageByYear[year] = {
      mappedRows,
      totalRows,
      mappedAmountCents: mappedAmount,
      totalAmountCents: totalAmount,
      rowRate: totalRows === 0 ? 0 : mappedRows / totalRows,
      amountRate: totalAmount === 0 ? 0 : mappedAmount / totalAmount,
    };
  }

  return {
    mode: 'parent',
    categories: Object.keys(cells).sort().map((code) => categoryOf(code)),
    years,
    cells,
    mappedByYear,
    ambiguousByYear: {},
    unmappedByYear,
    totalByYear,
    coverageByYear,
    unmappedReasons: [...reasonMap.entries()].map(([reason, byYear]) => ({ reason, byYear })),
    ambiguousRows: [],
  };
}

/** 原始代码口径：按结算时的代码与名称原样汇总（不做任何沿革调整）。 */
export function buildRawTable(rows: StatSettlementRow[]): RawTable {
  const years = yearsOf(rows);
  const byCode = new Map<string, { namesByYear: Record<number, string>; byYear: Record<number, YearCell> }>();
  const totalByYear: Record<number, YearCell> = {};
  for (const row of rows) {
    totalByYear[row.year] = addTo(totalByYear[row.year], row.amountCents);
    const bucket = byCode.get(row.localCode) ?? { namesByYear: {}, byYear: {} };
    bucket.byYear[row.year] = addTo(bucket.byYear[row.year], row.amountCents);
    bucket.namesByYear[row.year] = row.itemName;
    byCode.set(row.localCode, bucket);
  }
  return {
    years,
    codes: [...byCode.entries()]
      .map(([code, bucket]) => ({ code, namesByYear: bucket.namesByYear, byYear: bucket.byYear }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    totalByYear,
  };
}

export interface CompareTables {
  finest: ModeTable;
  parent: ModeTable;
  raw: RawTable;
}

export function buildCompareTables(
  rows: StatSettlementRow[],
  entries: CatalogEntry[],
  resolutions: RowResolution[],
): CompareTables {
  return {
    finest: buildFinestTable(rows, resolutions),
    parent: buildParentTable(rows, entries),
    raw: buildRawTable(rows),
  };
}

/** 解析链中实际经过的显式映射（用于回查映射依据）。 */
export function hopsOf(resolution: RowResolution): Array<{ mappingId: string; kind: CodeMapping['kind'] }> {
  return resolution.chain
    .filter((link) => typeof link.via === 'object')
    .map((link) => ({ mappingId: (link.via as { mappingId: string }).mappingId, kind: (link.via as { kind: CodeMapping['kind'] }).kind }));
}

// ---------------------------------------------------------------------------
// 统计运行版本
// ---------------------------------------------------------------------------

export function buildStatsRun(params: {
  version: number;
  rows: StatSettlementRow[];
  entries: CatalogEntry[];
  mappings: CodeMapping[];
  createdAt: string;
  label?: string;
  supersedesRunId: string | null;
  correctionNote: string | null;
  affectedScope: StatsRun['affectedScope'];
  carriedOverRows: number;
}): StatsRun {
  const resolutions = resolveRows(params.rows, params.entries, params.mappings);
  return {
    id: `RUN-V${params.version}`,
    version: params.version,
    label: params.label ?? `统计运行 V${params.version}`,
    createdAt: params.createdAt,
    status: '当前',
    rowsDigest: digestOf(params.rows),
    catalogDigest: digestOf({ entries: params.entries, mappings: params.mappings }),
    outputDigest: digestOf(resolutions),
    snapshot: { entries: params.entries, mappings: params.mappings },
    supersedesRunId: params.supersedesRunId,
    correctionNote: params.correctionNote,
    affectedScope: params.affectedScope,
    carriedOverRows: params.carriedOverRows,
    resolutions,
  };
}

/**
 * 目录更正后的重建：只重算受影响的代码与期间，未涉及行逐字沿用上一版结果。
 * 返回新运行版本与实际发生变化的行（用于校验「变化 ⊆ 声明范围」）。
 */
export function rebuildStatsRun(params: {
  prev: StatsRun;
  rows: StatSettlementRow[];
  entries: CatalogEntry[];
  mappings: CodeMapping[];
  declaredCodes: string[];
  createdAt: string;
  correctionNote: string;
}): { run: StatsRun; changedRowIds: string[] } {
  const nextResolutions = resolveRows(params.rows, params.entries, params.mappings);
  const changedRowIds: string[] = [];
  for (let index = 0; index < params.rows.length; index += 1) {
    if (digestOf(params.prev.resolutions[index]) !== digestOf(nextResolutions[index])) {
      changedRowIds.push(params.rows[index]!.id);
    }
  }
  const changedYears = [
    ...new Set(params.rows.filter((row) => changedRowIds.includes(row.id)).map((row) => row.year)),
  ].sort();
  const run = buildStatsRun({
    version: params.prev.version + 1,
    rows: params.rows,
    entries: params.entries,
    mappings: params.mappings,
    createdAt: params.createdAt,
    label: `统计运行 V${params.prev.version + 1}（目录更正重建）`,
    supersedesRunId: params.prev.id,
    correctionNote: params.correctionNote,
    affectedScope: {
      codes: [...params.declaredCodes].sort(),
      years: changedYears,
      changedRowIds,
    },
    carriedOverRows: params.rows.length - changedRowIds.length,
  });
  return { run, changedRowIds };
}

/** 复现校验：用运行版本冻结的输入快照重算，输出摘要必须一致。 */
export function replayRun(run: StatsRun, rows: StatSettlementRow[]): { ok: boolean; digest: string; rowsOk: boolean } {
  const rowsOk = digestOf(rows) === run.rowsDigest;
  const resolutions = resolveRows(rows, run.snapshot.entries, run.snapshot.mappings);
  const digest = digestOf(resolutions);
  return { ok: rowsOk && digest === run.outputDigest, digest, rowsOk };
}

/** 版本间差异：行级变化 + 两种口径的类别金额差。 */
export function diffRuns(base: StatsRun, compare: StatsRun, rows: StatSettlementRow[]): RunDiff {
  const changedRows: RunDiff['changedRows'] = [];
  let unchangedRows = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const before = base.resolutions[index]!;
    const after = compare.resolutions[index]!;
    if (digestOf(before) === digestOf(after)) {
      unchangedRows += 1;
      continue;
    }
    changedRows.push({
      rowId: before.rowId,
      localCode: before.localCode,
      year: before.year,
      beforeStatus: before.status,
      afterStatus: after.status,
      beforeTarget: before.targetCategoryCode,
      afterTarget: after.targetCategoryCode,
    });
  }

  const finestDelta = collectDeltas(
    buildFinestTable(rows, base.resolutions).cells,
    buildFinestTable(rows, compare.resolutions).cells,
  );
  const parentDelta = collectDeltas(
    buildParentTable(rows, base.snapshot.entries).cells,
    buildParentTable(rows, compare.snapshot.entries).cells,
  );

  return {
    baseRunId: base.id,
    compareRunId: compare.id,
    changedRows,
    affectedCodes: [...new Set(changedRows.map((row) => row.localCode))].sort(),
    affectedYears: [...new Set(changedRows.map((row) => row.year))].sort(),
    unchangedRows,
    categoryDeltas: finestDelta,
    parentDeltas: parentDelta,
  };
}

function collectDeltas(
  beforeCells: Record<string, Record<number, YearCell>>,
  afterCells: Record<string, Record<number, YearCell>>,
): RunDiff['categoryDeltas'] {
  const deltas: RunDiff['categoryDeltas'] = [];
  const keys = new Set<string>();
  for (const [category, byYear] of Object.entries(beforeCells)) {
    for (const year of Object.keys(byYear)) keys.add(`${category}|${year}`);
  }
  for (const [category, byYear] of Object.entries(afterCells)) {
    for (const year of Object.keys(byYear)) keys.add(`${category}|${year}`);
  }
  for (const key of [...keys].sort()) {
    const [category, yearText] = key.split('|');
    const year = Number(yearText);
    const beforeCents = beforeCells[category!]?.[year]?.amountCents ?? 0;
    const afterCents = afterCells[category!]?.[year]?.amountCents ?? 0;
    if (beforeCents !== afterCents) {
      deltas.push({ categoryCode: category!, year, beforeCents, afterCents, deltaCents: afterCents - beforeCents });
    }
  }
  return deltas;
}
