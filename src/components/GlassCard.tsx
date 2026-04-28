import { useState } from 'react';

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  accent?: string;
  /** Persistent hover (always show glow) */
  active?: boolean;
  /** Skip backdrop-filter blur — use for high-density lists (kanban cards, etc.) */
  noBlur?: boolean;
  /** Show ambient top-edge glow line */
  ambient?: boolean;
}

export function GlassCard({
  children,
  style = {},
  accent = '#c5a059',
  onClick,
  active = false,
  noBlur = false,
  ambient = false,
  className,
  onMouseEnter,
  onMouseLeave,
  ...rest
}: GlassCardProps) {
  const [hovered, setHovered] = useState(false);
  const on = hovered || active;

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
          background: on ? 'rgba(20,16,10,0.95)' : 'rgba(14,11,7,0.92)',
          borderRadius: 0,
          boxShadow: on
            ? `inset 0 0 0 1px ${accent}45, inset 0 1px 0 ${accent}30, 0 4px 20px rgba(0,0,0,0.5)`
            : `inset 0 0 0 1px rgba(197,160,89,0.10), inset 0 1px 0 rgba(197,160,89,0.06), 0 1px 4px rgba(0,0,0,0.4)`,
          transition: 'background 0.15s ease, box-shadow 0.15s ease',
          cursor: onClick ? 'pointer' : 'default',
          ...style,
        }}
      >
        {/* Top-edge accent line */}
        {on && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 1,
            background: `linear-gradient(90deg, transparent 0%, ${accent}55 40%, ${accent}55 60%, transparent 100%)`,
            pointerEvents: 'none', zIndex: 2,
          }} />
        )}
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
        background: on
          ? `linear-gradient(160deg, rgba(18,14,9,0.96) 0%, rgba(10,7,4,0.98) 100%)`
          : `rgba(8,6,4,0.88)`,
        backdropFilter: 'none',
        WebkitBackdropFilter: 'none',
        borderRadius: 0,
        boxShadow: on
          ? `inset 0 0 0 1px ${accent}30, inset 0 1px 0 ${accent}22, 0 12px 40px rgba(0,0,0,0.55), 0 0 0 1px ${accent}12`
          : `inset 0 0 0 1px rgba(197,160,89,0.10), inset 0 1px 0 rgba(197,160,89,0.07), 0 4px 16px rgba(0,0,0,0.4)`,
        transform: on ? 'translateY(-2px)' : 'none',
        transition: 'background 0.25s ease, box-shadow 0.25s ease, transform 0.25s ease',
        cursor: onClick ? 'pointer' : 'default',
        ...style,
      }}
    >
      {/* Top-edge accent line — always visible, brighter on hover */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 1,
        background: on
          ? `linear-gradient(90deg, transparent 0%, ${accent}65 35%, ${accent}65 65%, transparent 100%)`
          : `linear-gradient(90deg, transparent 0%, ${accent}22 35%, ${accent}22 65%, transparent 100%)`,
        transition: 'opacity 0.25s',
        pointerEvents: 'none', zIndex: 2,
      }} />

      {/* Ambient top glow */}
      {(on || ambient) && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 80,
          background: `linear-gradient(180deg, ${accent}08 0%, transparent 100%)`,
          pointerEvents: 'none', zIndex: 1,
          opacity: on ? 1 : 0.5,
          transition: 'opacity 0.25s',
        }} />
      )}

      {/* Subtle dot-matrix pattern on hover */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        opacity: on ? 0.6 : 0, transition: 'opacity 0.3s',
        backgroundImage: 'radial-gradient(circle, rgba(197,160,89,0.04) 1px, transparent 1px)',
        backgroundSize: '20px 20px',
      }} />

      <div style={{ position: 'relative', zIndex: 1 }}>
        {children}
      </div>
    </div>
  );
}
