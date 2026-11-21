import { useMemo } from 'react';
import type { QualificationStatus, ReviewState, Severity, ConclusionCode } from '../types/domain';

export type BadgeTone = 'ok' | 'warn' | 'bad' | 'info' | 'mute' | 'outline';

type Variant = { tone: BadgeTone; label: string };

export function useBadge() {
  return useMemo(
    () => ({
      review(state: ReviewState): Variant {
        const tone: BadgeTone = state === '已复核' ? 'ok' : state === '待核' ? 'bad' : 'warn';
        return { tone, label: state };
      },
      qualification(status: QualificationStatus, label?: string): Variant {
        const tone: BadgeTone = status === 'ok' ? 'ok' : status === 'inactive' ? 'warn' : 'bad';
        return { tone, label: label ?? status };
      },
      severity(level: Severity): Variant {
        const tone: BadgeTone = level === '高' ? 'bad' : level === '中' ? 'warn' : 'mute';
        return { tone, label: `严重度 ${level}` };
      },
      conclusion(code: ConclusionCode | null): Variant {
        if (!code) return { tone: 'mute', label: '无结论' };
        const tone: BadgeTone = code === '合规' ? 'ok' : code === '违规' ? 'bad' : code === '整改' ? 'warn' : 'info';
        return { tone, label: code };
      },
    }),
    [],
  );
}

export function Badge({
  tone,
  children,
  style,
}: {
  tone: BadgeTone;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <span className={`badge ${tone}`} style={style}>
      {children}
    </span>
  );
}
