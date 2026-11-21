import { describe, expect, it } from 'vitest';
import {
  applyCatalogCorrection,
  buildCatalogCorrection,
  buildStatsState,
} from '../src/core/catalog';
import {
  buildCompareTables,
  buildParentPlacements,
  buildStatsRun,
  diffRuns,
  findEntryAt,
  hopsOf,
  rebuildStatsRun,
  replayRun,
  resolveRows,
} from '../src/core/comparable';
import { digestOf } from '../src/core/hash';
import type { StatsState } from '../src/types/stats';

const state = buildStatsState();
const resolutions = resolveRows(state.rows, state.entries, state.mappings);
const tables = buildCompareTables(state.rows, state.entries, resolutions);

function rowsOf(code: string, year?: number) {
  return state.rows.filter((row) => row.localCode === code && (year === undefined || row.year === year));
}

function resolutionsOf(code: string, year?: number) {
  const ids = new Set(rowsOf(code, year).map((row) => row.id));
  return resolutions.filter((resolution) => ids.has(resolution.rowId));
}

function amountOf(code: string, year?: number) {
  return rowsOf(code, year).reduce((acc, row) => acc + row.amountCents, 0);
}

describe('目录解析：按服务发生日分段（代码复用）', () => {
  it('A100 在 2023 / 2025 命中不同释义，2024 年无有效条目', () => {
    expect(findEntryAt(state.entries, 'A100', '2023-06-15')?.nationalCategoryCode).toBe('200101');
    expect(findEntryAt(state.entries, 'A100', '2023-06-15')?.itemName).toBe('红外线治疗');
    expect(findEntryAt(state.entries, 'A100', '2025-03-10')?.nationalCategoryCode).toBe('300101');
    expect(findEntryAt(state.entries, 'A100', '2025-03-10')?.itemName).toBe('中医定向透药治疗');
    expect(findEntryAt(state.entries, 'A100', '2024-06-01')).toBeNull();
  });

  it('2023 年的 A100 不按现行释义回填为中医', () => {
    const placements = buildParentPlacements(state.rows, state.entries);
    for (const row of rowsOf('A100', 2023)) {
      // 上级口径：归入当时的物理治疗，而非现行中医
      expect(placements.get(row.id)?.categoryCode).toBe('2001');
      // 最细口径：旧项目已停用无后继，进入未映射池而非中医外治
      const resolution = resolutions.find((item) => item.rowId === row.id)!;
      expect(resolution.status).toBe('unmapped');
      expect(resolution.reason).toContain('停用且无后继映射');
      expect(resolution.targetCategoryCode).toBeNull();
    }
    for (const row of rowsOf('A100', 2025)) {
      expect(placements.get(row.id)?.categoryCode).toBe('3001');
      const resolution = resolutions.find((item) => item.rowId === row.id)!;
      expect(resolution.status).toBe('current');
      expect(resolution.targetCategoryCode).toBe('300101');
    }
  });
});

