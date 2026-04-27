import { useState } from 'react';

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  accent?: string;
  /** Persistent hover (always show glow) */
  active?: boolean;
  /** Skip backdrop-filter blur — use for high-density lists (kanban cards, etc.) */
  noBlur?: boolean;
}

export function GlassCard({
  children,
  style = {},
  accent = '#c5a059',
  onClick,
  active = false,
  noBlur = false,
  className,
  onMouseEnter,
  onMouseLeave,
  ...rest
}: GlassCardProps) {
  const [hovered, setHovered] = useState(false);
  const on = hovered || active;

  // noBlur mode: lightweight card for high-density lists (no overlays, no backdrop-filter, minimal transition)
  if (noBlur) {
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
          background: on ? 'rgba(255,255,255,0.11)' : 'rgba(30,30,40,0.9)',
          borderRadius: 0,
          boxShadow: on
            ? `inset 0 0 0 1px ${accent}50, 0 4px 20px rgba(0,0,0,0.4), 0 0 0 1px ${accent}25`
            : `inset 0 0 0 1px rgba(255,255,255,0.12), 0 1px 4px rgba(0,0,0,0.3)`,
          transition: 'background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease',
          cursor: onClick ? 'pointer' : 'default',
          ...style,
        }}
      >
        <div style={{ position: 'relative', zIndex: 1 }}>
          {children}
        </div>
      </div>
    );
  }

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
        borderRadius: 0,
        boxShadow: on
          ? `inset 0 0 0 1px ${accent}30, inset 0 1px 0 rgba(255,255,255,0.18), 0 12px 40px rgba(0,0,0,0.35), 0 0 0 1px ${accent}15`
          : `inset 0 0 0 1px rgba(255,255,255,0.09), inset 0 1px 0 rgba(255,255,255,0.08), 0 4px 16px rgba(0,0,0,0.2)`,
        transform: on ? 'translateY(-2px)' : 'none',
        transition: 'background 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease, transform 0.25s ease',
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
        position: 'absolute', inset: 0, borderRadius: 0, pointerEvents: 'none',
        background: `linear-gradient(135deg, ${accent}12, transparent 60%, ${accent}08)`,
        opacity: on ? 1 : 0, transition: 'opacity 0.3s',
      }} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        {children}
      </div>
    </div>
  );
}
