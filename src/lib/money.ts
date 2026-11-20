const formatter = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compact = new Intl.NumberFormat('zh-CN');

/** 金额以“分”存储，显示为元；不参与任何浮点运算。 */
export function formatCents(cents: number): string {
  return formatter.format(cents / 100);
}

export function formatYuan(cents: number): string {
  return `¥${formatCents(cents)}`;
}

export function formatCount(value: number): string {
  return compact.format(value);
}

export function formatPercent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function yuanToCents(yuan: string): number {
  const normalized = yuan.trim().replace(/[,¥\s]/g, '');
  if (!/^-?\d+(\.\d{0,2})?$/.test(normalized)) {
    throw new Error(`金额格式不正确：${yuan}`);
  }
  const negative = normalized.startsWith('-');
  const [whole, fraction = ''] = normalized.replace('-', '').split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return negative ? -cents : cents;
}

export function diffCents(next: number, prev: number): string {
  const delta = next - prev;
  if (delta === 0) return '0.00';
  return `${delta > 0 ? '+' : '-'}${formatCents(Math.abs(delta))}`;
}