describe('映射链：更名 / 等价替换 / 合并 / 沿用', () => {
  it('更名 CS100：代码连续，2023 年行经 MAP-01 结转到现行类别', () => {
    for (const resolution of resolutionsOf('CS100')) {
      expect(resolution.targetCategoryCode).toBe('100104');
    }
    const oldest = resolutionsOf('CS100', 2023);
    expect(oldest.length).toBeGreaterThan(0);
    for (const resolution of oldest) {
      expect(resolution.status).toBe('mapped');
      expect(hopsOf(resolution).map((hop) => hop.mappingId)).toContain('MAP-01');
    }
    for (const resolution of resolutionsOf('CS100', 2025)) {
      expect(resolution.status).toBe('current');
    }
  });

  it('等价替换 MR550→MR551：金额唯一结转，不重复计额', () => {
    for (const resolution of resolutionsOf('MR550')) {
      expect(resolution.status).toBe('mapped');
      expect(resolution.targetCategoryCode).toBe('100103');
      expect(hopsOf(resolution).map((hop) => hop.mappingId)).toContain('MAP-02');
    }
    for (const resolution of resolutionsOf('MR551', 2025)) {
      expect(resolution.status).toBe('current');
      expect(resolution.targetCategoryCode).toBe('100103');
    }
    // 2025 年磁共振金额只来自 MR551 本版直达，不含 MR550 重复结转
    const cell2025 = tables.finest.cells['100103']?.[2025]?.amountCents ?? 0;
    expect(cell2025).toBe(amountOf('MR551', 2025));
  });

  it('合并 XL101+XL102→XL100：两个旧码都唯一结转（更正前落入误录类别）', () => {
    for (const code of ['XL101', 'XL102']) {
      const list = resolutionsOf(code, 2023);
      expect(list.length).toBeGreaterThan(0);
      for (const resolution of list) {
        expect(resolution.status).toBe('mapped');
        expect(hopsOf(resolution).map((hop) => hop.mappingId)).toContain('MAP-05');
        expect(resolution.targetCategoryCode).toBe('100302');
      }
    }
  });

  it('沿用 CT280：无映射跨版连续，类别不变', () => {
    for (const resolution of resolutionsOf('CT280', 2023)) {
      expect(resolution.status).toBe('mapped');
      expect(resolution.targetCategoryCode).toBe('100102');
      expect(hopsOf(resolution)).toHaveLength(0);
    }
    for (const resolution of resolutionsOf('CT280', 2025)) {
      expect(resolution.status).toBe('current');
    }
  });
});

describe('一对多拆分：候选保留在歧义池，不当作已分配金额', () => {
  it('ZL700 拆分有依据：3 个候选带权重，金额留歧义池', () => {
    const list = resolutionsOf('ZL700');
    expect(list.length).toBeGreaterThan(0);
    for (const resolution of list) {
      expect(resolution.status).toBe('ambiguous');
      expect(resolution.targetCategoryCode).toBeNull();
      expect(resolution.candidates.map((candidate) => candidate.toCode)).toEqual(['ZL701', 'ZL702', 'ZL703']);
      expect(resolution.candidates.map((candidate) => candidate.weight)).toEqual([0.5, 0.3, 0.2]);
      expect(resolution.candidates.map((candidate) => candidate.categoryCode)).toEqual(['200201', '200202', '200202']);
    }
  });

  it('ZH600 拆分无依据：候选无权重，不得复制金额给多个新类', () => {
    const list = resolutionsOf('ZH600');
    expect(list.length).toBeGreaterThan(0);
    for (const resolution of list) {
      expect(resolution.status).toBe('ambiguous');
      expect(resolution.candidates.map((candidate) => candidate.toCode)).toEqual(['ZH601', 'ZH602']);
      for (const candidate of resolution.candidates) {
        expect(candidate.weight).toBeNull();
      }
    }
  });

  it('歧义池金额等于全部拆分行金额，类别合计不含候选金额', () => {
    const splitAmount = amountOf('ZL700') + amountOf('ZH600');
    const poolAmount = Object.values(tables.finest.ambiguousByYear).reduce(
      (acc, cell) => acc + cell.amountCents,
      0,
    );
    expect(poolAmount).toBe(splitAmount);
    // 200201/200202 类别在 2023/2024 年没有任何来自拆分行的金额
    for (const category of ['200201', '200202']) {
      expect(tables.finest.cells[category]?.[2023]).toBeUndefined();
      expect(tables.finest.cells[category]?.[2024]).toBeUndefined();
    }
  });

  it('拆分候选的参考分摊合计等于行金额（权重和为 1），但仅作参考', () => {
    const zl700 = resolutionsOf('ZL700')[0]!;
    const reference = zl700.candidates.reduce(
      (acc, candidate) => acc + Math.round(zl700.amountCents * (candidate.weight ?? 0)),
      0,
    );
    // 四舍五入误差在 1 分以内
    expect(Math.abs(reference - zl700.amountCents)).toBeLessThanOrEqual(1);
  });
});

