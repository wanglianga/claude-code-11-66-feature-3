import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Rows3,
  FolderSearch,
  PackageCheck,
  History,
  GitCompareArrows,
  Database,
  ListChecks,
  BookOpen,
  GitFork,
  BarChart3,
  Layers,
} from 'lucide-react';
import { useApp } from '../store/AppStore';
import { formatCount } from '../lib/money';

const WORK_NAV = [
  { to: '/', label: '工作台总览', icon: LayoutDashboard, end: true },
  { to: '/ledger', label: '稽核明细', icon: Rows3 },
  { to: '/scope', label: '范围冻结', icon: FolderSearch },
];
const STATS_NAV = [
  { to: '/catalog', label: '目录沿革', icon: BookOpen },
  { to: '/mappings', label: '映射关系', icon: GitFork },
  { to: '/compare', label: '可比统计', icon: BarChart3 },
  { to: '/runs', label: '统计版本', icon: Layers },
];
const TRACE_NAV = [
  { to: '/materials', label: '证据材料', icon: PackageCheck },
  { to: '/diff', label: '更正差异', icon: GitCompareArrows },
  { to: '/batches', label: '批次目录', icon: Database },
  { to: '/timeline', label: '处理日志', icon: History },
  { to: '/verification', label: '验收核对', icon: ListChecks },
];

export function Sidebar() {
  const { analysis, materials, scopeRows } = useApp();
  const rowTotal = analysis?.totals.rowCount ?? 0;
  const scopeFiltered = scopeRows.length !== rowTotal;

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">稽</div>
        <div className="brand-text">
          <strong>稽核证据台</strong>
          <span>医保结算离线复核</span>
        </div>
      </div>
      <nav className="nav">
        <div className="nav-label">复核工作</div>
        {WORK_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            <item.icon size={16} className="icon" />
            <span>{item.label}</span>
            {item.to === '/ledger' && analysis ? <span className="count">{formatCount(rowTotal)}</span> : null}
            {item.to === '/scope' && scopeFiltered ? <span className="count">{formatCount(scopeRows.length)}</span> : null}
          </NavLink>
        ))}
        <div className="nav-label">政策统计</div>
        {STATS_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            <item.icon size={16} className="icon" />
            <span>{item.label}</span>
          </NavLink>
        ))}
        <div className="nav-label">材料与追溯</div>
        {TRACE_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            <item.icon size={16} className="icon" />
            <span>{item.label}</span>
            {item.to === '/materials' && materials.length ? <span className="count">{materials.length}</span> : null}
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-foot">
        <div><span className="dot-live" />离线运行 · IndexedDB 本地存储</div>
        <div style={{ marginTop: 6 }}>数据不出本机，封存材料可离线带走复核。</div>
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
          <ShieldMark /> 一条结算行只计一次支付金额
        </div>
      </div>
    </aside>
  );
}

function ShieldMark() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6l7-3z" />
    </svg>
  );
}
