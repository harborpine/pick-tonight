import { useState, type ReactNode } from 'react';
import { posterUrl, type ServiceChoice } from '../contracts';
import { adLabel, hueFor, serviceName } from './helpers';

// ---------------------------------------------------------------------------
// Poster with a good-looking placeholder (title on a gradient)
// ---------------------------------------------------------------------------

interface PosterProps {
  title: string;
  year?: number;
  poster: string | null;
  size?: 'w185' | 'w342' | 'w500' | 'w780';
  className?: string;
  /** Smaller placeholder text, no year (for thumbnails). */
  compact?: boolean;
  /** Placeholder shows no text at all (the caller draws the title itself). */
  quiet?: boolean;
}

export function Poster({ title, year, poster, size = 'w342', className = '', compact = false, quiet = false }: PosterProps) {
  const [failed, setFailed] = useState(false);
  const url = posterUrl(poster, size);
  const hue = hueFor(title);
  const style = {
    background: `linear-gradient(160deg, hsl(${hue} 55% 30%) 0%, hsl(${(hue + 50) % 360} 60% 14%) 100%)`,
  };
  return (
    <div className={`poster ${className}`} style={style}>
      {(!url || failed) && (
        <div className={`poster-fallback ${compact ? 'compact' : ''}`}>
          {quiet && <span className="poster-initial" aria-hidden="true">{title.replace(/^(the|a|an)\s+/i, '').charAt(0).toUpperCase()}</span>}
          {!quiet && <span className="poster-fallback-title">{title}</span>}
          {!compact && !quiet && year ? <span className="poster-fallback-year">{year}</span> : null}
        </div>
      )}
      {url && !failed && (
        <img src={url} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

export function AdBadge({ service, testId = 'ad-badge' }: { service: ServiceChoice; testId?: string }) {
  return (
    <span className={`badge ${service.adFree ? 'badge-adfree' : 'badge-ads'}`} data-testid={testId} data-adfree={service.adFree}>
      {adLabel(service)}
    </span>
  );
}

export function ServiceLine({ service, prefix = 'service' }: { service: ServiceChoice; prefix?: string }) {
  return (
    <span className="service-line">
      <span className="service-name" data-testid={`${prefix}-name`}>
        {serviceName(service.serviceId)}
      </span>
      <AdBadge service={service} testId={`${prefix}-ad-badge`} />
    </span>
  );
}

export function Chip({
  selected,
  onClick,
  children,
  testId,
  small,
  disabled,
}: {
  selected?: boolean;
  onClick: () => void;
  children: ReactNode;
  testId?: string;
  small?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`chip ${selected ? 'chip-on' : ''} ${small ? 'chip-small' : ''}`}
      aria-pressed={!!selected}
      data-selected={!!selected}
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  testPrefix,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  testPrefix: string;
}) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          className={o.value === value ? 'on' : ''}
          data-testid={`${testPrefix}-${o.value}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Bottom sheet with a backdrop. Tap the backdrop to close. */
export function Sheet({
  children,
  onClose,
  testId,
  title,
}: {
  children: ReactNode;
  onClose: () => void;
  testId: string;
  title?: string;
}) {
  return (
    <div className="sheet-backdrop" onClick={onClose} data-testid={`${testId}-backdrop`}>
      <div className="sheet" role="dialog" aria-modal="true" data-testid={testId} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        {title && <h3 className="sheet-title">{title}</h3>}
        {children}
      </div>
    </div>
  );
}

export function Header({ title, subtitle, left, right }: { title: string; subtitle?: string; left?: ReactNode; right?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="page-header-side">{left}</div>
      <div className="page-header-main">
        <h1 data-testid="page-title">{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="page-header-side right">{right}</div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Icons (inline, 24x24, currentColor)
// ---------------------------------------------------------------------------

const ic = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);

export const Icon = {
  tonight: ic(<><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M10 9.2v5.6l4.6-2.8z" fill="currentColor" /></>),
  fresh: ic(<><path d="M12 3l2.2 5.3 5.8.5-4.4 3.8 1.4 5.6L12 15l-5 3.2 1.4-5.6L4 8.8l5.8-.5z" /></>),
  list: ic(<><path d="M6 4h12v17l-6-4-6 4z" /></>),
  history: ic(<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>),
  us: ic(<><circle cx="9" cy="9" r="3.2" /><path d="M3.5 19c.5-3 2.7-4.7 5.5-4.7s5 1.7 5.5 4.7" /><circle cx="17" cy="8" r="2.4" /><path d="M16.5 13.2c2.4.1 3.9 1.5 4.3 4" /></>),
  close: ic(<path d="M6 6l12 12M18 6L6 18" />),
  check: ic(<path d="M5 12.5l4.5 4.5L19 7.5" />),
  eye: ic(<><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></>),
  bookmark: ic(<path d="M7 4h10v16l-5-3.5L7 20z" />),
  ban: ic(<><circle cx="12" cy="12" r="8.5" /><path d="M6 6l12 12" /></>),
  heart: ic(<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.6 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" />),
  back: ic(<path d="M15 5l-7 7 7 7" />),
  info: ic(<><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5M12 7.8v.1" /></>),
  gear: ic(<><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8" /></>),
};