describe('无依据映射与停用、目录外', () => {
  it('QT500→QT501 证据缺失：更正前不参与分配，列入无法唯一映射', () => {
    for (const resolution of resolutionsOf('QT500')) {
      expect(resolution.status).toBe('unmapped');
      expect(resolution.reason).toContain('映射证据缺失');
      expect(resolution.targetCategoryCode).toBeNull();
    }
  });

  it('XT500 停用无后继：2024 年行进未映射池；2025 年零星行按目录未收录处理', () => {
    for (const resolution of resolutionsOf('XT500', 2024)) {
      expect(resolution.status).toBe('unmapped');
      expect(resolution.reason).toContain('停用且无后继映射');
    }
    for (const resolution of resolutionsOf('XT500', 2025)) {
      expect(resolution.status).toBe('unmapped');
      expect(resolution.reason).toContain('目录未收录');
    }
  });

  it('TP999 从未收录：全部年份均为目录未收录', () => {
    const list = resolutionsOf('TP999');
    expect(list.length).toBeGreaterThan(0);
    for (const resolution of list) {
      expect(resolution.status).toBe('unmapped');
      expect(resolution.reason).toContain('目录未收录');
    }
  });
});

describe('金额守恒与覆盖率分母', () => {
  const totalAmount = state.rows.reduce((acc, row) => acc + row.amountCents, 0);

  const sumCells = (cells: Record<string, Record<number, { amountCents: number }>>) =>
    Object.values(cells).reduce(
      (acc, byYear) => acc + Object.values(byYear).reduce((sum, cell) => sum + cell.amountCents, 0),
      0,
    );
  const sumPool = (byYear: Record<number, { amountCents: number }>) =>
    Object.values(byYear).reduce((acc, cell) => acc + cell.amountCents, 0);

  it('最细口径：唯一映射 + 歧义池 + 未映射池 = 原始口径总计', () => {
    const sum = sumCells(tables.finest.cells) + sumPool(tables.finest.ambiguousByYear) + sumPool(tables.finest.unmappedByYear);
    expect(sum).toBe(totalAmount);
    expect(sumCells(tables.raw.codes.reduce<Record<string, Record<number, { amountCents: number }>>>((acc, row) => {
      acc[row.code] = row.byYear;
      return acc;
    }, {}))).toBe(totalAmount);
  });

  it('上级口径：归集 + 未映射 = 原始口径总计', () => {
    const sum = sumCells(tables.parent.cells) + sumPool(tables.parent.unmappedByYear);
    expect(sum).toBe(totalAmount);
  });

  it('覆盖率分母为全部结算提取行（行数与金额逐年一致）', () => {
    for (const year of tables.finest.years) {
      const coverage = tables.finest.coverageByYear[year]!;
      const yearRows = state.rows.filter((row) => row.year === year);
      const yearAmount = yearRows.reduce((acc, row) => acc + row.amountCents, 0);
      expect(coverage.totalRows).toBe(yearRows.length);
      expect(coverage.totalAmountCents).toBe(yearAmount);
      const poolRows =
        (tables.finest.ambiguousByYear[year]?.rows ?? 0) + (tables.finest.unmappedByYear[year]?.rows ?? 0);
      expect(coverage.mappedRows + poolRows).toBe(coverage.totalRows);
    }
  });

  it('映射结转行的每一跳都能回查到证据齐全的映射记录', () => {
    const mappingById = new Map(state.mappings.map((mapping) => [mapping.id, mapping]));
    for (const resolution of resolutions) {
      if (resolution.status !== 'mapped') continue;
      for (const hop of hopsOf(resolution)) {
        expect(mappingById.get(hop.mappingId)?.evidenceStatus).toBe('齐全');
      }
    }
  });
});

