/** 本地时间 ISO 字符串，带时区偏移，便于材料封存时间可读可追溯。 */
export function nowLocalIso(date: Date = new Date()): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return `${new Date(date.getTime() + offset * 60000).toISOString().slice(0, 19)}${sign}${pad(offset / 60)}:${pad(offset % 60)}`;
}
