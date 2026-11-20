import { useMemo, useState } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';
import { useApp } from '../store/AppStore';
import { PageHeader } from '../components/Page';
import { Badge } from '../components/Badge';
import { RowDetailDrawer } from '../components/RowDetailDrawer';
import { filterRows } from '../core/analysis';
import { formatCents, formatCount } from '../lib/money';
import type { ReviewState, Severity } from '../types/domain';

type SortKey = 'rowNumber' | 'payment' | 'hits' | 'date';

export function LedgerPage() {
  const { analysis, scope, setScope, dataset, scopeRows } = useApp();
  const [query, setQuery] = useState('');
  const [state, setState] = useState<ReviewState | ''>('');
  const [severity, setSeverity] = useState<Severity | ''>('');
  const [minHits, setMinHits] = useState(0);
  const [sort, setSort] = useState<SortKey>('rowNumber');
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = useMemo(() => {
    let list = scopeRows;
    if (state) list = list.filter((item) => item.reviewState === state);
    if (severity) list = list.filter((item) => item.hits.some((hit) => hit.severity === severity));
    if (minHits > 0) list = list.filter((item) => item.hits.length >= minHits);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((item) => {
        const hay = [
          item.row.id,
          item.row.institutionName,
          item.row.institutionCode,
          item.row.itemName,
          item.row.itemCode,
          item.row.poolingAreaName,
          item.row.personRef,
          ...item.hits.map((hit) => hit.ruleCode),
        ].join(' ').toLowerCase();
        return hay.includes(q);
      });
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sort) {
        case 'payment':
          return b.row.paymentAmountCents - a.row.paymentAmountCents;
        case 'hits':
          return b.hits.length - a.hits.length;
        case 'date':
          return a.row.serviceDate.localeCompare(b.row.serviceDate);
        default:
          return a.row.rowNumber - b.row.rowNumber;
      }
    });
    return sorted;
  }, [scopeRows, state, severity, minHits, query, sort]);

  const pageSum = useMemo(() => rows.reduce((acc, item) => acc + item.row.paymentAmountCents, 0), [rows]);
  const open = openId ? analysis?.byId[openId] ?? null : null;
  const active = analysis!;

  return (
    <div className="content">
      <PageHeader
        title="稽核明细"
        lead={
          <>
            按结算行逐条核对。金额只在行级计一次；点击任意行展开规则命中、资质快照与处理结论。
            当前列表继承范围冻结页的筛选条件{scope.onlyPending ? '（仅待核）' : ''}。
          </>
        }
        actions={
          <div className="row">
            <span className="badge outline">{formatCount(rows.length)} 行</span>
            <span className="badge ok">合计 ¥{formatCents(pageSum)}</span>
          </div>
        }
      />

      <div className="card">
        <div className="card-body">
          <div className="toolbar">
            <div className="grow" style={{ position: 'relative' }}>
              <Search size={15} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--muted-2)' }} />
              <input
                type="search"
                placeholder="搜索结算行、机构、项目、人员或规则编码"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                style={{ paddingLeft: 32 }}
              />
            </div>
            <select value={state} onChange={(event) => setState(event.target.value as ReviewState | '')} style={{ width: 150 }}>
              <option value="">复核状态：全部</option>
              <option value="已复核">已复核</option>
              <option value="待核">待核</option>
              <option value="待结论">待结论</option>
            </select>
            <select value={severity} onChange={(event) => setSeverity(event.target.value as Severity | '')} style={{ width: 140 }}>
              <option value="">严重度：全部</option>
              <option value="高">高</option>
              <option value="中">中</option>
              <option value="低">低</option>
            </select>
            <div className="seg">
              {[0, 2, 3].map((value) => (
                <button key={value} className={minHits === value ? 'on' : ''} onClick={() => setMinHits(value)}>
                  {value === 0 ? '全部' : `≥${value} 命中`}
                </button>
              ))}
            </div>
            <div className="seg">
              {(
                [
                  ['rowNumber', '行号'],
                  ['payment', '金额'],
                  ['hits', '命中数'],
                  ['date', '日期'],
                ] as Array<[SortKey, string]>
              ).map(([key, label]) => (
                <button key={key} className={sort === key ? 'on' : ''} onClick={() => setSort(key)}>
                  {label}
                </button>
              ))}
            </div>
            <span className="muted small row" style={{ gap: 6 }}>
              <SlidersHorizontal size={14} />
              {scope.onlyPending ? '仅待核' : `${formatCount(scopeRows.length)} / ${formatCount(active.totals.rowCount)}`}
              {scope.onlyPending ? (
                <button className="btn sm" onClick={() => setScope({ ...scope, onlyPending: false })}>取消</button>
              ) : null}
            </span>
          </div>
        </div>
      </div>

      <div className="card mt-16" style={{ overflow: 'hidden' }}>
        <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 310px)' }}>
          <table className="data">
            <thead>
              <tr>
                <th className="num">行</th>
                <th>结算行</th>
                <th>服务日</th>
                <th>项目</th>
                <th>机构 / 统筹区</th>
                <th className="num">支付金额</th>
                <th>规则命中</th>
                <th>资质</th>
                <th>复核</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr
                  key={item.row.id}
                  className={`clickable ${openId === item.row.id ? 'selected' : ''}`}
                  onClick={() => setOpenId(item.row.id)}
                >
                  <td className="num muted">{item.row.rowNumber - 1}</td>
                  <td className="mono nowrap">{item.row.id}</td>
                  <td className="nowrap">{item.row.serviceDate}</td>
                  <td>
                    <div>{item.row.itemName}</div>
                    <div className="tiny muted mono">{item.row.itemCode}</div>
                  </td>
                  <td>
                    <div>{item.row.institutionName}</div>
                    <div className="tiny muted">{item.row.poolingAreaName}</div>
                  </td>
                  <td className="num">¥{formatCents(item.row.paymentAmountCents)}</td>
                  <td>
                    <div className="pill-row">
                      {item.hits.length === 0 ? <span className="tiny muted">无</span> : null}
                      {item.hits.map((hit) => (
                        <Badge key={hit.id} tone={hit.severity === '高' ? 'bad' : hit.severity === '中' ? 'warn' : 'mute'}>
                          {hit.ruleCode}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td>
                    <Badge tone={item.qualification.status === 'ok' ? 'ok' : item.qualification.status === 'inactive' ? 'warn' : 'bad'}>
                      {item.qualification.label}
                    </Badge>
                  </td>
                  <td>
                    <Badge tone={item.reviewState === '已复核' ? 'ok' : item.reviewState === '待核' ? 'bad' : 'warn'}>
                      {item.reviewState}
                    </Badge>
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    <div className="empty">没有匹配的结算行，调整筛选或取消范围限制。</div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <p className="tiny muted mt-8">
        共 {formatCount(rows.length)} 行，页面合计 ¥{formatCents(pageSum)}（按行唯一计额）。命中标签数 {rows.reduce((acc, item) => acc + item.hits.length, 0)} 条，不进入金额汇总。
        {dataset ? ` 数据版本 ${dataset.meta.versions.settlement}。` : ''}
      </p>

      <RowDetailDrawer analysis={open} onClose={() => setOpenId(null)} />
    </div>
  );
}