describe('目录更正：只重建涉及代码和期间，旧口径可复现', () => {
  const runV1 = buildStatsRun({
    version: 1,
    rows: state.rows,
    entries: state.entries,
    mappings: state.mappings,
    createdAt: '2025-07-20T09:00:00+08:00',
    supersedesRunId: null,
    correctionNote: null,
    affectedScope: null,
    carriedOverRows: 0,
  });
  const correction = buildCatalogCorrection(state);
  const correctedState: StatsState = applyCatalogCorrection(state, correction);
  const { run: runV2, changedRowIds } = rebuildStatsRun({
    prev: runV1,
    rows: correctedState.rows,
    entries: correctedState.entries,
    mappings: correctedState.mappings,
    declaredCodes: correction.affectedCodes,
    createdAt: '2025-08-20T10:30:00+08:00',
    correctionNote: correction.note,
  });

  it('变化行全部落在声明的涉及代码内', () => {
    const declared = new Set(correction.affectedCodes);
    const changedRows = state.rows.filter((row) => changedRowIds.includes(row.id));
    expect(changedRows.length).toBeGreaterThan(0);
    for (const row of changedRows) {
      expect(declared.has(row.localCode)).toBe(true);
    }
  });

  it('QT500 由未映射转为映射结转；XL 链类别由 100302 修正为 100301', () => {
    const v2ById = new Map(runV2.resolutions.map((resolution) => [resolution.rowId, resolution]));
    for (const row of rowsOf('QT500')) {
      expect(runV1.resolutions.find((item) => item.rowId === row.id)?.status).toBe('unmapped');
      expect(v2ById.get(row.id)?.status).toBe('mapped');
      expect(v2ById.get(row.id)?.targetCategoryCode).toBe('200102');
    }
    for (const code of ['XL101', 'XL102', 'XL100']) {
      for (const row of rowsOf(code)) {
        expect(v2ById.get(row.id)?.targetCategoryCode).toBe('100301');
      }
    }
  });

  it('未涉及行逐字沿用（拆分、复用、目录外行完全不变）', () => {
    const v1ById = new Map(runV1.resolutions.map((resolution) => [resolution.rowId, resolution]));
    const v2ById = new Map(runV2.resolutions.map((resolution) => [resolution.rowId, resolution]));
    const declared = new Set(correction.affectedCodes);
    for (const row of state.rows) {
      if (declared.has(row.localCode)) continue;
      expect(digestOf(v2ById.get(row.id))).toBe(digestOf(v1ById.get(row.id)));
    }
    expect(runV2.carriedOverRows).toBe(state.rows.length - changedRowIds.length);
  });

  it('差异仅涉及声明代码与期间；上级汇总口径不受本次更正影响', () => {
    const diff = diffRuns(runV1, runV2, state.rows);
    expect(diff.changedRows.length).toBe(changedRowIds.length);
    for (const code of diff.affectedCodes) {
      expect(correction.affectedCodes).toContain(code);
    }
    expect(diff.parentDeltas).toHaveLength(0);
    // 最细口径：电疗与磁疗在 2023/2024 年增加（QT500 补证据后转入）
    const delta200102 = diff.categoryDeltas.filter((delta) => delta.categoryCode === '200102');
    expect(delta200102.length).toBeGreaterThan(0);
    for (const delta of delta200102) {
      expect(delta.deltaCents).toBeGreaterThan(0);
    }
    // 心电检查增加 = 脑电与脑功能检查减少
    const gain = diff.categoryDeltas
      .filter((delta) => delta.categoryCode === '100301')
      .reduce((acc, delta) => acc + delta.deltaCents, 0);
    const loss = diff.categoryDeltas
      .filter((delta) => delta.categoryCode === '100302')
      .reduce((acc, delta) => acc + delta.deltaCents, 0);
    expect(gain).toBeGreaterThan(0);
    expect(gain + loss).toBe(0);
  });

  it('两个版本都能用冻结输入复现', () => {
    expect(replayRun(runV1, state.rows).ok).toBe(true);
    expect(replayRun(runV2, state.rows).ok).toBe(true);
    expect(replayRun(runV1, state.rows).rowsOk).toBe(true);
  });

  it('更正后金额仍然守恒（不重复、不遗漏）', () => {
    const correctedTables = buildCompareTables(correctedState.rows, correctedState.entries, runV2.resolutions);
    const totalAmount = state.rows.reduce((acc, row) => acc + row.amountCents, 0);
    const sumCells = Object.values(correctedTables.finest.cells).reduce(
      (acc, byYear) => acc + Object.values(byYear).reduce((sum, cell) => sum + cell.amountCents, 0),
      0,
    );
    const sumPools =
      Object.values(correctedTables.finest.ambiguousByYear).reduce((acc, cell) => acc + cell.amountCents, 0) +
      Object.values(correctedTables.finest.unmappedByYear).reduce((acc, cell) => acc + cell.amountCents, 0);
    expect(sumCells + sumPools).toBe(totalAmount);
  });
});
