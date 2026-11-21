import { useMemo, useState } from 'react';
import { GitCompareArrows, History, Play, RotateCcw, ShieldCheck } from 'lucide-react';
import { useApp } from '../store/AppStore';
import { PageHeader, Stat, SectionCard } from '../components/Page';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Overlay';
import { formatCents, formatCount, formatYuan } from '../lib/money';
import { categoryLabel, CORRECTION_BATCH_ID } from '../core/catalog';
import { diffRuns, replayRun } from '../core/comparable';
import { shortHash } from '../core/hash';

export function RunsPage() {
  const { statsState, statsRuns, applyStatsCorrection, resetStats, setActiveRun, toast } = useApp();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pair, setPair] = useState<{ base: string; compare: string } | null>(null);

  const applied = statsState?.correctionsApplied.includes(CORRECTION_BATCH_ID) ?? false;

  const effectivePair = useMemo(() => {
    if (pair) return pair;
    if (statsRuns.length >= 2) {
      return { base: statsRuns[statsRuns.length - 2]!.id, compare: statsRuns[statsRuns.length - 1]!.id };
    }
    return null;
  }, [pair, statsRuns]);

  const diff = useMemo(() => {
    if (!statsState || !effectivePair) return null;
    const base = statsRuns.find((run) => run.id === effectivePair.base);
    const compare = statsRuns.find((run) => run.id === effectivePair.compare);
    if (!base || !compare || base.id === compare.id) return null;
    return diffRuns(base, compare, statsState.rows);
  }, [statsState, statsRuns, effectivePair]);

  const replays = useMemo(() => {
    if (!statsState) return new Map<string, boolean>();
    return new Map(statsRuns.map((run) => [run.id, replayRun(run, statsState.rows).ok]));
  }, [statsState, statsRuns]);

  if (!statsState) {
    return <div className="content"><div className="empty">载入中…</div></div>;
  }

  const latest = statsRuns[statsRuns.length - 1]!;
  const totalAmount = statsState.rows.reduce((acc, row) => acc + row.amountCents, 0);

  const selectPair = (baseId: string, compareId: string) => {
    setPair({ base: baseId, compare: compareId });
  };

  return (
    <div className="content">
      <PageHeader
        kicker="Run versions"
        title="统计版本"
        lead={
          <>
            每次统计运行冻结输入快照（目录 + 映射）与输出摘要；目录更正只重建涉及代码和期间的新版本，
            旧版本封存可复现。当前共 {statsRuns.length} 个版本。
          </>
        }
        actions={
          <div className="row">
            <button className="btn" onClick={resetStats}><RotateCcw size={14} /> 恢复默认样例</button>
            <button className="btn primary" onClick={() => setConfirmOpen(true)} disabled={applied}>
              <Play size={14} /> {applied ? '目录更正已应用' : '应用目录更正 B-CAT-C1'}
            </button>
          </div>
        }
      />

      <div className="grid cols-4">
        <Stat label="统计版本" value={statsRuns.length} hint={`当前 V${latest.version}`} />
        <Stat label="结算提取行" value={formatCount(statsState.rows.length)} hint={`总金额 ${formatYuan(totalAmount)}`} />
        <Stat label="目录更正批次" value={statsState.correctionsApplied.length} accent={applied ? 'teal' : 'amber'} hint={applied ? CORRECTION_BATCH_ID : '待应用'} />
        <Stat
          label="复现校验"
          value={statsRuns.every((run) => replays.get(run.id)) ? '全部通过' : '存在失败'}
          accent={statsRuns.every((run) => replays.get(run.id)) ? 'teal' : 'red'}
          hint="冻结输入重算 = 封存输出"
        />
      </div>

      <div className="card mt-16">
        <div className="card-head">
          <div>
            <h2>运行版本台账</h2>
            <div className="desc">输出摘要由行级解析结果计算；任何一版都可用其冻结输入复现。</div>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>版本</th><th>生成时间</th><th>输入摘要（目录+映射 / 结算行）</th><th>输出摘要</th><th>更正说明</th><th>影响范围</th><th>复现</th><th></th>
              </tr>
            </thead>
            <tbody>
              {statsRuns.map((run) => (
                <tr key={run.id}>
                  <td>
                    <b className="mono">V{run.version}</b>{' '}
                    {run.id === latest.id ? <Badge tone="ok">当前</Badge> : <Badge tone="mute">历史</Badge>}
                  </td>
                  <td className="tiny mono nowrap">{run.createdAt.slice(0, 19)}</td>
                  <td className="hash">{shortHash(run.catalogDigest)}<br />{shortHash(run.rowsDigest)}</td>
                  <td className="hash">{shortHash(run.outputDigest)}</td>
                  <td className="tiny" style={{ maxWidth: 220 }}>{run.correctionNote ?? '基线口径'}</td>
                  <td className="tiny" style={{ maxWidth: 220 }}>
                    {run.affectedScope ? (
                      <>
                        代码 {run.affectedScope.codes.join('、')}<br />
                        期间 {run.affectedScope.years.join('、')} · 重算 {run.affectedScope.changedRowIds.length} 行 · 沿用 {run.carriedOverRows} 行
                      </>
                    ) : (
                      <span className="muted">首版全量</span>
                    )}
                  </td>
                  <td>
                    {replays.get(run.id) ? <Badge tone="ok"><ShieldCheck size={11} /> 可复现</Badge> : <Badge tone="bad">不一致</Badge>}
                  </td>
                  <td>
                    <button className="btn sm" onClick={() => { setActiveRun(run.id); toast(`已切换到 V${run.version} 口径，请前往「可比统计」查看`); }}>
                      查看口径
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid split mt-16">
        <SectionCard
          title="版本差异"
          desc="对比两个版本：仅受影响代码与期间的统计被重建，其余行逐字一致。"
          actions={
            statsRuns.length >= 2 ? (
              <div className="seg">
                <button
                  className={pair ? 'on' : ''}
                  onClick={() => selectPair(statsRuns[statsRuns.length - 2]!.id, latest.id)}
                >
                  V{statsRuns[statsRuns.length - 2]!.version} → V{latest.version}
                </button>
              </div>
            ) : undefined
          }
        >
          {statsRuns.length < 2 ? (
            <div className="empty">
              <History size={28} className="icon" />
              <div>应用目录更正 B-CAT-C1 后，这里展示 V1 → V2 的差异。</div>
            </div>
          ) : !diff ? (
            <div className="empty">选择上方版本对进行比较。</div>
          ) : (
            <div className="stack tight">
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <Badge tone="info"><GitCompareArrows size={12} /> {diff.baseRunId} → {diff.compareRunId}</Badge>
                <Badge tone="warn">变化 {diff.changedRows.length} 行</Badge>
                <Badge tone="ok">逐字沿用 {diff.unchangedRows} 行</Badge>
                <Badge tone="mute">涉及代码 {diff.affectedCodes.join('、')}</Badge>
                <Badge tone="mute">期间 {diff.affectedYears.join('、')}</Badge>
              </div>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr><th>最细类别</th><th className="num">年度</th><th className="num">V{statsRuns.find((run) => run.id === diff.baseRunId)!.version} 金额</th><th className="num">V{statsRuns.find((run) => run.id === diff.compareRunId)!.version} 金额</th><th className="num">差额</th></tr>
                  </thead>
                  <tbody>
                    {diff.categoryDeltas.map((delta) => (
                      <tr key={`${delta.categoryCode}-${delta.year}`}>
                        <td className="small">{categoryLabel(delta.categoryCode)}</td>
                        <td className="num mono">{delta.year}</td>
                        <td className="num">¥{formatCents(delta.beforeCents)}</td>
                        <td className="num">¥{formatCents(delta.afterCents)}</td>
                        <td className="num" style={{ color: delta.deltaCents > 0 ? 'var(--teal)' : 'var(--red)' }}>
                          {delta.deltaCents > 0 ? '+' : ''}¥{formatCents(Math.abs(delta.deltaCents))}
                        </td>
                      </tr>
                    ))}
                    {diff.categoryDeltas.length === 0 ? (
                      <tr><td colSpan={5} className="empty">最细类别口径无金额变化。</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <div className="callout ok" style={{ fontSize: 12 }}>
                <ShieldCheck size={14} style={{ flex: '0 0 auto', marginTop: 2 }} />
                <div>
                  上级类别汇总口径：{diff.parentDeltas.length === 0
                    ? '本次更正不影响上级汇总（XL100 类别修正发生在同一二级类别内部，QT500 证据补齐前已可按历史条目归集）。'
                    : `${diff.parentDeltas.length} 个单元格变化。`}
                  未涉及行 {diff.unchangedRows} 行逐字沿用旧版，证明「只重建涉及代码和期间」。
                </div>
              </div>
            </div>
          )}
        </SectionCard>

        <SectionCard title="统计模块批次" desc="目录版本、映射批次、结算提取与更正批次（含 SHA-256 指纹）。">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>批次</th><th>用途</th><th className="num">行数</th><th>状态</th><th>摘要</th></tr>
              </thead>
              <tbody>
                {statsState.batches.map((batch) => (
                  <tr key={batch.id}>
                    <td>
                      <div className="mono small">{batch.id}</div>
                      <div className="tiny muted">{batch.importedAt.slice(0, 10)}</div>
                    </td>
                    <td><Badge tone={batch.role === '更正批次' ? 'warn' : 'outline'}>{batch.role}</Badge></td>
                    <td className="num">{formatCount(batch.rowCount)}</td>
                    <td><Badge tone={batch.status === '生效' ? 'ok' : 'warn'}>{batch.status}</Badge></td>
                    <td className="hash">{shortHash(batch.sha256, 14)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="callout info mt-12" style={{ fontSize: 12 }}>
            更正批次只追加、不改写：V1 的输入快照保持冻结，随时可在「可比统计」页切换回旧口径查看。
          </div>
        </SectionCard>
      </div>

      <Modal
        open={confirmOpen}
        title={`应用目录更正 ${CORRECTION_BATCH_ID}`}
        onClose={() => setConfirmOpen(false)}
        footer={
          <>
            <button className="btn" onClick={() => setConfirmOpen(false)}>取消</button>
            <button
              className="btn primary"
              onClick={async () => {
                setConfirmOpen(false);
                await applyStatsCorrection();
              }}
            >
              确认应用并重建统计版本
            </button>
          </>
        }
      >
        <div className="stack tight" style={{ fontSize: 13 }}>
          <p>本次更正包含两项内容（只影响涉及代码与期间）：</p>
          <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
            <li>补录 MAP-06（QT500→QT501）正式证据文件，证据状态转为「齐全」，2023–2024 年 QT500 金额由「未映射」转入「电疗与磁疗」。</li>
            <li>XL100 国家类别由误录的 100302（脑电与脑功能检查）修正为 100301（心电检查），影响 XL100 及合并链上的 XL101 / XL102。</li>
          </ol>
          <div className="callout" style={{ fontSize: 12 }}>
            涉及代码：QT500、QT501、XL100、XL101、XL102。其余代码与期间的统计结果逐字沿用 V1，旧版本封存可复现。
          </div>
        </div>
      </Modal>
    </div>
  );
}
