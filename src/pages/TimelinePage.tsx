import { useMemo, useState } from 'react';
import { History, Download, ShieldCheck, RefreshCw } from 'lucide-react';
import { useApp } from '../store/AppStore';
import { PageHeader, Stat, SectionCard } from '../components/Page';
import { Badge } from '../components/Badge';
import { downloadText } from '../core/export';
import { stableStringify } from '../core/hash';
import { formatCount, formatCents } from '../lib/money';

const KIND_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'info' | 'mute' | 'outline'> = {
  初始化: 'mute',
  导入: 'info',
  冻结: 'ok',
  更正: 'warn',
  校验: 'outline',
  导出: 'outline',
};

export function TimelinePage() {
  const { events, materials, dataset, analysis, pushEvent, toast, reset } = useApp();
  const [filter, setFilter] = useState<string>('');

  const filtered = useMemo(() => {
    if (!filter) return events;
    return events.filter((event) => event.kind === filter);
  }, [events, filter]);

  const kinds = useMemo(() => ['冻结', '更正', '导出', '导入', '初始化'], []);

  const exportLog = () => {
    downloadText(
      JSON.stringify({ exportedAt: new Date().toISOString(), events }, null, 2),
      `audit-log-${new Date().toISOString().slice(0, 10)}.json`,
    );
    toast('处理日志已导出');
  };

  const exportSnapshot = () => {
    if (!analysis || !dataset) return;
    downloadText(
      stableStringify({
        dataset: dataset.meta,
        totals: analysis.totals,
        materials: materials.map((material) => ({
          id: material.id,
          version: material.version,
          rowCount: material.rowCount,
          totals: material.totals,
          verification: material.verification.passed,
          basisPackageId: material.basisPackageId,
          correction: material.correction,
        })),
      }),
      `audit-snapshot-${new Date().toISOString().slice(0, 10)}.json`,
    );
    toast('核对快照已导出');
  };

  const verifyAll = async () => {
    await pushEvent({
      kind: '校验',
      title: `人工复核触发 · ${materials.length} 份材料`,
      detail: materials.length
        ? `逐份材料校验状态：${materials.map((material) => `${material.id}=${material.verification.passed ? '通过' : '未通过'}`).join('，')}`
        : '尚无封存材料。',
    });
    toast(materials.length ? '已记录一次校验事件' : '尚无材料可校验', materials.length ? 'info' : 'warn');
  };

  return (
    <div className="content">
      <PageHeader
        kicker="Audit trail"
        title="处理日志"
        lead={
          <>
            记录导入、冻结、更正、导出与校验事件。事件只追加不修改，用于说明当前工作区中每份材料是怎么来的。
            日志保存在本机 IndexedDB，可导出为 JSON 随材料一并归档。
          </>
        }
        actions={
          <>
            <button className="btn" onClick={verifyAll}><ShieldCheck size={14} /> 记录一次校验</button>
            <button className="btn" onClick={exportSnapshot}>导出核对快照</button>
            <button className="btn" onClick={exportLog}><Download size={14} /> 导出日志</button>
          </>
        }
      />

      <div className="grid cols-4">
        <Stat label="事件总数" value={events.length} hint="只追加" />
        <Stat label="冻结事件" value={events.filter((event) => event.kind === '冻结').length} accent="teal" />
        <Stat label="更正事件" value={events.filter((event) => event.kind === '更正').length} accent="amber" />
        <Stat label="已有材料" value={materials.length} accent="blue" hint="封存版本" />
      </div>

      <div className="grid split mt-16">
        <SectionCard
          title="事件流"
          desc={`按时间倒序，共 ${filtered.length} 条。`}
          actions={
            <div className="seg">
              <button className={filter === '' ? 'on' : ''} onClick={() => setFilter('')}>全部</button>
              {kinds.map((kind) => (
                <button key={kind} className={filter === kind ? 'on' : ''} onClick={() => setFilter(kind)}>
                  {kind}
                </button>
              ))}
            </div>
          }
        >
          {filtered.length === 0 ? (
            <div className="small muted">没有匹配的事件。</div>
          ) : (
            <div className="timeline">
              {filtered.map((event) => (
                <div
                  className={`timeline-item ${event.kind === '更正' ? 'warn' : event.kind === '导入' || event.kind === '初始化' ? 'info' : ''}`}
                  key={event.id}
                >
                  <div className="timeline-dot" />
                  <div className="timeline-body">
                    <div className="row" style={{ gap: 8 }}>
                      <span className="title">{event.title}</span>
                      <Badge tone={KIND_TONE[event.kind] ?? 'outline'}>{event.kind}</Badge>
                    </div>
                    <div className="meta">{event.at.replace('T', ' ')} · {event.id}</div>
                    <div className="detail">{event.detail}</div>
                    {event.materialId ? <div className="tiny mono muted">材料：{event.materialId}</div> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <div className="stack">
          <SectionCard title="工作区状态" desc="当前分析口径（仅用于生成新材料）。">
            {analysis && dataset ? (
              <dl className="kv">
                <dt>结算行</dt><dd>{formatCount(analysis.totals.rowCount)}</dd>
                <dt>支付金额</dt><dd>¥{formatCents(analysis.totals.paymentCents)}</dd>
                <dt>规则命中</dt><dd>{formatCount(analysis.totals.hitCount)}</dd>
                <dt>待核 / 待结论</dt><dd>{formatCount(analysis.totals.pendingRows)}</dd>
                <dt>更正次数</dt><dd>{dataset.meta.correctionCount}</dd>
                <dt>数据版本</dt><dd className="mono tiny">{dataset.meta.versions.settlement}</dd>
              </dl>
            ) : (
              <div className="small muted">未载入。</div>
            )}
            <div className="callout info mt-12" style={{ fontSize: 11.5 }}>
              工作区口径变化不会回写已封存材料；材料金额只在其封存时确定。
            </div>
          </SectionCard>

          <SectionCard title="维护操作" desc="仅影响本地工作区。">
            <button className="btn block" onClick={reset}>
              <RefreshCw size={14} /> 重置工作区（清空材料与日志）
            </button>
            <p className="tiny muted mt-8">
              重置会重新载入默认样例批次，已导出到磁盘的材料包不受影响。
            </p>
          </SectionCard>

          <SectionCard title="归档建议" desc="离线复核交付物建议包含：">
            <div className="stack tight" style={{ fontSize: 12 }}>
              <div className="row" style={{ gap: 7 }}><History size={13} /> 材料 ZIP（含离线审阅器与校验信息）</div>
              <div className="row" style={{ gap: 7 }}><ShieldCheck size={13} /> 处理日志 JSON</div>
              <div className="row" style={{ gap: 7 }}><Download size={13} /> 核对快照 JSON</div>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
