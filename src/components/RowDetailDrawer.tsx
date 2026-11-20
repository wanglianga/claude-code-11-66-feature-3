import type { RowAnalysis } from '../types/domain';
import { formatCents } from '../lib/money';
import { useBadge, Badge } from './Badge';
import { Drawer } from './Overlay';

export function RowDetailDrawer({
  analysis,
  onClose,
}: {
  analysis: RowAnalysis | null;
  onClose: () => void;
}) {
  const badge = useBadge();
  if (!analysis) return null;
  const { row, hits, qualification, conclusion, reviewState } = analysis;
  const hintSum = hits.reduce((acc, hit) => acc + hit.hintAmountCents, 0);

  return (
    <Drawer
      open={Boolean(analysis)}
      onClose={onClose}
      width={600}
      title={
        <span className="row" style={{ gap: 8 }}>
          <span className="mono">{row.id}</span>
          <Badge {...badge.review(reviewState)}>{reviewState}</Badge>
        </span>
      }
      subtitle={`${row.institutionName} · ${row.serviceDate} · 第 ${row.rowNumber} 行`}
    >
      <div className="card">
        <div className="card-body">
          <div className="row between" style={{ alignItems: 'flex-start' }}>
            <div>
              <div className="tiny muted">基金支付金额（仅计一次）</div>
              <div style={{ fontSize: 28, fontWeight: 600, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
                ¥{formatCents(row.paymentAmountCents)}
              </div>
            </div>
            <div className="right">
              <div className="tiny muted">本行命中规则</div>
              <div style={{ fontSize: 22, fontWeight: 600 }}>{hits.length} 条</div>
            </div>
          </div>
          <div className="divider" />
          <dl className="kv">
            <dt>检查项目</dt>
            <dd>{row.itemName} <span className="mono muted">({row.itemCode})</span></dd>
            <dt>机构</dt>
            <dd>{row.institutionName} <span className="mono muted">({row.institutionCode})</span></dd>
            <dt>统筹区</dt>
            <dd>{row.poolingAreaName} <span className="mono muted">{row.poolingAreaCode}</span></dd>
            <dt>人员</dt>
            <dd className="mono">{row.personRef}</dd>
            <dt>险种 / 就诊</dt>
            <dd>{row.fundType} / {row.visitType}</dd>
            <dt>总费用</dt>
            <dd className="num" style={{ textAlign: 'left' }}>¥{formatCents(row.totalAmountCents)}</dd>
            <dt>疑似金额</dt>
            <dd className="num" style={{ textAlign: 'left' }}>¥{formatCents(row.suspectedAmountCents)} <span className="tiny muted">（排序用，不参与汇总）</span></dd>
            <dt>来源批次</dt>
            <dd><span className="mono">{row.sourceBatchId}</span> <span className="tiny muted">/ {row.sourceVersion}</span></dd>
            <dt>行摘要</dt>
            <dd className="hash">{row.inputDigest}</dd>
          </dl>
        </div>
      </div>

      <div className="section-title">规则命中 · {hits.length} 条</div>
      {hits.length === 0 ? (
        <div className="callout ok">本行未命中规则。金额依据为结算明细本身。</div>
      ) : (
        <>
          {hits.map((hit) => (
            <div className="evidence" key={hit.id}>
              <div className="head">
                <b>{hit.ruleCode} {hit.ruleName}</b>
                <Badge {...badge.severity(hit.severity)}>{hit.severity}</Badge>
                <span className="tiny muted mono" style={{ marginLeft: 'auto' }}>{hit.id}</span>
              </div>
              <p>{hit.clause}</p>
              <p className="sub">{hit.finding}</p>
              <p className="sub">
                置信度 {hit.confidence.toFixed(2)} · 单条提示金额 ¥{formatCents(hit.hintAmountCents)}（仅解释，不进入汇总）· 检测于 {hit.detectedAt}
              </p>
            </div>
          ))}
          {hits.length > 1 ? (
            <div className="callout mt-8">
              共 {hits.length} 条命中。若按命中摊平累加会得到 ¥{formatCents(hintSum)}，与实际支付 ¥{formatCents(row.paymentAmountCents)} 不可相加；
              本工作台按结算行唯一计额，规则命中仅作独立解释。
            </div>
          ) : null}
        </>
      )}

      <div className="section-title">资质依据</div>
      <div className={`callout ${qualification.status === 'ok' ? 'ok' : qualification.status === 'inactive' ? '' : 'danger'}`}>
        <div>
          <b>{qualification.label}</b>
          <div>{qualification.detail}</div>
        </div>
      </div>
      <div className="mt-12 stack tight">
        {qualification.candidates.length === 0 ? (
          <div className="small muted">服务日无快照记录。</div>
        ) : (
          qualification.candidates.map((snapshot) => (
            <div className="evidence" key={snapshot.id}>
              <div className="head">
                <b className="mono">{snapshot.id}</b>
                <Badge tone={snapshot.state === '有效' ? 'ok' : 'bad'}>{snapshot.state}</Badge>
                {qualification.primary?.id === snapshot.id ? <Badge tone="ok">本次采用</Badge> : null}
                <span className="tiny muted" style={{ marginLeft: 'auto' }}>v{snapshot.revision}</span>
              </div>
              <p className="mono tiny">{snapshot.certNo}</p>
              <p>有效期：{snapshot.validFrom} 至 {snapshot.validTo ?? '长期'}</p>
              <p className="sub">{snapshot.note}</p>
              <p className="sub">来源批次 {snapshot.sourceBatchId} · 变更日 {snapshot.revisedAt}</p>
            </div>
          ))
        )}
      </div>

      <div className="section-title">处理结论</div>
      {conclusion ? (
        <div className="evidence">
          <div className="head">
            <b>{conclusion.code}</b>
            <Badge {...badge.conclusion(conclusion.code)}>{conclusion.code}</Badge>
            <span className="tiny muted" style={{ marginLeft: 'auto' }}>v{conclusion.version}</span>
          </div>
          <p>{conclusion.label}</p>
          <p className="sub">
            追回金额 ¥{formatCents(conclusion.deductionCents)} · 经办人 {conclusion.handler} · 决定日 {conclusion.decidedAt}
          </p>
          <p className="sub">来源批次 {conclusion.sourceBatchId}</p>
          <p className="sub">{conclusion.note}</p>
        </div>
      ) : (
        <div className="callout">该结算行尚无处理结论，复核状态列为「待结论」。</div>
      )}
    </Drawer>
  );
}
