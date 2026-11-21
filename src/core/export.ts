import { strToU8, zipSync } from 'fflate';
import type { MaterialPackage } from '../types/domain';
import { materialToJsonFiles } from './material';
import { buildOfflineViewerHtml } from './offlineViewer';
import { stableStringify } from './hash';

export interface ExportBundle {
  fileName: string;
  blob: Blob;
  entries: string[];
  size: number;
}

/** 生成可复核数据包：ZIP 内含 index.html 离线审阅器、主表、证据表、清单与校验信息。 */
export function buildReviewBundle(material: MaterialPackage): ExportBundle {
  const files: Record<string, Uint8Array> = {};
  for (const file of materialToJsonFiles(material)) {
    files[file.name] = strToU8(file.content);
  }
  files['index.html'] = strToU8(buildOfflineViewerHtml(material));
  files['sources.json'] = strToU8(
    stableStringify({
      datasetId: material.datasetId,
      scope: material.scope,
      scopeHash: material.scopeHash,
      manifest: material.manifest,
      correction: material.correction,
      basisPackageId: material.basisPackageId,
    }),
  );

  const zipped = zipSync(files, { level: 6, mtime: new Date(material.createdAt) });
  const blob = new Blob([zipped], { type: 'application/zip' });
  return {
    fileName: `${material.id}.zip`,
    blob,
    entries: Object.keys(files).sort(),
    size: blob.size,
  };
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadText(content: string, fileName: string, type = 'application/json'): void {
  downloadBlob(new Blob([content], { type }), fileName);
}
