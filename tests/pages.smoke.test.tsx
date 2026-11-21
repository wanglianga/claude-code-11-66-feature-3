import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ScopeFilter } from '../src/types/domain';
import type { StatsRun, StatsState } from '../src/types/stats';
import {
  applyCatalogCorrection,
  buildCatalogCorrection,
  buildStatsState,
} from '../src/core/catalog';
import { buildStatsRun, rebuildStatsRun } from '../src/core/comparable';
import { DEFAULT_CONFIG, generateDataset } from '../src/core/sample';
import { analyzeDataset } from '../src/core/analysis';

/**
 * 页面渲染冒烟测试：以真实样例数据驱动四个统计页面与验收页，
 * 在 Node 端做 SSR 渲染，验证数据绑定路径无运行时错误。
 */

const storeRef = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('../src/store/AppStore', () => ({
  useApp: () => storeRef.current,
}));

const { CatalogPage } = await import('../src/pages/CatalogPage');
const { MappingsPage } = await import('../src/pages/MappingsPage');
const { ComparePage } = await import('../src/pages/ComparePage');
const { RunsPage } = await import('../src/pages/RunsPage');
const { VerificationPage } = await import('../src/pages/VerificationPage');

const EMPTY_SCOPE: ScopeFilter = {
  itemCodes: [],
  areaCodes: [],
  institutionCodes: [],
  ruleCodes: [],
  dateFrom: '2025-01-01',
  dateTo: '2025-06-30',
  onlyPending: false,
};

function makeStore(withCorrection: boolean) {
  const baseState: StatsState = buildStatsState();
  const runV1: StatsRun = buildStatsRun({
    version: 1,
    rows: baseState.rows,
    entries: baseState.entries,
    mappings: baseState.mappings,
    createdAt: '2025-07-20T09:00:00+08:00',
    supersedesRunId: null,
    correctionNote: null,
    affectedScope: null,
    carriedOverRows: 0,
  });
  let statsState = baseState;
  let statsRuns = [runV1];
  if (withCorrection) {
    const correction = buildCatalogCorrection(baseState);
    statsState = applyCatalogCorrection(baseState, correction);
    const { run } = rebuildStatsRun({
      prev: runV1,
      rows: statsState.rows,
      entries: statsState.entries,
      mappings: statsState.mappings,
      declaredCodes: correction.affectedCodes,
      createdAt: '2025-08-20T10:30:00+08:00',
      correctionNote: correction.note,
    });
    statsRuns = [runV1, run];
  }
  const dataset = generateDataset(DEFAULT_CONFIG);
  const analysis = analyzeDataset(dataset);
  return {
    ready: true,
    dataset,
    analysis,
    materials: [],
    events: [],
    toasts: [],
    busy: null,
    scope: EMPTY_SCOPE,
    scopeRows: [],
    setScope: () => undefined,
    generate: async () => undefined,
    applyCorrection: async () => undefined,
    recordMaterial: async () => undefined,
    pushEvent: async () => undefined,
    toast: () => undefined,
    reset: async () => undefined,
    refreshMaterials: async () => undefined,
    statsState,
    statsRuns,
    activeRunId: statsRuns[statsRuns.length - 1]!.id,
    setActiveRun: () => undefined,
    applyStatsCorrection: async () => undefined,
    resetStats: async () => undefined,
  };
}

describe('统计模块页面渲染（基线 V1 口径）', () => {
  it('目录沿革 / 映射关系 / 可比统计 / 统计版本均可渲染', () => {
    storeRef.current = makeStore(false);
    for (const Page of [CatalogPage, MappingsPage, ComparePage, RunsPage]) {
      const html = renderToString(React.createElement(Page));
      expect(html.length).toBeGreaterThan(500);
    }
  });

  it('可比统计页包含三种口径与歧义池内容', () => {
    storeRef.current = makeStore(false);
    const html = renderToString(React.createElement(ComparePage));
    expect(html).toContain('最细类别投影');
    expect(html).toContain('歧义池');
    expect(html).toContain('映射覆盖率');
    expect(html).toContain('无法唯一映射');
  });

  it('目录沿革页展示代码复用分段', () => {
    storeRef.current = makeStore(false);
    const html = renderToString(React.createElement(CatalogPage));
    expect(html).toContain('A100');
    expect(html).toContain('红外线治疗');
    expect(html).toContain('中医定向透药治疗');
  });
});

describe('统计模块页面渲染（更正后 V2 口径）', () => {
  it('统计版本页展示 V2 与差异，复现校验通过', () => {
    storeRef.current = makeStore(true);
    const html = renderToString(React.createElement(RunsPage));
    expect(html).toContain('V2');
    expect(html).toContain('可复现');
    expect(html).toContain('逐字沿用');
  });

  it('可比统计页可切换到 V1 旧口径渲染', () => {
    const store = makeStore(true);
    store.activeRunId = store.statsRuns[0]!.id;
    storeRef.current = store;
    const html = renderToString(React.createElement(ComparePage));
    expect(html).toContain('V1');
  });
});

describe('验收核对页统计检查组', () => {
  it('基线下渲染 8 项统计检查且全部通过', () => {
    storeRef.current = makeStore(false);
    const html = renderToString(React.createElement(VerificationPage));
    expect(html).toContain('可比统计验收清单');
    expect(html).toContain('8 / 8');
  });

  it('更正后统计检查组仍全部通过', () => {
    storeRef.current = makeStore(true);
    const html = renderToString(React.createElement(VerificationPage));
    expect(html).toContain('可比统计验收清单');
    expect(html).toContain('8 / 8');
  });
});
