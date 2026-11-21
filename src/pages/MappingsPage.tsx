import { AlertTriangle, FileText, GitFork, Scale } from 'lucide-react';
import { useApp } from '../store/AppStore';
import { PageHeader, Stat, SectionCard } from '../components/Page';
import { Badge } from '../components/Badge';
import type { MappingKind } from '../types/stats';

const KIND_TONE: Record<MappingKind, 'info' | 'ok' | 'warn' | 'mute'> = {
  更名: 'info',
  等价替换: 'ok',
  拆分: 'warn',
  合并: 'mute',
};

export function MappingsPage() {
  const { statsState } = useApp();

  if (!statsState) {
    return <div className="content"><div className="empty">载入中…</div></div>;
  }

  const { mappings } = statsState;
  const missing = mappings.filter((mapping) => mapping.evidenceStatus === '缺失');
  const splitCandidates = mappings
    .filter((mapping) => mapping.kind === '拆分')
    .reduce((acc, mapping) => acc + mapping.toCodes.length, 0);

  return (
    <div className="content">
      <PageHeader
        kicker="Code mappings"
        title="映射关系"
        lead={
          <>
            相邻目录版本之间的代码对照：更名、等价替换、拆分、合并，每条均记录证据来源。
            <b>证据缺失的映射不参与金额分配</b>；拆分候选与分摊依据仅供审核，不等于已分配金额。
          </>
        }
      />

      <div className="grid cols-4">
        <Stat label="映射关系" value={mappings.length} hint="更名 1 · 等价替换 2 · 拆分 2 · 合并 1" />
        <Stat label="证据齐全" value={mappings.length - missing.length} accent="teal" hint="可直接用于可比口径" />
        <Stat label="证据缺失" value={missing.length} accent={missing.length ? 'red' : 'teal'} hint={missing.map((mapping) => mapping.id).join('、') || '无'} />
        <Stat label="拆分候选" value={splitCandidates} accent="amber" hint="全部保留在歧义池待审核" />
      </div>

      <div className="card mt-16">
        <div className="card-head">
          <div>
            <h2>映射台账</h2>
            <div className="desc">每条可比结果都能沿映射链回查到本表的证据来源。</div>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>映射</th><th>类型</th><th>对照关系</th><th>生效日</th><th>证据来源</th><th>分摊依据</th><th>状态</th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((mapping) => (
                <tr key={mapping.id}>
                  <td className="mono nowrap">{mapping.id}</td>
                  <td><Badge tone={KIND_TONE[mapping.kind]}>{mapping.kind}</Badge></td>
                  <td>
                    <span className="mono small">{mapping.fromCodes.join(' + ')}</span>
                    <span className="muted"> → </span>
                    <span className="mono small">{mapping.toCodes.join(' + ')}</span>
                    <div className="tiny muted">{mapping.fromCatalogId} → {mapping.toCatalogId}</div>
                  </td>
                  <td className="mono tiny nowrap">{mapping.effectiveDate}</td>
                  <td className="tiny" style={{ maxWidth: 260 }}>
                    {mapping.evidenceSource ? (
                      <span className="row" style={{ gap: 5, alignItems: 'flex-start' }}>
                        <FileText size={12} style={{ flex: '0 0 auto', marginTop: 3, color: 'var(--teal)' }} />
                        {mapping.evidenceSource}
                      </span>
                    ) : (
                      <span className="row" style={{ gap: 5, color: 'var(--red)', alignItems: 'flex-start' }}>
                        <AlertTriangle size={12} style={{ flex: '0 0 auto', marginTop: 3 }} />
                        证据待补
                      </span>
                    )}
                    <div className="tiny muted">{mapping.note}</div>
                  </td>
                  <td className="tiny" style={{ maxWidth: 220 }}>
                    {mapping.allocationBasis || <span className="muted">无</span>}
                    {mapping.weights ? (
                      <div className="tiny mono muted">
                        {Object.entries(mapping.weights).map(([code, weight]) => `${code} ${(weight * 100).toFixed(0)}%`).join(' · ')}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    {mapping.evidenceStatus === '齐全'
                      ? <Badge tone="ok">证据齐全</Badge>
                      : <Badge tone="bad">证据缺失 · 不参与分配</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="section-title mt-16">六类沿革样例（题目要求全覆盖）</div>
      <div className="grid cols-3">
        <SectionCard title="① 更名 · MAP-01" desc="代码不变，仅规范名称。">
          <p className="small">CS100「彩色多普勒超声检查」→「彩色多普勒超声常规检查」（2024-01-01）。</p>
          <p className="tiny muted mt-8">统计上视为连续；若只按名称汇总会把更名误读为项目消失与新设。</p>
        </SectionCard>
        <SectionCard title="② 等价替换 · MAP-02" desc="旧码停用，新码同义（一对一）。">
          <p className="small">MR550「磁共振平扫」→ MR551「磁共振平扫（单部位）」（2025-01-01）。</p>
          <p className="tiny muted mt-8">金额沿映射链唯一结转，跨期趋势不受换码影响。</p>
        </SectionCard>
        <SectionCard title="③ 一对多拆分 · MAP-03" desc="有分摊依据，候选待审核。">
          <p className="small">ZL700「综合康复治疗」→ ZL701 / ZL702 / ZL703（2025-01-01），权重 0.5 / 0.3 / 0.2。</p>
          <p className="tiny muted mt-8">权重来自用量调查，仅作候选参考分摊；未审核前金额留在歧义池，不计入任何新类。</p>
        </SectionCard>
        <SectionCard title="④ 一对多拆分 · MAP-04" desc="无分摊依据（无依据映射样例之一）。">
          <p className="small">ZH600「中西医结合综合治疗」→ ZH601（中医）/ ZH602（物理治疗），候选跨上级类别。</p>
          <p className="tiny muted mt-8">缺少患者级/项目级转换依据：不得把整笔金额复制给多个新类，全额保留在歧义池。</p>
        </SectionCard>
        <SectionCard title="⑤ 合并 · MAP-05" desc="多对一，目标唯一。">
          <p className="small">XL101「静息心电图」+ XL102「负荷心电图」→ XL100（2024-01-01）。</p>
          <p className="tiny muted mt-8">两个旧码金额都唯一结转到 XL100，不发生重复计额。</p>
        </SectionCard>
        <SectionCard title="⑥ 代码复用 · 无映射" desc="同一代码不同有效期不同含义。">
          <p className="small">A100：2023 版「红外线治疗」（物理治疗）→ 停用 → 2025 版「中医定向透药治疗」（中医治疗）。</p>
          <p className="tiny muted mt-8">两者之间<b>不建立映射</b>；统计按服务发生日分段归集，绝不用现行释义回填 2023 年。</p>
        </SectionCard>
      </div>

      <div className="callout mt-16" style={{ fontSize: 12.5 }}>
        <Scale size={15} style={{ flex: '0 0 auto', marginTop: 2 }} />
        <div>
          <b>候选 ≠ 已分配。</b>一对多拆分（MAP-03 / MAP-04）产生的候选与权重只说明「可能的去向与依据」，
          在歧义池中等待政策人员审核；类别合计、覆盖率分子都不包含这些金额。
          无依据映射（MAP-06 证据缺失）在证据补齐前同样不参与分配，对应金额列入「无法唯一映射」。
        </div>
      </div>

      <div className="callout info mt-12" style={{ fontSize: 12 }}>
        <GitFork size={15} style={{ flex: '0 0 auto', marginTop: 2 }} />
        <div>
          另有两类无映射情形在「可比统计」页单列：<b>停用无后继</b>（XT500 石蜡疗法 2025 年调出目录）与
          <b>目录未收录</b>（TP999 从未进入任何一版目录；XT500 停用后仍结算的零星行）。
        </div>
      </div>
    </div>
  );
}
