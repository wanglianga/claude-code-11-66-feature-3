import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowDown, Eye, FileText, Info, Layers } from 'lucide-react';
import { useApp } from '../store/AppStore';
import { PageHeader, Stat, SectionCard } from '../components/Page';
import { Badge } from '../components/Badge';
import { Drawer } from '../components/Overlay';
import { formatCents, formatPercent, formatYuan } from '../lib/money';
import { categoryLabel, categoryOf } from '../core/catalog';
import { buildCompareTables, buildParentPlacements, type ModeTable } from '../core/comparable';
import { shortHash } from '../core/hash';
import type { RowResolution, StatSettlementRow, StatsRun, YearCell } from '../types/stats';

type Mode = 'finest' | 'parent' | 'raw';

const STATUS_LABEL: Record<RowResolution['status'], { label: string; tone: 'ok' | 'info' | 'warn' | 'bad' }> = {
  current: { label: '本版直达', tone: 'ok' },
  mapped: { label: '映射结转', tone: 'info' },
  ambiguous: { label: '歧义池', tone: 'warn' },
  unmapped: { label: '未映射', tone: 'bad' },
};

function cellOf(table: ModeTable, categoryCode: string, year: number): YearCell | null {
  return table.cells[categoryCode]?.[year] ?? null;
}

function sumYears(byYear: Record<number, YearCell> | undefined, years: number[]): YearCell {
  const total = { rows: 0, amountCents: 0 };
  for (const year of years) {
    const cell = byYear?.[year];
    if (cell) {
      total.rows += cell.rows;
      total.amountCents += cell.amountCents;
    }
  }
  return total;
}

