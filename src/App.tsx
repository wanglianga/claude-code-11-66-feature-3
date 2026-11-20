import { Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider, useApp } from './store/AppStore';
import { Sidebar } from './components/Sidebar';
import { DashboardPage } from './pages/DashboardPage';
import { LedgerPage } from './pages/LedgerPage';
import { ScopePage } from './pages/ScopePage';
import { MaterialsPage } from './pages/MaterialsPage';
import { DiffPage } from './pages/DiffPage';
import { BatchesPage } from './pages/BatchesPage';
import { TimelinePage } from './pages/TimelinePage';
import { VerificationPage } from './pages/VerificationPage';
import { Filter } from 'lucide-react';

function Toasts() {
  const { toasts } = useApp();
  return (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.tone === 'warn' ? 'warn' : ''}`}>
          {toast.message}
        </div>
      ))}
    </div>
  );
}

function BusyBar() {
  const { busy } = useApp();
  if (!busy) return null;
  return (
    <div style={{ padding: '16px 28px 0' }}>
      <div className="callout info" style={{ alignItems: 'center' }}>
        <Filter size={16} />
        <span>{busy}</span>
      </div>
    </div>
  );
}

function Shell() {
  const { ready } = useApp();
  return (
    <div className="shell">
      <Sidebar />
      <div className="main">
        {!ready ? (
          <div className="content">
            <div className="card">
              <div className="empty">正在从本地 IndexedDB 载入批次与既有材料…</div>
            </div>
          </div>
        ) : (
          <>
            <BusyBar />
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/ledger" element={<LedgerPage />} />
              <Route path="/scope" element={<ScopePage />} />
              <Route path="/materials" element={<MaterialsPage />} />
              <Route path="/materials/:materialId" element={<MaterialsPage />} />
              <Route path="/diff" element={<DiffPage />} />
              <Route path="/batches" element={<BatchesPage />} />
              <Route path="/timeline" element={<TimelinePage />} />
              <Route path="/verification" element={<VerificationPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </>
        )}
      </div>
      <Toasts />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
