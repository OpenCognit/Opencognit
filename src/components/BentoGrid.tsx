import { useState } from 'react';

export interface BentoItem {
  title: string;
  description?: string;
  icon: React.ReactNode;
  status?: string;
  statusColor?: string;
  meta?: string;
  tags?: string[];
  cta?: string;
  colSpan?: 1 | 2 | 3;
  rowSpan?: 1 | 2;
  hasPersistentHover?: boolean;
  accent?: string;
  onClick?: () => void;
  children?: React.ReactNode;
  tourId?: string;
}

interface BentoGridProps {
  items: BentoItem[];
  columns?: 2 | 3;
}

export function BentoGrid({ items, columns = 3 }: BentoGridProps) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
      gap: '0.875rem',
    }}>
      {items.map((item, i) => (
        <BentoCard key={i} item={item} />
      ))}
    </div>
  );
}

function BentoCard({ item }: { item: BentoItem }) {
  const [hovered, setHovered] = useState(false);
  const active = hovered || item.hasPersistentHover;
  const accent = item.accent || '#c5a059';

  return (
    <div
      onClick={item.onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      {...(item.tourId ? { 'data-dashboard-step': item.tourId } : {})}
      style={{
        gridColumn: item.colSpan ? `span ${item.colSpan}` : 'span 1',
        gridRow: item.rowSpan ? `span ${item.rowSpan}` : 'span 1',
        position: 'relative',
        padding: '1.25rem',
        borderRadius: 0,
        border: `1px solid ${active ? `${accent}30` : 'rgba(255,255,255,0.09)'}`,
        background: active
          ? 'rgba(255,255,255,0.07)'
          : 'rgba(255,255,255,0.04)',
        backdropFilter: 'blur(24px) saturate(160%)',
        transition: 'all 0.25s ease',
        transform: active ? 'translateY(-2px)' : 'none',
        boxShadow: active
          ? `inset 0 1px 0 rgba(255,255,255,0.18), 0 12px 40px rgba(0,0,0,0.35), 0 0 0 1px ${accent}18`
          : 'inset 0 1px 0 rgba(255,255,255,0.08), 0 4px 16px rgba(0,0,0,0.2)',
        cursor: item.onClick ? 'pointer' : 'default',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.875rem',
      }}
    >
      {/* Dot pattern overlay */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        opacity: active ? 1 : 0, transition: 'opacity 0.3s',
        backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.035) 1px, transparent 1px)',
        backgroundSize: '16px 16px',
      }} />

      {/* Gradient border glow */}
      <div style={{
        position: 'absolute', inset: 0, borderRadius: 0, pointerEvents: 'none',
        background: `linear-gradient(135deg, ${accent}12, transparent 60%, ${accent}08)`,
        opacity: active ? 1 : 0, transition: 'opacity 0.3s',
      }} />

      {/* Header row */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{
          width: 36, height: 36, borderRadius: 0,
          background: active ? `${accent}20` : 'rgba(255,255,255,0.06)',
          border: `1px solid ${active ? `${accent}30` : 'rgba(255,255,255,0.08)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 0.25s',
          flexShrink: 0,
        }}>
          {item.icon}
        </div>
        {item.status && (
          <span style={{
            fontSize: '0.6875rem', fontWeight: 600,
            padding: '0.2rem 0.625rem', borderRadius: '9999px',
            background: item.statusColor ? `${item.statusColor}18` : 'rgba(255,255,255,0.06)',
            border: `1px solid ${item.statusColor ? `${item.statusColor}30` : 'rgba(255,255,255,0.1)'}`,
            color: item.statusColor || '#94a3b8',
            letterSpacing: '0.03em',
          }}>
            {item.status}
          </span>
        )}
      </div>

      {/* Content */}
      <div style={{ position: 'relative', flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '0.375rem' }}>
          <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#f1f5f9', margin: 0, lineHeight: 1.2 }}>
            {item.title}
          </h3>
          {item.meta && (
            <span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: 500 }}>
              {item.meta}
            </span>
          )}
        </div>
        {item.description && (
          <p style={{ fontSize: '0.8125rem', color: '#64748b', margin: 0, lineHeight: 1.55, fontWeight: 400 }}>
            {item.description}
          </p>
        )}
        {item.children && (
          <div style={{ marginTop: item.description ? '0.75rem' : 0 }}>
            {item.children}
          </div>
        )}
      </div>

      {/* Footer */}
      {(item.tags || item.cta) && (
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
            {item.tags?.map((tag, i) => (
              <span key={i} style={{
                fontSize: '0.6875rem', fontWeight: 500,
                padding: '0.2rem 0.5rem', borderRadius: 0,
                background: 'rgba(255,255,255,0.05)',
                color: '#64748b', border: '1px solid rgba(255,255,255,0.07)',
              }}>
                #{tag}
              </span>
            ))}
          </div>
          {item.cta && (
            <span style={{
              fontSize: '0.75rem', color: accent,
              opacity: active ? 1 : 0, transition: 'opacity 0.2s',
              fontWeight: 600,
            }}>
              {item.cta}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
