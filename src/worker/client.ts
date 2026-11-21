import type { Dataset, DatasetAnalysis, DatasetConfig } from '../types/domain';
import type { WorkerRequest, WorkerResponse } from '../worker/audit.worker';

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
type RequestBody = DistributiveOmit<WorkerRequest, 'id'>;

type Pending = {
  resolve: (value: WorkerResponse) => void;
  reject: (reason: Error) => void;
};

class AuditWorkerClient {
  private worker: Worker | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;

  private ensure(): Worker {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL('../worker/audit.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      if (response.id === 0) return;
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      if (response.type === 'error') pending.reject(new Error(response.message));
      else pending.resolve(response);
    };
    this.worker.onerror = (event) => {
      const error = new Error(event.message || '审计 Worker 异常');
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    };
    return this.worker;
  }

  private send(request: RequestBody): Promise<WorkerResponse> {
    const worker = this.ensure();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ ...request, id } as WorkerRequest);
    });
  }

  async generate(config: DatasetConfig): Promise<{ dataset: Dataset; analysis: DatasetAnalysis }> {
    const response = await this.send({ type: 'generate', config });
    if (response.type !== 'generated') throw new Error('生成响应类型不正确');
    return { dataset: response.dataset, analysis: response.analysis };
  }

  async analyze(dataset: Dataset): Promise<DatasetAnalysis> {
    const response = await this.send({ type: 'analyze', dataset });
    if (response.type !== 'analyzed') throw new Error('分析响应类型不正确');
    return response.analysis;
  }

  async fingerprint(dataset: Dataset): Promise<string> {
    const response = await this.send({ type: 'fingerprint', dataset });
    if (response.type !== 'fingerprint') throw new Error('指纹响应类型不正确');
    return response.digest;
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}

export const auditWorker = new AuditWorkerClient();
