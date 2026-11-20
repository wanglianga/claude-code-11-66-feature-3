import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { AuditEvent, BatchRecord, Dataset, MaterialPackage } from '../types/domain';

interface AuditDB extends DBSchema {
  datasets: {
    key: string;
    value: Dataset;
  };
  materials: {
    key: string;
    value: MaterialPackage;
    indexes: { 'by-createdAt': string };
  };
  events: {
    key: string;
    value: AuditEvent;
    indexes: { 'by-at': string };
  };
  batches: {
    key: string;
    value: BatchRecord;
  };
  meta: {
    key: string;
    value: { key: string; value: string };
  };
}

const DB_NAME = 'medaudit-evidence-desk';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<AuditDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<AuditDB>> {
  if (!dbPromise) {
    dbPromise = openDB<AuditDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore('datasets', { keyPath: 'meta.datasetId' });
        const materials = db.createObjectStore('materials', { keyPath: 'id' });
        materials.createIndex('by-createdAt', 'createdAt');
        const events = db.createObjectStore('events', { keyPath: 'id' });
        events.createIndex('by-at', 'at');
        db.createObjectStore('batches', { keyPath: 'id' });
        db.createObjectStore('meta', { keyPath: 'key' });
      },
      blocked() {
        console.warn('IndexedDB 升级被其他标签页阻塞');
      },
    });
  }
  return dbPromise;
}

export async function loadCurrentDataset(): Promise<Dataset | null> {
  const db = await getDB();
  const pointer = await db.get('meta', 'currentDataset');
  if (pointer) {
    const found = await db.get('datasets', pointer.value);
    if (found) return found;
  }
  const all = await db.getAll('datasets');
  return all.at(-1) ?? null;
}

export async function saveDataset(dataset: Dataset): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['datasets', 'meta', 'batches'], 'readwrite');
  await tx.objectStore('datasets').put(dataset);
  await tx.objectStore('meta').put({ key: 'currentDataset', value: dataset.meta.datasetId });
  for (const batch of dataset.batches) {
    await tx.objectStore('batches').put(batch);
  }
  await tx.done;
}

export async function listMaterials(): Promise<MaterialPackage[]> {
  const db = await getDB();
  const materials = await db.getAll('materials');
  return materials.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveMaterial(material: MaterialPackage): Promise<void> {
  const db = await getDB();
  await db.put('materials', material);
}

export async function listEvents(): Promise<AuditEvent[]> {
  const db = await getDB();
  const events = await db.getAll('events');
  return events.sort((a, b) => b.at.localeCompare(a.at));
}

export async function saveEvent(event: AuditEvent): Promise<void> {
  const db = await getDB();
  await db.put('events', event);
}

export async function getMeta(key: string): Promise<string | null> {
  const db = await getDB();
  const entry = await db.get('meta', key);
  return entry?.value ?? null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  const db = await getDB();
  await db.put('meta', { key, value });
}

export async function resetAll(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['datasets', 'materials', 'events', 'batches', 'meta'], 'readwrite');
  await Promise.all([
    tx.objectStore('datasets').clear(),
    tx.objectStore('materials').clear(),
    tx.objectStore('events').clear(),
    tx.objectStore('batches').clear(),
    tx.objectStore('meta').clear(),
  ]);
  await tx.done;
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const estimate = await navigator.storage.estimate();
  return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
}
