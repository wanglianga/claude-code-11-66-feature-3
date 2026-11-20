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
import { analyzeDataset, filterRows, scopeFingerprint } from '../core/analysis';
import { DEFAULT_CONFIG } from '../core/sample';
import { auditWorker } from '../worker/client';
import {
  listEvents,
  listMaterials,
  loadCurrentDataset,
  resetAll,
  saveDataset,
  saveEvent,
  saveMaterial,
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

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [analysis, setAnalysis] = useState<DatasetAnalysis | null>(null);
  const [materials, setMaterials] = useState<MaterialPackage[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [scope, setScope] = useState<ScopeFilter>(INITIAL_SCOPE);
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

  const bootstrap = useCallback(async () => {
    try {
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
  }, [pushEvent, toast]);

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
        await pushEvent({
          kind: '导入',
          title: '重新生成样例批次',
          detail: `随机种子 ${config.seed}，结算行 ${result.dataset.settlements.length} 条，规则命中 ${result.dataset.hits.length} 条；已清空旧材料。`,
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

  const reset = useCallback(async () => {
    await resetAll();
    setMaterials([]);
    setEvents([]);
    setDataset(null);
    setAnalysis(null);
    setScope(INITIAL_SCOPE);
    const seeded = await auditWorker.generate(DEFAULT_CONFIG);
    setDataset(seeded.dataset);
    setAnalysis(seeded.analysis);
    await saveDataset(seeded.dataset);
    await pushEvent({ kind: '初始化', title: '重置工作区', detail: '清空材料与事件，重新载入样例批次。' });
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
