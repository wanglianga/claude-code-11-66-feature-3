import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Scale,
  ShieldAlert,
  FileCheck2,
  Layers,
  AlertTriangle,
  CheckCircle2,
  Database,
} from 'lucide-react';
import { useApp } from '../store/AppStore';
import { PageHeader, Stat, SectionCard } from '../components/Page';
import { Badge } from '../components/Badge';
import { formatCents, formatCount, formatPercent } from '../lib/money';
import { shortHash } from '../core/hash';

export function DashboardPage() {
  const { dataset, analysis, materials, scopeRows, events, setScope, scope } = useApp();

  const topRules = useMemo(() => {
    if (!analysis) return [];
    return dataset!.rules
      .map((rule) => ({ rule, count: analysis.ruleCounts[rule.code] ?? 0 }))
      .sort((a, b) => b.count - a.count);
  }, [analysis, dataset]);

  const maxRuleCount = Math.max(1, ...topRules.map((item) => item.count));

  const multiHitRows = useMemo(() => {
    if (!analysis) return [];
    return analysis.rows
      .filter((row) => row.hits.length >= 2)
      .sort((a, b) => b.hits.length - a.hits.length || b.row.paymentAmountCents - a.row.paymentAmountCents)
      .slice(0, 6);
  }, [analysis]);

  const pendingRows = useMemo(() => {
    if (!analysis) return [];
    return analysis.rows
      .filter((row) => row.qualification.status === 'gap' || row.qualification.status === 'overlap' || row.qualification.status === 'inactive')
      .slice(0, 6);
  }, [analysis]);

  if (!dataset || !analysis) {
    return (
      <div className="content">
        <PageHeader title="工作台总览" lead="尚未载入批次数据。" />
        <div className="card"><div className="empty">等待初始化…</div></div>
      </div>
    );
  }

  const totals = analysis.totals;
  const dedupeSavings = totals.duplicatedHintCents;
  const lastEvent = events[0];

  return (
    <div className="content">
      <PageHeader
        kicker="Audit Evidence Desk"
        title="稽核工作台总览"
        lead={
          <>
            面向 {dataset.meta.province} {formatCount(totals.rowCount)} 条结算明细的离线复核。一条结算行只计一次支付金额；
            规则命中、资质依据与处理结论作为可回查的子记录；材料封存后不再被后续更正改写。
          </>
        }
        actions={
          <>
            <Link className="btn" to="/ledger">进入明细核对</Link>
            <Link className="btn primary" to="/scope">
              冻结范围材料 <ArrowRight size={15} />
            </Link>
          </>
        }
      />

      <div className="grid cols-4">
        <Stat
          label="结算行"
          value={formatCount(totals.rowCount)}
          hint={`${dataset.meta.datasetId} · ${dataset.meta.versions.settlement}`}
        />
        <Stat
          label="支付金额（去重）"
          value={`¥${formatCents(totals.paymentCents)}`}
          hint="按结算行唯一计额，命中不叠加"
          accent="teal"
          small
        />
        <Stat
          label="规则命中"
          value={formatCount(totals.hitCount)}
          hint={`影响 ${formatCount(Object.keys(analysis.ruleCounts).length)} 类规则`}
          accent="blue"
        />
        <Stat
          label="待核 / 待结论"
          value={formatCount(totals.pendingRows)}
          hint={`资质待核 ${totals.pendingReviewRows} 行 · 空档 ${totals.gapRows} · 重叠 ${totals.overlapRows}`}
          accent="amber"
        />
      </div>

      <div className="grid cols-3 mt-16">
        <div className="card">
          <div className="card-body">
            <div className="row between">
              <div className="row" style={{ gap: 8 }}>
                <Scale size={17} style={{ color: 'var(--teal)' }} />
                <b className="small">金额口径核对</b>
              </div>
              <Badge tone="ok">行口径</Badge>
            </div>
            <div className="mt-12" style={{ fontSize: 12.5 }}>
              <div className="row between" style={{ padding: '4px 0' }}>
                <span className="muted">结算行主表合计</span>
                <span className="num strong">¥{formatCents(totals.paymentCents)}</span>
              </div>
              <div className="row between" style={{ padding: '4px 0' }}>
                <span className="muted">若按命中摊平累加</span>
                <span className="num" style={{ color: 'var(--red)' }}>
                  ¥{formatCents(totals.paymentCents + dedupeSavings)}
                </span>
              </div>
              <div className="row between" style={{ padding: '4px 0', borderTop: '1px dashed var(--line)', marginTop: 4 }}>
                <span className="muted">剔除重复计额</span>
                <span className="num" style={{ color: 'var(--teal)' }}>¥{formatCents(dedupeSavings)}</span>
              </div>
            </div>
            <div className="callout mt-12" style={{ fontSize: 11.5 }}>
              摊平后再汇总会把同一行的支付金额按命中次数重复计入；本台以结算行为唯一计额单位。
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-body">
            <div className="row between">
              <div className="row" style={{ gap: 8 }}>
                <ShieldAlert size={17} style={{ color: 'var(--amber)' }} />
                <b className="small">规则命中分布</b>
              </div>
              <Link className="btn ghost sm" to="/ledger">明细</Link>
            </div>
            <div className="mt-12 stack tight">
              {topRules.map(({ rule, count }) => (
                <div key={rule.code}>
                  <div className="row between" style={{ fontSize: 12 }}>
                    <span>
                      <span className="mono">{rule.code}</span> {rule.name}
                    </span>
                    <span className="num muted">{count}</span>
                  </div>
                  <div className="bar-track" style={{ marginTop: 3 }}>
                    <div
                      className={`bar-fill ${rule.severity === '高' ? 'red' : rule.severity === '中' ? 'amber' : ''}`}
                      style={{ width: `${(count / maxRuleCount) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-body">
            <div className="row between">
              <div className="row" style={{ gap: 8 }}>
                <FileCheck2 size={17} style={{ color: 'var(--blue)' }} />
                <b className="small">材料与批次状态</b>
              </div>
              <Link className="btn ghost sm" to="/materials">材料库</Link>
            </div>
            <div className="mt-12" style={{ fontSize: 12.5 }}>
              <div className="row between" style={{ padding: '4px 0' }}>
                <span className="muted">已封存材料</span>
                <span className="strong">{materials.length} 份</span>
              </div>
              <div className="row between" style={{ padding: '4px 0' }}>
                <span className="muted">来源批次</span>
                <span>{dataset.batches.length} 个</span>
              </div>
              <div className="row between" style={{ padding: '4px 0' }}>
                <span className="muted">更正批次</span>
                <span>{dataset.batches.filter((batch) => batch.status === '更正批次').length} 个</span>
              </div>
              <div className="row between" style={{ padding: '4px 0' }}>
                <span className="muted">当前材料范围</span>
                <span>{scopeRows.length === totals.rowCount ? '全量' : `${formatCount(scopeRows.length)} 行`}</span>
              </div>
            </div>
            <div className="divider" style={{ margin: '10px 0' }} />
            <div className="tiny muted">
              最近事件：{lastEvent ? `${lastEvent.title}（${lastEvent.at.slice(0, 16).replace('T', ' ')}）` : '暂无'}
            </div>
          </div>
        </div>
      </div>

      <div className="grid split mt-16">
        <SectionCard
          title="多规则命中 · 金额只计一次"
          desc="以下几行同时命中多条规则，每条命中均可独立解释，但支付金额只在行主表计一次。"
          actions={<Link className="btn sm" to="/ledger">查看全部</Link>}
          bodyStyle={{ padding: 0 }}
          noBody
        >
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>结算行</th>
                  <th>机构 / 项目</th>
                  <th>命中</th>
                  <th className="num">支付金额</th>
                  <th>复核</th>
                </tr>
              </thead>
              <tbody>
                {multiHitRows.map((item) => (
                  <tr key={item.row.id}>
                    <td className="mono nowrap">{item.row.id}</td>
                    <td>
                      <div>{item.row.institutionName}</div>
                      <div className="tiny muted">{item.row.itemName}</div>
                    </td>
                    <td>
                      <div className="pill-row">
                        {item.hits.map((hit) => (
                          <Badge key={hit.id} tone={hit.severity === '高' ? 'bad' : hit.severity === '中' ? 'warn' : 'mute'}>
                            {hit.ruleCode}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="num">¥{formatCents(item.row.paymentAmountCents)}</td>
                    <td>
                      <Badge tone={item.reviewState === '已复核' ? 'ok' : item.reviewState === '待核' ? 'bad' : 'warn'}>
                        {item.reviewState}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <SectionCard
          title="待核线索"
          desc="资质重叠、空档或状态异常的行，材料中一律不指定唯一版本。"
          actions={
            <button
              className="btn sm"
              onClick={() => setScope({ ...scope, onlyPending: true })}
            >
              只看待核
            </button>
          }
          bodyStyle={{ padding: 0 }}
          noBody
        >
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>结算行</th>
                  <th>资质状态</th>
                  <th>机构</th>
                </tr>
              </thead>
              <tbody>
                {pendingRows.map((item) => (
                  <tr key={item.row.id}>
                    <td className="mono nowrap">{item.row.id}</td>
                    <td>
                      <Badge tone={item.qualification.status === 'inactive' ? 'warn' : 'bad'}>
                        {item.qualification.label}
                      </Badge>
                    </td>
                    <td className="ellipsis">{item.row.institutionName}</td>
                  </tr>
                ))}
                {pendingRows.length === 0 ? (
                  <tr><td colSpan={3}><div className="empty">暂无待核行</div></td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>

      <div className="grid cols-3 mt-16">
        <SectionCard title="样例数据来源" desc="已脱敏，可直接演算">
          <dl className="kv">
            <dt>数据集</dt><dd className="mono">{dataset.meta.datasetId}</dd>
            <dt>省域</dt><dd>{dataset.meta.province}</dd>
            <dt>随机种子</dt><dd className="mono">{dataset.meta.seed}</dd>
            <dt>结构版本</dt><dd className="mono">{dataset.meta.schemaVersion}</dd>
            <dt>生成时间</dt><dd>{dataset.meta.generatedAt}</dd>
          </dl>
        </SectionCard>
        <SectionCard title="来源批次版本" desc="目录中的批次与字段字典">
          <div className="stack tight">
            {Object.entries(dataset.meta.versions).map(([key, version]) => (
              <div className="row between" key={key} style={{ fontSize: 12 }}>
                <span className="muted">{LABELS[key] ?? key}</span>
                <span className="mono tiny">{version}</span>
              </div>
            ))}
          </div>
          <Link className="btn ghost sm mt-8" to="/batches">
            <Database size={14} /> 打开批次目录
          </Link>
        </SectionCard>
        <SectionCard title="口径自检" desc="实际样例演算结果">
          <div className="stack tight" style={{ fontSize: 12.5 }}>
            <div className="row" style={{ gap: 6 }}>
              <CheckCircle2 size={14} style={{ color: 'var(--teal)' }} />
              待核行不指定唯一资质版本
            </div>
            <div className="row" style={{ gap: 6 }}>
              <CheckCircle2 size={14} style={{ color: 'var(--teal)' }} />
              命中提示金额不进入汇总
            </div>
            <div className="row" style={{ gap: 6 }}>
              <CheckCircle2 size={14} style={{ color: 'var(--teal)' }} />
              已封存材料不随更正改变
            </div>
            <div className="row" style={{ gap: 6 }}>
              <AlertTriangle size={14} style={{ color: 'var(--amber)' }} />
              平均每行 {formatPercent(totals.hitCount / Math.max(1, totals.rowCount), 0)} 命中率
            </div>
            <div className="row" style={{ gap: 6 }}>
              <Layers size={14} style={{ color: 'var(--blue)' }} />
              快照证据 {dataset.qualifications.length} 份
            </div>
          </div>
          <div className="tiny muted mt-12">
            条目摘要 <span className="hash">{shortHash(dataset.batches[0]?.sha256 ?? '', 18)}</span>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

const LABELS: Record<string, string> = {
  settlement: '结算明细',
  ruleHit: '规则命中',
  qualification: '资质快照',
  conclusion: '处理结论',
  dictionary: '字段字典',
};
