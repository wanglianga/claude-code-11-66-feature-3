import { useMemo, useState } from 'react';
import { BookOpen, GitCommitVertical, Repeat2 } from 'lucide-react';
import { useApp } from '../store/AppStore';
import { PageHeader, Stat, SectionCard } from '../components/Page';
import { Badge } from '../components/Badge';
import { categoryLabel, categoryOf, categoryPath, NATIONAL_CATEGORIES } from '../core/catalog';
import { findEntryAt } from '../core/comparable';
import type { CatalogEntry } from '../types/stats';

const YEARS = [2023, 2024, 2025];

function toneOf(categoryCode: string): 'info' | 'ok' | 'warn' {
  const root = categoryPath(categoryCode)[0]!;
  if (root.code === '10') return 'info';
  if (root.code === '20') return 'ok';
  return 'warn';
}

export function CatalogPage() {
  const { statsState } = useApp();
  const [tab, setTab] = useState<string>('CAT-2025');

  const entriesByCatalog = useMemo(() => {
    if (!statsState) return new Map<string, CatalogEntry[]>();
    const map = new Map<string, CatalogEntry[]>();
    for (const catalog of statsState.catalogs) {
      map.set(
        catalog.id,
        statsState.entries
          .filter((entry) => entry.catalogVersionId === catalog.id)
          .sort((a, b) => a.localCode.localeCompare(b.localCode)),
      );
    }
    return map;
  }, [statsState]);

  /** 代码时间线：每个地方代码在各年度命中的目录条目（按服务日分段）。 */
  const timeline = useMemo(() => {
    if (!statsState) return [];
    const codes = [...new Set(statsState.entries.map((entry) => entry.localCode))].sort();
    return codes.map((code) => {
      const segments = YEARS.map((year) => {
        const entry = findEntryAt(statsState.entries, code, `${year}-06-01`);
        return { year, entry };
      });
      const categories = new Set(segments.map((segment) => segment.entry?.nationalCategoryCode).filter(Boolean));
      const names = new Set(segments.map((segment) => segment.entry?.itemName).filter(Boolean));
      return {
        code,
        segments,
        reused: categories.size > 1,
        renamed: categories.size === 1 && names.size > 1,
      };
    });
  }, [statsState]);

  if (!statsState) {
    return <div className="content"><div className="empty">载入中…</div></div>;
  }

  const reusedCount = timeline.filter((row) => row.reused).length;
  const currentEntries = entriesByCatalog.get(tab) ?? [];

  return (
    <div className="content">
      <PageHeader
        kicker="Catalog lineage"
        title="目录沿革"
        lead={
          <>
            三版地方目录按适用区间生效；同一地方代码在不同有效期可被重新赋义（代码复用）。
            统计一律按<b>服务发生日</b>命中对应区间的条目释义，不用现行释义回填历史。
          </>
        }
      />

      <div className="grid cols-4">
        <Stat label="目录版本" value={statsState.catalogs.length} hint={statsState.catalogs.map((catalog) => catalog.id).join(' / ')} />
        <Stat label="目录条目" value={statsState.entries.length} hint={`现行 ${statsState.entries.filter((entry) => entry.status === '现行').length} 条`} />
        <Stat label="映射关系" value={statsState.mappings.length} hint={`证据缺失 ${statsState.mappings.filter((mapping) => mapping.evidenceStatus === '缺失').length} 条`} accent="blue" />
        <Stat label="代码复用" value={reusedCount} hint="同代码多段释义（A100）" accent="amber" />
      </div>

      <div className="card mt-16">
        <div className="card-head">
          <div className="tabs" style={{ marginBottom: 0 }}>
            {statsState.catalogs.map((catalog) => (
              <button
                key={catalog.id}
                className={`tab ${tab === catalog.id ? 'on' : ''}`}
                onClick={() => setTab(catalog.id)}
              >
                {catalog.id.slice(4)} 版{catalog.effectiveTo === null ? '（现行）' : ''}
              </button>
            ))}
          </div>
          <div className="spacer tiny muted">
            {statsState.catalogs.find((catalog) => catalog.id === tab)?.note}
          </div>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>地方代码</th><th>项目名称</th><th>国家项目类别</th><th>释义</th><th>适用区间</th><th>状态</th><th>备注</th>
              </tr>
            </thead>
            <tbody>
              {currentEntries.map((entry) => (
                <tr key={entry.id}>
                  <td className="mono nowrap">{entry.localCode}</td>
                  <td>{entry.itemName}</td>
                  <td>
                    <Badge tone={toneOf(entry.nationalCategoryCode)}>{categoryLabel(entry.nationalCategoryCode)}</Badge>
                    <div className="tiny muted">
                      {categoryPath(entry.nationalCategoryCode).map((category) => category.name).join(' / ')}
                    </div>
                  </td>
                  <td className="tiny" style={{ maxWidth: 240 }}>{entry.definition}</td>
                  <td className="mono tiny nowrap">{entry.validFrom} ~ {entry.validTo ?? '长期'}</td>
                  <td>{entry.status === '现行' ? <Badge tone="ok">现行</Badge> : <Badge tone="mute">停用</Badge>}</td>
                  <td className="tiny muted" style={{ maxWidth: 260 }}>{entry.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid split mt-16">
        <SectionCard
          title="代码时间线（按服务日分段释义）"
          desc="每个地方代码在各年度命中的国家类别；A100 为代码复用样例：2023 与 2025 是不同项目。"
        >
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>地方代码</th>
                  {YEARS.map((year) => <th key={year}>{year} 年</th>)}
                  <th>沿革标记</th>
                </tr>
              </thead>
              <tbody>
                {timeline.map((row) => (
                  <tr key={row.code} className={row.reused ? 'row-highlight' : undefined}>
                    <td className="mono nowrap">{row.code}</td>
                    {row.segments.map((segment) => (
                      <td key={segment.year}>
                        {segment.entry ? (
                          <>
                            <Badge tone={toneOf(segment.entry.nationalCategoryCode)}>
                              {categoryOf(segment.entry.nationalCategoryCode).name}
                            </Badge>
                            <div className="tiny muted">{segment.entry.itemName}</div>
                          </>
                        ) : (
                          <span className="tiny muted">— 无有效条目</span>
                        )}
                      </td>
                    ))}
                    <td>
                      {row.reused ? <Badge tone="warn"><Repeat2 size={11} /> 代码复用</Badge> : null}
                      {row.renamed ? <Badge tone="info">更名</Badge> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="callout info mt-12" style={{ fontSize: 12 }}>
            <GitCommitVertical size={15} style={{ flex: '0 0 auto', marginTop: 2 }} />
            <div>
              代码 <b>A100</b> 在 2023 版释义为「红外线治疗」（200101 光疗与热疗），2024 年停用，
              2025 版重新赋义为「中医定向透药治疗」（300101 中医外治）。统计按服务发生日分段：
              2023 年的 A100 结算归入物理治疗，2025 年的归入中医治疗，互不回填。
            </div>
          </div>
        </SectionCard>

        <SectionCard title="国家项目类别（稳定主干）" desc="跨目录版本保持不变，是两种可比口径的共同锚点。">
          <div className="stack tight">
            {NATIONAL_CATEGORIES.filter((category) => category.level === 1).map((root) => (
              <div key={root.code}>
                <div className="row" style={{ gap: 7 }}>
                  <BookOpen size={13} style={{ color: 'var(--teal)' }} />
                  <b className="mono small">{root.code}</b>
                  <b className="small">{root.name}</b>
                </div>
                <div style={{ paddingLeft: 20 }}>
                  {NATIONAL_CATEGORIES.filter((category) => category.parentCode === root.code).map((level2) => (
                    <div key={level2.code} style={{ marginTop: 6 }}>
                      <div className="row" style={{ gap: 6 }}>
                        <span className="mono tiny">{level2.code}</span>
                        <span className="small">{level2.name}</span>
                        <Badge tone="outline">上级汇总层级</Badge>
                      </div>
                      <div className="tiny muted" style={{ paddingLeft: 12 }}>
                        {NATIONAL_CATEGORIES.filter((category) => category.parentCode === level2.code)
                          .map((leaf) => `${leaf.code} ${leaf.name}`)
                          .join('；')}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