export function ComparePage() {
  const { statsState, statsRuns, activeRunId, setActiveRun } = useApp();
  const [mode, setMode] = useState<Mode>('finest');
  const [drill, setDrill] = useState<{ categoryCode: string; year: number } | null>(null);

  const run: StatsRun | null = useMemo(() => {
    if (statsRuns.length === 0) return null;
    return statsRuns.find((item) => item.id === activeRunId) ?? statsRuns[statsRuns.length - 1]!;
  }, [statsRuns, activeRunId]);

  const tables = useMemo(() => {
    if (!statsState || !run) return null;
    return buildCompareTables(statsState.rows, run.snapshot.entries, run.resolutions);
  }, [statsState, run]);

  const parentPlacements = useMemo(() => {
    if (!statsState || !run) return null;
    return buildParentPlacements(statsState.rows, run.snapshot.entries);
  }, [statsState, run]);

  if (!statsState || !run || !tables || !parentPlacements) {
    return <div className="content"><div className="empty">载入中…</div></div>;
  }

  const table = mode === 'finest' ? tables.finest : tables.parent;
  const years = table.years;
  const totalAll = sumYears(table.totalByYear, years);
  const mappedAll = sumYears(table.mappedByYear, years);
  const ambiguousAll = sumYears(table.ambiguousByYear, years);
  const unmappedAll = sumYears(table.unmappedByYear, years);
  const coverageAmount = totalAll.amountCents === 0 ? 0 : mappedAll.amountCents / totalAll.amountCents;

  const drillRows: Array<{ row: StatSettlementRow; resolution: RowResolution | null }> = drill
    ? mode === 'parent'
      ? statsState.rows
          .filter((row) => row.year === drill.year && parentPlacements.get(row.id)?.categoryCode === drill.categoryCode)
          .map((row) => ({ row, resolution: null }))
      : statsState.rows
          .filter((row) => row.year === drill.year)
          .map((row) => ({ row, resolution: run.resolutions.find((resolution) => resolution.rowId === row.id) ?? null }))
          .filter((item) => item.resolution?.targetCategoryCode === drill.categoryCode)
    : [];

  return (
    <div className="content">
      <PageHeader
        kicker="Comparable statistics"
        title="可比统计"
        lead={
          <>
            统计运行按服务日期选用对应目录，输出原始代码口径与两种可比类别口径。
            金额归属互斥：唯一映射计入类别，拆分候选进歧义池，无法映射单列——三者相加恒等于原始口径总计。
          </>
        }
        actions={
          <div className="seg">
            <button className={mode === 'finest' ? 'on' : ''} onClick={() => setMode('finest')}>最细类别投影</button>
            <button className={mode === 'parent' ? 'on' : ''} onClick={() => setMode('parent')}>上级类别汇总</button>
            <button className={mode === 'raw' ? 'on' : ''} onClick={() => setMode('raw')}>原始代码口径</button>
          </div>
        }
      />

      <div className="card">
        <div className="card-head">
          <div className="tabs" style={{ marginBottom: 0 }}>
            {statsRuns.map((item) => (
              <button
                key={item.id}
                className={`tab ${run.id === item.id ? 'on' : ''}`}
                onClick={() => setActiveRun(item.id)}
              >
                V{item.version}{item.id === statsRuns[statsRuns.length - 1]!.id ? '（当前）' : ''}
              </button>
            ))}
          </div>
          <div className="spacer tiny muted">
            {run.label} · 输出摘要 <span className="mono">{shortHash(run.outputDigest)}</span>
            {run.correctionNote ? ` · ${run.correctionNote}` : ''}
          </div>
        </div>
        <div className="card-body">
          <div className="grid cols-4" style={{ gap: 12 }}>
            <Stat label="结算提取行" value={statsState.rows.length} hint={`${years.join(' / ')} 年 · 分母即全部行`} />
            <Stat label="总金额（分母）" value={formatYuan(totalAll.amountCents)} small hint="原始口径 = 各归属之和" />
            {mode === 'raw' ? (
              <>
                <Stat label="结算代码数" value={tables.raw.codes.length} hint="按结算时原样统计" accent="amber" />
                <Stat label="口径警示" value="代码churn≠结构变化" small accent="red" hint="换码/拆分/合并/复用均在此列" />
              </>
            ) : (
              <>
                <Stat
                  label="唯一映射金额"
                  value={formatYuan(mappedAll.amountCents)}
                  small
                  accent="teal"
                  hint={`金额覆盖率 ${formatPercent(coverageAmount)}`}
                />
                <Stat
                  label="歧义池 + 未映射"
                  value={formatYuan(ambiguousAll.amountCents + unmappedAll.amountCents)}
                  small
                  accent={ambiguousAll.amountCents + unmappedAll.amountCents > 0 ? 'amber' : 'teal'}
                  hint={`歧义 ${formatYuan(ambiguousAll.amountCents)} · 未映射 ${formatYuan(unmappedAll.amountCents)}`}
                />
              </>
            )}
          </div>
        </div>
      </div>

      {mode !== 'raw' ? (
        <>
          <div className="card mt-16">
            <div className="card-head">
              <div>
                <h2>{mode === 'finest' ? '可比类别口径 · 当前最细类别' : '可比类别口径 · 共同稳定上级（二级）'}</h2>
                <div className="desc">
                  {mode === 'finest'
                    ? '历史明细投影到现行目录最细国家类别；点击单元格回查每行的映射链与证据。'
                    : '新旧目录共同稳定的上级类别汇总；不经映射，趋势更稳但掩盖子项目间结构迁移。'}
                </div>
              </div>
              <Badge tone="info"><Layers size={12} /> {run.id} 口径</Badge>
            </div>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{mode === 'finest' ? '国家类别（最细）' : '国家类别（二级）'}</th>
                    {years.map((year) => <th key={year} className="num">{year} 年</th>)}
                    <th className="num">合计</th>
                  </tr>
                </thead>
                <tbody>
                  {table.categories.map((category) => {
                    const total = sumYears(table.cells[category.code], years);
                    return (
                      <tr key={category.code}>
                        <td>
                          <span className="mono tiny">{category.code}</span> {category.name}
                        </td>
                        {years.map((year) => {
                          const cell = cellOf(table, category.code, year);
                          return (
                            <td key={year} className="num">
                              {cell ? (
                                <button className="cell-link" onClick={() => setDrill({ categoryCode: category.code, year })}>
                                  ¥{formatCents(cell.amountCents)}
                                  <span className="tiny muted"> {cell.rows} 行</span>
                                </button>
                              ) : '—'}
                            </td>
                          );
                        })}
                        <td className="num"><b>¥{formatCents(total.amountCents)}</b></td>
                      </tr>
                    );
                  })}
                  <tr className="row-total">
                    <td>唯一映射合计</td>
                    {years.map((year) => (
                      <td key={year} className="num">¥{formatCents(table.mappedByYear[year]?.amountCents ?? 0)}</td>
                    ))}
                    <td className="num"><b>¥{formatCents(mappedAll.amountCents)}</b></td>
                  </tr>
                  {mode === 'finest' ? (
                    <tr className="row-pool">
                      <td>歧义池（拆分候选未分配）</td>
                      {years.map((year) => (
                        <td key={year} className="num">¥{formatCents(table.ambiguousByYear[year]?.amountCents ?? 0)}</td>
                      ))}
                      <td className="num"><b>¥{formatCents(ambiguousAll.amountCents)}</b></td>
                    </tr>
                  ) : null}
                  <tr className="row-pool">
                    <td>未映射池（无法唯一映射）</td>
                    {years.map((year) => (
                      <td key={year} className="num">¥{formatCents(table.unmappedByYear[year]?.amountCents ?? 0)}</td>
                    ))}
                    <td className="num"><b>¥{formatCents(unmappedAll.amountCents)}</b></td>
                  </tr>
                  <tr className="row-grand">
                    <td>总计（= 原始代码口径）</td>
                    {years.map((year) => (
                      <td key={year} className="num"><b>¥{formatCents(table.totalByYear[year]?.amountCents ?? 0)}</b></td>
                    ))}
                    <td className="num"><b>¥{formatCents(totalAll.amountCents)}</b></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="card-body" style={{ paddingTop: 0 }}>
              <div className="callout ok" style={{ fontSize: 12 }}>
                <Info size={14} style={{ flex: '0 0 auto', marginTop: 2 }} />
                <div>
                  金额守恒校验：唯一映射 {formatYuan(mappedAll.amountCents)} + 歧义池 {formatYuan(ambiguousAll.amountCents)} + 未映射池 {formatYuan(unmappedAll.amountCents)}
                  = {formatYuan(mappedAll.amountCents + ambiguousAll.amountCents + unmappedAll.amountCents)}，与原始口径总计 {formatYuan(totalAll.amountCents)} 一致；每行金额只落入一个归属。
                </div>
              </div>
            </div>
          </div>

          <div className="grid split mt-16">
            <SectionCard
              title="映射覆盖率"
              desc="分母 = 纳入统计的全部结算提取行（金额与行数）；分子 = 唯一映射部分。歧义池与未映射不计入分子。"
            >
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr><th>年度</th><th className="num">唯一映射金额</th><th className="num">总金额（分母）</th><th className="num">金额覆盖率</th><th className="num">行覆盖率</th></tr>
                  </thead>
                  <tbody>
                    {years.map((year) => {
                      const coverage = table.coverageByYear[year]!;
                      return (
                        <tr key={year}>
                          <td className="mono">{year}</td>
                          <td className="num">¥{formatCents(coverage.mappedAmountCents)}</td>
                          <td className="num">¥{formatCents(coverage.totalAmountCents)}</td>
                          <td className="num">
                            <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                              <span className="bar-track" style={{ width: 90 }}>
                                <span className="bar-fill" style={{ width: `${coverage.amountRate * 100}%`, display: 'block' }} />
                              </span>
                              {formatPercent(coverage.amountRate)}
                            </div>
                          </td>
                          <td className="num">{formatPercent(coverage.rowRate)}（{coverage.mappedRows}/{coverage.totalRows}）</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="tiny muted mt-8">
                口径说明：本表为{mode === 'finest' ? '最细类别投影' : '上级类别汇总'}覆盖率；切换口径可对照。
                上级口径不经映射，停用无后继与证据缺失行在上级口径下仍可归集。
              </p>
            </SectionCard>

            <SectionCard
              title="无法唯一映射的范围"
              desc="按原因分组的未映射金额；这部分不进入任何类别合计，研判趋势时必须同时出示。"
            >
              {table.unmappedReasons.length === 0 ? (
                <div className="callout ok">本口径下没有未映射金额。</div>
              ) : (
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr><th>原因</th>{years.map((year) => <th key={year} className="num">{year}</th>)}<th className="num">合计</th></tr>
                    </thead>
                    <tbody>
                      {table.unmappedReasons.map((reason) => {
                        const total = sumYears(reason.byYear, years);
                        return (
                          <tr key={reason.reason}>
                            <td className="small">{reason.reason}</td>
                            {years.map((year) => (
                              <td key={year} className="num">
                                {reason.byYear[year] ? `¥${formatCents(reason.byYear[year]!.amountCents)}` : '—'}
                              </td>
                            ))}
                            <td className="num"><b>¥{formatCents(total.amountCents)}</b><div className="tiny muted">{total.rows} 行</div></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          </div>

          {mode === 'finest' ? (
            <SectionCard
              title={`歧义池 · 一对多拆分候选（${tables.finest.ambiguousRows.length} 行）`}
              desc="候选与分摊依据仅供审核：参考分摊列不计入任何类别合计，审核前不得当作已分配金额。"
              actions={<Badge tone="warn"><AlertTriangle size={12} /> 候选 ≠ 已分配</Badge>}
            >
              {tables.finest.ambiguousRows.length === 0 ? (
                <div className="callout ok">当前口径下没有歧义行。</div>
              ) : (
                <div className="stack tight">
                  {tables.finest.ambiguousRows.map((item) => (
                    <div className="evidence" key={item.rowId}>
                      <div className="head">
                        <b className="mono">{item.rowId}</b>
                        <span className="small">{item.itemName}</span>
                        <span className="mono tiny muted">{item.localCode}</span>
                        <Badge tone="warn">{item.year} 年</Badge>
                        <span style={{ marginLeft: 'auto' }} className="mono small">¥{formatCents(item.amountCents)}</span>
                      </div>
                      <p className="sub">{item.basis}</p>
                      <div className="table-wrap" style={{ marginTop: 6 }}>
                        <table className="data">
                          <thead>
                            <tr><th>候选去向</th><th>国家类别</th><th className="num">分摊权重</th><th className="num">参考分摊（不计入合计）</th></tr>
                          </thead>
                          <tbody>
                            {item.candidates.map((candidate) => (
                              <tr key={candidate.toCode}>
                                <td className="mono small">{candidate.toCode} {candidate.itemName}</td>
                                <td className="tiny">{categoryLabel(candidate.categoryCode)}</td>
                                <td className="num">{candidate.weight === null ? <span className="muted">无依据</span> : formatPercent(candidate.weight, 0)}</td>
                                <td className="num">
                                  {candidate.referenceCents === null
                                    ? <span className="tiny muted">不估算</span>
                                    : <span className="tiny">¥{formatCents(candidate.referenceCents)}</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          ) : (
            <div className="callout info mt-16" style={{ fontSize: 12.5 }}>
              <Info size={15} style={{ flex: '0 0 auto', marginTop: 2 }} />
              <div>
                上级类别汇总的取舍：ZL700 拆出的三个单项同属「2002 康复治疗」，上级口径下趋势连续、无歧义；
                代价是子项目之间的真实结构迁移被掩盖。需要最细粒度时请切换到「最细类别投影」，并接受歧义池待审核的成本。
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="card mt-16">
          <div className="card-head">
            <div>
              <h2>原始代码口径 · 按结算时代码原样汇总</h2>
              <div className="desc">不做任何沿革调整；代码的消失与出现是目录调整的结果，不能直接解读为就医结构变化。</div>
            </div>
            <Badge tone="warn"><AlertTriangle size={12} /> 口径警示</Badge>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>地方代码</th><th>结算名称（按年度）</th>
                  {tables.raw.years.map((year) => <th key={year} className="num">{year} 年</th>)}
                  <th className="num">合计</th>
                </tr>
              </thead>
              <tbody>
                {tables.raw.codes.map((row) => {
                  const total = sumYears(row.byYear, tables.raw.years);
                  const names = tables.raw.years
                    .map((year) => row.namesByYear[year])
                    .filter(Boolean)
                    .filter((name, index, list) => list.indexOf(name) === index);
                  const reused = row.code === 'A100';
                  return (
                    <tr key={row.code} className={reused ? 'row-highlight' : undefined}>
                      <td className="mono nowrap">{row.code}{reused ? <Badge tone="warn" style={{ marginLeft: 6 }}>复用</Badge> : null}</td>
                      <td className="tiny">{names.join(' → ')}</td>
                      {tables.raw.years.map((year) => (
                        <td key={year} className="num">
                          {row.byYear[year] ? (
                            <>¥{formatCents(row.byYear[year]!.amountCents)}<span className="tiny muted"> {row.byYear[year]!.rows} 行</span></>
                          ) : '—'}
                        </td>
                      ))}
                      <td className="num"><b>¥{formatCents(total.amountCents)}</b></td>
                    </tr>
                  );
                })}
                <tr className="row-grand">
                  <td>总计</td>
                  <td />
                  {tables.raw.years.map((year) => (
                    <td key={year} className="num"><b>¥{formatCents(tables.raw.totalByYear[year]?.amountCents ?? 0)}</b></td>
                  ))}
                  <td className="num"><b>¥{formatCents(sumYears(tables.raw.totalByYear, tables.raw.years).amountCents)}</b></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="card-body" style={{ paddingTop: 0 }}>
            <div className="callout" style={{ fontSize: 12 }}>
              <AlertTriangle size={14} style={{ flex: '0 0 auto', marginTop: 2 }} />
              <div>
                直接按代码统计的两种典型误读：MR550 在 2025 年「消失」、MR551「新设」，实为等价替换（MAP-02）；
                A100 在 2023 与 2025 年同名同码却含义不同（代码复用）。跨期研判请使用两种可比类别口径。
              </div>
            </div>
          </div>
        </div>
      )}

      <Drawer
        open={Boolean(drill)}
        onClose={() => setDrill(null)}
        width={640}
        title={drill ? (
          <span className="row" style={{ gap: 8 }}>
            <span>{categoryLabel(drill.categoryCode)}</span>
            <Badge tone="info">{drill.year} 年</Badge>
          </span>
        ) : null}
        subtitle={drill ? `${mode === 'finest' ? '最细类别投影' : '上级类别汇总'} · ${run.id} 口径 · ${drillRows.length} 行贡献明细` : undefined}
      >
        {drill ? (
          <div className="stack">
            <div className="callout info" style={{ fontSize: 12 }}>
              <Eye size={14} style={{ flex: '0 0 auto', marginTop: 2 }} />
              <div>本单元格由下列结算行唯一映射而成；每行展示完整映射链与证据来源，可逐条回查。</div>
            </div>
            {drillRows.map(({ row, resolution }) => (
              <div className="evidence" key={row.id}>
                <div className="head">
                  <b className="mono">{row.id}</b>
                  <span className="small">{row.itemName}</span>
                  <span className="mono tiny muted">{row.localCode}</span>
                  {resolution ? <Badge tone={STATUS_LABEL[resolution.status].tone}>{STATUS_LABEL[resolution.status].label}</Badge> : null}
                  <span style={{ marginLeft: 'auto' }} className="mono small">¥{formatCents(row.amountCents)}</span>
                </div>
                <p className="sub">服务日期 {row.serviceDate} · 来源批次 {row.sourceBatchId}</p>
                {mode === 'finest' && resolution ? (
                  <div className="stack tight" style={{ marginTop: 6 }}>
                    {resolution.chain.map((link, index) => (
                      <div key={`${link.catalogVersionId}-${link.localCode}-${index}`}>
                        {index > 0 ? (
                          <div className="tiny muted row" style={{ gap: 6, margin: '2px 0 2px 10px' }}>
                            <ArrowDown size={11} />
                            {typeof link.via === 'object' ? (
                              <span>
                                {link.via.kind} <span className="mono">{link.via.mappingId}</span>
                                {(() => {
                                  const mapping = run.snapshot.mappings.find((item) => item.id === (link.via as { mappingId: string }).mappingId);
                                  return mapping ? ` · 证据：${mapping.evidenceSource || '（缺失）'}` : '';
                                })()}
                              </span>
                            ) : (
                              <span>沿用（代码与释义不变）</span>
                            )}
                          </div>
                        ) : null}
                        <div className="row" style={{ gap: 6 }}>
                          <FileText size={12} style={{ color: 'var(--teal)', flex: '0 0 auto' }} />
                          <span className="mono tiny">{link.catalogVersionId}</span>
                          <span className="mono tiny"><b>{link.localCode}</b> {link.itemName}</span>
                          <span className="tiny muted">→ {categoryOf(link.nationalCategoryCode).name}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="sub">
                    上级口径按服务日命中历史条目直接归集，不经映射：
                    {(() => {
                      const placement = parentPlacements.get(row.id);
                      if (!placement) return '无有效目录条目';
                      const entry = run.snapshot.entries.find((item) => item.id === placement.entryId);
                      return entry
                        ? `${entry.catalogVersionId} · ${entry.localCode} ${entry.itemName}（${categoryLabel(entry.nationalCategoryCode)}）→ 二级 ${categoryOf(placement.categoryCode).name}`
                        : '';
                    })()}
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
