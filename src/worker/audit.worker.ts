/// <reference lib="webworker" />
import type { Dataset, DatasetAnalysis, DatasetConfig } from '../types/domain';
import { analyzeDataset } from '../core/analysis';
import { DEFAULT_CONFIG, generateDataset } from '../core/sample';
import { digestOf } from '../core/hash';

export type WorkerRequest =
  | { id: number; type: 'generate'; config: DatasetConfig }
  | { id: number; type: 'analyze'; dataset: Dataset }
  | { id: number; type: 'fingerprint'; dataset: Dataset };

export type WorkerResponse =
  | { id: number; type: 'generated'; dataset: Dataset; analysis: DatasetAnalysis }
  | { id: number; type: 'analyzed'; analysis: DatasetAnalysis }
  | { id: number; type: 'fingerprint'; digest: string }
  | { id: number; type: 'error'; message: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    switch (request.type) {
      case 'generate': {
        const dataset = generateDataset({ ...DEFAULT_CONFIG, ...request.config });
        const analysis = analyzeDataset(dataset);
        const response: WorkerResponse = { id: request.id, type: 'generated', dataset, analysis };
        scope.postMessage(response);
        break;
      }
      case 'analyze': {
        const analysis = analyzeDataset(request.dataset);
        const response: WorkerResponse = { id: request.id, type: 'analyzed', analysis };
        scope.postMessage(response);
        break;
      }
      case 'fingerprint': {
        const response: WorkerResponse = {
          id: request.id,
          type: 'fingerprint',
          digest: digestOf(request.dataset.settlements),
        };
        scope.postMessage(response);
        break;
      }
      default:
        throw new Error('未知的 Worker 指令');
    }
  } catch (error) {
    const response: WorkerResponse = {
      id: request.id,
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
    scope.postMessage(response);
  }
};

scope.postMessage({ id: 0, type: 'fingerprint', digest: 'ready' } satisfies WorkerResponse);
