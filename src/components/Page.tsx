import type { ReactNode } from 'react';

export function PageHeader({
  title,
  lead,
  actions,
  kicker,
}: {
  title: string;
  lead?: ReactNode;
  actions?: ReactNode;
  kicker?: string;
}) {
  return (
    <div className="page-head">
      <div>
        {kicker ? (
          <div className="tiny" style={{ letterSpacing: '1.2px', color: 'var(--teal)', textTransform: 'uppercase', marginBottom: 4 }}>
            {kicker}
          </div>
        ) : null}
        <h1>{title}</h1>
        {lead ? <div className="lead mt-8">{lead}</div> : null}
      </div>
      {actions ? <div className="spacer row">{actions}</div> : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  accent,
  small,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  accent?: 'teal' | 'amber' | 'red' | 'blue';
  small?: boolean;
}) {
  return (
    <div className={`stat ${accent && accent !== 'teal' ? `accent-${accent}` : ''}`}>
      <span className="label">{label}</span>
      <span className={`value ${small ? 'small' : ''}`}>{value}</span>
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function SectionCard({
  title,
  desc,
  actions,
  children,
  bodyStyle,
  noBody,
}: {
  title: ReactNode;
  desc?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  bodyStyle?: React.CSSProperties;
  noBody?: boolean;
}) {
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>{title}</h2>
          {desc ? <div className="desc">{desc}</div> : null}
        </div>
        {actions ? <div className="spacer row">{actions}</div> : null}
      </div>
      {noBody ? children : <div className="card-body" style={bodyStyle}>{children}</div>}
    </section>
  );
}
