import { useState } from 'react';

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  accent?: string;
  /** Persistent hover (always show glow) */
  active?: boolean;
}

export function GlassCard({
  children,
  style = {},
  accent = '#23CDCB',
  onClick,
  active = false,
  className,
  onMouseEnter,
  onMouseLeave,
  ...rest
}: GlassCardProps) {
  const [hovered, setHovered] = useState(false);
  const on = hovered || active;

  return (
    <div
      {...rest}
      className={className}
      onClick={onClick}
      onMouseEnter={e => { setHovered(true); onMouseEnter?.(e); }}
      onMouseLeave={e => { setHovered(false); onMouseLeave?.(e); }}
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: on ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.04)',
        backdropFilter: 'blur(24px) saturate(160%)',
        borderRadius: '20px',
        border: `1px solid ${on ? `${accent}30` : 'rgba(255,255,255,0.09)'}`,
        boxShadow: on
          ? `inset 0 1px 0 rgba(255,255,255,0.18), 0 12px 40px rgba(0,0,0,0.35), 0 0 0 1px ${accent}15`
          : 'inset 0 1px 0 rgba(255,255,255,0.08), 0 4px 16px rgba(0,0,0,0.2)',
        transform: on ? 'translateY(-2px)' : 'none',
        transition: 'all 0.25s ease',
        cursor: onClick ? 'pointer' : 'default',
        ...style,
      }}
    >
      {/* Dot pattern */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        opacity: on ? 1 : 0, transition: 'opacity 0.3s',
        backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.035) 1px, transparent 1px)',
        backgroundSize: '16px 16px',
      }} />
      {/* Gradient glow */}
      <div style={{
        position: 'absolute', inset: 0, borderRadius: '20px', pointerEvents: 'none',
        background: `linear-gradient(135deg, ${accent}12, transparent 60%, ${accent}08)`,
        opacity: on ? 1 : 0, transition: 'opacity 0.3s',
      }} />
      <div style={{ position: 'relative' }}>
        {children}
      </div>
    </div>
  );
}
