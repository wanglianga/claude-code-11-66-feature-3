import { sha256 } from '@noble/hashes/sha2';

/** 稳定序列化：对象键排序、数组保序，保证材料摘要在浏览器、Worker 与 Node 一致。 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const parts = keys
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${parts.join(',')}}`;
}

const encoder = new TextEncoder();

export function sha256Hex(input: string): string {
  const digest = sha256(encoder.encode(input));
  let out = '';
  for (const byte of digest) out += byte.toString(16).padStart(2, '0');
  return out;
}

export function digestOf(value: unknown): string {
  return sha256Hex(stableStringify(value));
}

/** 可读的短摘要，用于界面展示来源指纹。 */
export function shortHash(hash: string, length = 12): string {
  return hash.slice(0, length);
}
