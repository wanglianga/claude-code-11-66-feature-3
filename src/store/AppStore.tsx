import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AuditEvent,
  BatchRecord,
  Dataset,
  DatasetAnalysis,
  DatasetConfig,
  MaterialPackage,
  ScopeFilter,
} from '../types/domain';
import type { StatsRun, StatsState } from '../types/stats';
import { analyzeDataset, filterRows, scopeFingerprint } from '../core/analysis';
import { DEFAULT_CONFIG } from '../core/sample';
import { applyCatalogCorrection, buildCatalogCorrection, buildStatsState, CORRECTION_BATCH_ID } from '../core/catalog';
import { buildStatsRun, rebuildStatsRun } from '../core/comparable';
import { auditWorker } from '../worker/client';
import {
  clearStatsRuns,
  listEvents,
  listMaterials,
  listStatsRuns,
  loadCurrentDataset,
  loadStatsState,
  resetAll,
  saveDataset,
  saveEvent,
  saveMaterial,
  saveStatsRun,
  saveStatsState,
  setMeta,
} from '../db/idb';

export type Toast = { id: number; message: string; tone: 'info' | 'warn' };

interface AppStore {
  ready: boolean;
  dataset: Dataset | null;
  analysis: DatasetAnalysis | null;
  materials: MaterialPackage[];
  events: AuditEvent[];
  toasts: Toast[];
  busy: string | null;
  scope: ScopeFilter;
  scopeRows: ReturnType<typeof filterRows>;
  setScope: (scope: ScopeFilter) => void;
  generate: (config: DatasetConfig) => Promise<void>;
  applyCorrection: (next: Dataset, event: Omit<AuditEvent, 'id' | 'at'>) => Promise<void>;
  recordMaterial: (material: MaterialPackage, event: Omit<AuditEvent, 'id' | 'at'>) => Promise<void>;
  pushEvent: (event: Omit<AuditEvent, 'id' | 'at'>) => Promise<void>;
  toast: (message: string, tone?: 'info' | 'warn') => void;
  reset: () => Promise<void>;
  refreshMaterials: () => Promise<void>;
  // 代码沿革与历史可比统计
  statsState: StatsState | null;
  statsRuns: StatsRun[];
  activeRunId: string | null;
  setActiveRun: (id: string) => void;
  applyStatsCorrection: () => Promise<void>;
  resetStats: () => Promise<void>;
}

const AppContext = createContext<AppStore | null>(null);

let eventCounter = 0;
function makeEventId(): string {
  eventCounter += 1;
  return `EV-${Date.now()}-${eventCounter}`;
}

function nowIso(): string {
  const date = new Date();
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  const local = new Date(date.getTime() + offset * 60000).toISOString().slice(0, 19);
  return `${local}${sign}${pad(offset / 60)}:${pad(offset % 60)}`;
}

const INITIAL_SCOPE: ScopeFilter = {
  itemCodes: [],
  areaCodes: [],
  institutionCodes: [],
  ruleCodes: [],
  dateFrom: '2025-01-01',
  dateTo: '2025-06-30',
  onlyPending: false,
};

