import { useMemo, useState } from 'react';
import { Database, FileSpreadsheet, Search, RotateCcw } from 'lucide-react';
import { useApp } from '../store/AppStore';
import { PageHeader, Stat, SectionCard } from '../components/Page';
import { Badge } from '../components/Badge';
import { formatCount } from '../lib/money';
import { shortHash } from '../core/hash';
import { DEFAULT_CONFIG } from '../core/sample';
import type { DatasetConfig } from '../types/domain';

export function BatchesPage() {
  const { dataset, generate, reset, analysis, materials } = useApp();
  const [tab, setTab] = useState<'batches' | 'dictionary' | 'rules'>('batches');
  const [query, setQuery] = useState('');
  const [config, setConfig] = useState<DatasetConfig>(DEFAULT_CONFIG);

  if (!dataset) {
    return <div className="content"><div className="empty">载入中…</div></div>;
  }

  const batches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return dataset.batches;
    return dataset.batches.filter((batch) =>
      [batch.id, batch.role, batch.fileName, batch.sourceVersion, batch.note].join(' ').toLowerCase().includes(q),
    );
  }, [dataset.batches, query]);

  const dictionary = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return dataset.dictionary;
    return dataset.dictionary.filter((entry) =>
      [entry.code, entry.label, entry.sourceTable, entry.description].join(' ').toLowerCase().includes(q),
    );
  }, [dataset.dictionary, query]);

  return (
    <div className="content">
      <PageHeader
        kicker="Source catalog"
        title="批次目录"
        lead={
          <>
            记录文件批次、字段字典与来源版本。批次带有 SHA-256 指纹与生效状态；更正批次单独追加，
            不覆盖原始文件。材料包的 manifest 会引用这些批次号，保证可回溯。
          </>
        }
        actions={
          <div className="row">
            <button className="btn" onClick={() => generate(config)}><RotateCcw size={14} /> 按当前配置重建样例</button>
            <button className="btn" onClick={reset}>恢复默认样例</button>
          </div>
        }
      />

      <div className="grid cols-4">
        <Stat label="批次总数" value={dataset.batches.length} hint={`更正批次 ${dataset.batches.filter((batch) => batch.status === '更正批次').length}`} />
        <Stat label="字段条目" value={dataset.dictionary.length} hint={`字典版本 ${dataset.meta.versions.dictionary}`} />
        <Stat label="来源行数" value={formatCount(dataset.settlements.length + dataset.hits.length + dataset.qualifications.length + dataset.conclusions.length)} hint="结算 + 命中 + 资质 + 结论" />
        <Stat label="规则目录" value={dataset.rules.length} hint="规则库快照" accent="blue" />
      </div>

      <div className="card mt-16">
        <div className="card-head">
          <div className="tabs" style={{ marginBottom: 0 }}>
            <button className={`tab ${tab === 'batches' ? 'on' : ''}`} onClick={() => setTab('batches')}>文件批次</button>
            <button className={`tab ${tab === 'dictionary' ? 'on' : ''}`} onClick={() => setTab('dictionary')}>字段字典</button>
            <button className={`tab ${tab === 'rules' ? 'on' : ''}`} onClick={() => setTab('rules')}>规则目录</button>
          </div>
          <div className="spacer row">
            <div style={{ position: 'relative', width: 240 }}>
              <Search size={14} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--muted-2)' }} />
              <input
                type="search"
                placeholder="搜索批次 / 字段 / 规则"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                style={{ paddingLeft: 30 }}
              />
            </div>
          </div>
        </div>

        {tab === 'batches' ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>批次</th><th>用途</th><th>文件</th><th>来源版本</th><th className="num">行数</th><th>状态</th><th>摘要</th></tr>
              </thead>
              <tbody>
                {batches.map((batch) => (
                  <tr key={batch.id}>
                    <td>
                      <div className="mono">{batch.id}</div>
                      <div className="tiny muted">{batch.importedAt.slice(0, 10)}</div>
                    </td>
                    <td>
                      <Badge tone={batch.role === '更正批次' ? 'warn' : 'outline'}>{batch.role}</Badge>
                    </td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <FileSpreadsheet size={13} style={{ color: 'var(--muted)' }} />
                        <span className="mono tiny">{batch.fileName}</span>
                      </div>
                      <div className="tiny muted ellipsis" style={{ maxWidth: 280 }}>{batch.note}</div>
                    </td>
                    <td className="mono tiny">{batch.sourceVersion}</td>
                    <td className="num">{formatCount(batch.rowCount)}</td>
                    <td>
                      <Badge tone={batch.status === '生效' ? 'ok' : batch.status === '已被更正' ? 'mute' : 'warn'}>
                        {batch.status}
                      </Badge>
                    </td>
                    <td className="hash">{shortHash(batch.sha256, 14)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {tab === 'dictionary' ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>字段</th><th>名称</th><th>类型</th><th>必填</th><th>来源表</th><th>口径说明</th><th>示例</th><th>版本</th></tr>
              </thead>
              <tbody>
                {dictionary.map((entry) => (
                  <tr key={entry.code}>
                    <td className="mono nowrap">{entry.code}</td>
                    <td>{entry.label}</td>
                    <td className="tiny mono">{entry.dataType}</td>
                    <td>{entry.required ? <Badge tone="ok">必填</Badge> : <Badge tone="mute">可选</Badge>}</td>
                    <td className="tiny">{entry.sourceTable}</td>
                    <td className="tiny" style={{ maxWidth: 340 }}>{entry.description}</td>
                    <td className="mono tiny">{entry.example}</td>
                    <td className="tiny mono">{entry.version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {tab === 'rules' ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>编码</th><th>规则</th><th>严重度</th><th>适用项目</th><th>命中数</th><th>条款</th></tr>
              </thead>
              <tbody>
                {dataset.rules.map((rule) => (
                  <tr key={rule.code}>
                    <td className="mono">{rule.code}</td>
                    <td>{rule.name}<div className="tiny muted">{rule.description}</div></td>
                    <td><Badge tone={rule.severity === '高' ? 'bad' : rule.severity === '中' ? 'warn' : 'mute'}>{rule.severity}</Badge></td>
                    <td className="tiny mono">{rule.itemCodes.join(' / ')}</td>
                    <td className="num">{formatCount(analysis?.ruleCounts[rule.code] ?? 0)}</td>
                    <td className="tiny" style={{ maxWidth: 360 }}>{rule.clause}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <div className="grid split mt-16">
        <SectionCard title="来源版本对照" desc="当前分析使用的各来源版本号。">
          <dl className="kv">
            <dt>数据集</dt><dd className="mono">{dataset.meta.datasetId}</dd>
            <dt>结算明细</dt><dd className="mono">{dataset.meta.versions.settlement}</dd>
            <dt>规则命中</dt><dd className="mono">{dataset.meta.versions.ruleHit}</dd>
            <dt>资质快照</dt><dd className="mono">{dataset.meta.versions.qualification}</dd>
            <dt>处理结论</dt><dd className="mono">{dataset.meta.versions.conclusion}</dd>
            <dt>字段字典</dt><dd className="mono">{dataset.meta.versions.dictionary}</dd>
            <dt>更正次数</dt><dd>{dataset.meta.correctionCount}</dd>
          </dl>
          <div className="callout mt-12" style={{ fontSize: 11.5 }}>
            来源版本用于材料 manifest 与离线审阅器的来源清单；更正批次不会改变旧版本号，只追加新版本。
          </div>
        </SectionCard>

        <SectionCard title="样例生成参数" desc="在 Worker 内重建确定性样例数据（会清空已封存材料）。">
          <div className="grid cols-2" style={{ gap: 12 }}>
            <div className="field">
              <label>结算行数量</label>
              <input
                type="number"
                min={10}
                max={5000}
                value={config.rowCount}
                onChange={(event) => setConfig({ ...config, rowCount: Number(event.target.value) })}
              />
            </div>
            <div className="field">
              <label>随机种子</label>
              <input
                type="number"
                value={config.seed}
                onChange={(event) => setConfig({ ...config, seed: Number(event.target.value) })}
              />
            </div>
            <div className="field">
              <label>异常率（0-1）</label>
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={config.anomalyRate}
                onChange={(event) => setConfig({ ...config, anomalyRate: Number(event.target.value) })}
              />
            </div>
            <div className="field">
              <label>待结论行配额</label>
              <input
                type="number"
                min={0}
                value={config.pendingConclusions}
                onChange={(event) => setConfig({ ...config, pendingConclusions: Number(event.target.value) })}
              />
            </div>
          </div>
          <div className="row mt-12">
            <button className="btn primary" onClick={() => generate(config)} disabled={analysis?.totals.rowCount === config.rowCount && dataset.meta.seed === config.seed}>
              <Database size={14} /> 重建批次
            </button>
            <button className="btn" onClick={() => generate(DEFAULT_CONFIG)}><RotateCcw size={14} /> 重置为默认参数</button>
          </div>
          <p className="tiny muted mt-8">
            生成在 Web Worker 中执行，避免阻塞界面；结果写入 IndexedDB，材料与事件会被清空。
          </p>
        </SectionCard>
      </div>

      <SectionCard title="材料来源引用" desc="已封存材料对批次的引用（来自 manifest）。">
        {materials.length === 0 ? (
          <div className="small muted">尚未封存材料。</div>
        ) : (
          <div className="stack tight" style={{ fontSize: 12 }}>
            {materials.slice(0, 4).map((material) => (
              <div className="row between" key={material.id}>
                <span className="mono">{material.id}</span>
                <span className="tiny muted">
                  {material.manifest.map((entry) => entry.batchId).join(' · ')}
                </span>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