function buildInitialStatsRun(state: StatsState, createdAt: string): StatsRun {
  return buildStatsRun({
    version: 1,
    rows: state.rows,
    entries: state.entries,
    mappings: state.mappings,
    createdAt,
    label: '统计运行 V1（基线口径）',
    supersedesRunId: null,
    correctionNote: null,
    affectedScope: null,
    carriedOverRows: 0,
  });
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [analysis, setAnalysis] = useState<DatasetAnalysis | null>(null);
  const [materials, setMaterials] = useState<MaterialPackage[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [scope, setScope] = useState<ScopeFilter>(INITIAL_SCOPE);
  const [statsState, setStatsState] = useState<StatsState | null>(null);
  const [statsRuns, setStatsRuns] = useState<StatsRun[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const toastId = useRef(0);

  const toast = useCallback((message: string, tone: 'info' | 'warn' = 'info') => {
    toastId.current += 1;
    const id = toastId.current;
    setToasts((prev) => [...prev, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 4200);
  }, []);

  const pushEvent = useCallback(async (event: Omit<AuditEvent, 'id' | 'at'>) => {
    const record: AuditEvent = { ...event, id: makeEventId(), at: nowIso() };
    await saveEvent(record);
    setEvents((prev) => [record, ...prev]);
  }, []);

  const refreshMaterials = useCallback(async () => {
    const list = await listMaterials();
    setMaterials(list);
  }, []);

  /** 载入或播种统计模块（目录 + 映射 + 结算提取 + 基线运行 V1）。 */
  const ensureStats = useCallback(async (): Promise<{ state: StatsState; runs: StatsRun[] }> => {
    const storedState = await loadStatsState();
    const storedRuns = await listStatsRuns();
    if (storedState && storedRuns.length > 0) {
      setStatsState(storedState);
      setStatsRuns(storedRuns);
      setActiveRunId(storedRuns[storedRuns.length - 1]!.id);
      return { state: storedState, runs: storedRuns };
    }
    const seeded = buildStatsState();
    const run = buildInitialStatsRun(seeded, nowIso());
    await saveStatsState(seeded);
    await saveStatsRun(run);
    setStatsState(seeded);
    setStatsRuns([run]);
    setActiveRunId(run.id);
    await pushEvent({
      kind: '初始化',
      title: '初始化代码沿革统计样例',
      detail: `目录 ${seeded.catalogs.length} 版、映射 ${seeded.mappings.length} 条、跨年度结算提取 ${seeded.rows.length} 行；生成统计运行 V1 基线。`,
    });
    return { state: seeded, runs: [run] };
  }, [pushEvent]);

  const bootstrap = useCallback(async () => {
    try {
      await ensureStats();
      const stored = await loadCurrentDataset();
      const storedMaterials = await listMaterials();
      const storedEvents = await listEvents();
      setMaterials(storedMaterials);
      setEvents(storedEvents);
      if (stored) {
        const analyzed = analyzeDataset(stored);
        setDataset(stored);
        setAnalysis(analyzed);
        await setMeta('bootstrappedAt', nowIso());
        setReady(true);
        return;
      }
      const seeded = await auditWorker.generate(DEFAULT_CONFIG);
      setDataset(seeded.dataset);
      setAnalysis(seeded.analysis);
      await saveDataset(seeded.dataset);
      await pushEvent({
        kind: '初始化',
        title: '首次载入样例批次',
        detail: `Worker 生成 ${seeded.dataset.settlements.length} 条结算行、${seeded.dataset.hits.length} 条规则命中，写入 IndexedDB。`,
      });
    } catch (error) {
      console.error(error);
      toast(`初始化失败：${error instanceof Error ? error.message : String(error)}`, 'warn');
    } finally {
      setReady(true);
    }
  }, [ensureStats, pushEvent, toast]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const generate = useCallback(
    async (config: DatasetConfig) => {
      setBusy('正在 Worker 中生成批次数据…');
      try {
        const result = await auditWorker.generate(config);
        await resetAll();
        await saveDataset(result.dataset);
        setDataset(result.dataset);
        setAnalysis(result.analysis);
        setMaterials([]);
        setEvents([]);
        setScope(INITIAL_SCOPE);
        // resetAll 同时清空了统计模块存储，重新播种基线。
        const seededStats = buildStatsState();
        const statsRun = buildInitialStatsRun(seededStats, nowIso());
        await saveStatsState(seededStats);
        await saveStatsRun(statsRun);
        setStatsState(seededStats);
        setStatsRuns([statsRun]);
        setActiveRunId(statsRun.id);
        await pushEvent({
          kind: '导入',
          title: '重新生成样例批次',
          detail: `随机种子 ${config.seed}，结算行 ${result.dataset.settlements.length} 条，规则命中 ${result.dataset.hits.length} 条；已清空旧材料，统计模块同步重置为基线。`,
        });
        toast(`已生成 ${result.dataset.settlements.length} 条结算行`);
      } catch (error) {
        toast(`生成失败：${error instanceof Error ? error.message : String(error)}`, 'warn');
      } finally {
        setBusy(null);
      }
    },
    [pushEvent, toast],
  );

  const applyCorrection = useCallback(
    async (next: Dataset, event: Omit<AuditEvent, 'id' | 'at'>) => {
      const analyzed = analyzeDataset(next);
      await saveDataset(next);
      setDataset(next);
      setAnalysis(analyzed);
      await pushEvent(event);
      toast('更正已应用：仅影响后续新材料，已封存材料保持不变');
    },
    [pushEvent, toast],
  );

  const recordMaterial = useCallback(
    async (material: MaterialPackage, event: Omit<AuditEvent, 'id' | 'at'>) => {
      await saveMaterial(material);
      await pushEvent(event);
      await refreshMaterials();
    },
    [pushEvent, refreshMaterials],
  );

  const applyStatsCorrection = useCallback(async () => {
    if (!statsState || statsRuns.length === 0) return;
    if (statsState.correctionsApplied.includes(CORRECTION_BATCH_ID)) {
      toast(`更正批次 ${CORRECTION_BATCH_ID} 已应用，不重复执行`, 'warn');
      return;
    }
    setBusy('正在应用目录更正并重建统计版本…');
    try {
      const correction = buildCatalogCorrection(statsState);
      const nextState = applyCatalogCorrection(statsState, correction);
      const prevRun = statsRuns[statsRuns.length - 1]!;
      const { run, changedRowIds } = rebuildStatsRun({
        prev: prevRun,
        rows: nextState.rows,
        entries: nextState.entries,
        mappings: nextState.mappings,
        declaredCodes: correction.affectedCodes,
        createdAt: nowIso(),
        correctionNote: correction.note,
      });
      await saveStatsState(nextState);
      await saveStatsRun(run);
      setStatsState(nextState);
      setStatsRuns((prev) => [...prev, run]);
      setActiveRunId(run.id);
      await pushEvent({
        kind: '更正',
        title: `应用目录更正 ${correction.batch.id}，生成统计运行 V${run.version}`,
        detail: `${correction.note} 实际重算 ${changedRowIds.length} 行（声明涉及代码 ${correction.affectedCodes.join('、')}），其余 ${run.carriedOverRows} 行逐字沿用 V${prevRun.version}；旧版本仍可复现。`,
      });
      toast(`已生成统计运行 V${run.version}：${changedRowIds.length} 行重算，${run.carriedOverRows} 行沿用`);
    } catch (error) {
      toast(`目录更正失败：${error instanceof Error ? error.message : String(error)}`, 'warn');
    } finally {
      setBusy(null);
    }
  }, [statsState, statsRuns, pushEvent, toast]);

  const resetStats = useCallback(async () => {
    setBusy('正在恢复统计模块默认样例…');
    try {
      const seeded = buildStatsState();
      const run = buildInitialStatsRun(seeded, nowIso());
      await saveStatsState(seeded);
      await clearStatsRuns();
      await saveStatsRun(run);
      setStatsState(seeded);
      setStatsRuns([run]);
      setActiveRunId(run.id);
      await pushEvent({
        kind: '初始化',
        title: '恢复统计模块默认样例',
        detail: '目录、映射与结算提取恢复为内置样例；统计运行回到 V1 基线，已应用的目录更正在被撤销。',
      });
      toast('统计模块已恢复默认样例');
    } finally {
      setBusy(null);
    }
  }, [pushEvent, toast]);

  const setActiveRun = useCallback((id: string) => {
    setActiveRunId(id);
  }, []);

  const reset = useCallback(async () => {
    await resetAll();
    setMaterials([]);
    setEvents([]);
    setDataset(null);
    setAnalysis(null);
    setScope(INITIAL_SCOPE);
    const seededStats = buildStatsState();
    const statsRun = buildInitialStatsRun(seededStats, nowIso());
    await saveStatsState(seededStats);
    await saveStatsRun(statsRun);
    setStatsState(seededStats);
    setStatsRuns([statsRun]);
    setActiveRunId(statsRun.id);
    const seeded = await auditWorker.generate(DEFAULT_CONFIG);
    setDataset(seeded.dataset);
    setAnalysis(seeded.analysis);
    await saveDataset(seeded.dataset);
    await pushEvent({ kind: '初始化', title: '重置工作区', detail: '清空材料与事件，重新载入样例批次；统计模块同步恢复基线。' });
    toast('工作区已重置');
  }, [pushEvent, toast]);

  const scopeRows = useMemo(() => {
    if (!analysis) return [];
    return filterRows(analysis, scope);
  }, [analysis, scope]);

  const value: AppStore = {
    ready,
    dataset,
    analysis: analysis ?? null,
    materials,
    events,
    toasts,
    busy,
    scope,
    scopeRows,
    setScope,
    generate,
    applyCorrection,
    recordMaterial,
    pushEvent,
    toast,
    reset,
    refreshMaterials,
    statsState,
    statsRuns,
    activeRunId,
    setActiveRun,
    applyStatsCorrection,
    resetStats,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppStore {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp 必须在 AppProvider 内使用');
  return context;
}

export { scopeFingerprint };
export type { BatchRecord };
