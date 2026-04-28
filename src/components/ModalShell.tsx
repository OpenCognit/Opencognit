import React from 'react';
import { X } from 'lucide-react';

interface ModalShellProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  titleIcon?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: string;
  className?: string;
}

export function ModalShell({
  isOpen,
  onClose,
  title,
  titleIcon,
  children,
  footer,
  maxWidth = '480px',
  className,
}: ModalShellProps) {
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        padding: '1rem',
        animation: 'fadeIn 0.2s ease',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={className}
        style={{
          background: 'linear-gradient(180deg, rgba(16,14,10,0.97) 0%, rgba(12,10,8,0.97) 100%)',
          backdropFilter: 'blur(32px)',
          WebkitBackdropFilter: 'blur(32px)',
          border: '1px solid rgba(197, 160, 89, 0.15)',
          borderRadius: 0,
          padding: 0,
          width: '100%',
          maxWidth,
          position: 'relative',
          boxShadow: `
            0 30px 80px rgba(0,0,0,0.6),
            0 0 0 1px rgba(255,255,255,0.03),
            inset 0 1px 0 rgba(255,255,255,0.06),
            0 0 40px rgba(197,160,89,0.06)
          `,
          animation: 'slideUp 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.625rem',
            padding: '1.25rem 1.5rem 1rem',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            flexShrink: 0,
          }}
        >
          {titleIcon && (
            <span style={{ color: '#c5a059', flexShrink: 0 }}>{titleIcon}</span>
          )}
          <h2
            style={{
              fontSize: '1.125rem',
              fontWeight: 700,
              background: 'linear-gradient(135deg, #c5a059 0%, #e8d5a3 50%, #c5a059 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              flex: 1,
              minWidth: 0,
            }}
          >
            {title}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-text-tertiary)',
              cursor: 'pointer',
              padding: '0.25rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'color 0.15s',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = '#c5a059';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-tertiary)';
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div
          style={{
            padding: '1.25rem 1.5rem',
            overflowY: 'auto',
            flex: 1,
            minHeight: 0,
          }}
        >
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: '0.75rem',
              padding: '1rem 1.5rem',
              borderTop: '1px solid rgba(255,255,255,0.06)',
              flexShrink: 0,
              background: 'rgba(255,255,255,0.01)',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Reusable Button Styles ────────────────────────────────────────────────── */

export const btnPrimary = {
  padding: '0.5rem 1.25rem',
  background: 'rgba(197, 160, 89, 0.12)',
  border: '1px solid rgba(197, 160, 89, 0.3)',
  borderColor: 'rgba(197, 160, 89, 0.3)',
  borderRadius: 0,
  color: '#c5a059',
  fontWeight: 600,
  fontSize: '0.875rem',
  cursor: 'pointer',
  transition: 'all 0.15s',
} as const;

export const btnPrimaryHover = {
  background: 'rgba(197, 160, 89, 0.2)',
  borderColor: 'rgba(197, 160, 89, 0.45)',
  boxShadow: '0 0 16px rgba(197,160,89,0.15)',
} as const;

export const btnSecondary = {
  padding: '0.5rem 1rem',
  background: 'rgba(255, 255, 255, 0.04)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  borderColor: 'rgba(255, 255, 255, 0.08)',
  borderRadius: 0,
  color: 'var(--color-text-secondary)',
  fontWeight: 500,
  fontSize: '0.875rem',
  cursor: 'pointer',
  transition: 'all 0.15s',
} as const;

export const btnSecondaryHover = {
  background: 'rgba(255, 255, 255, 0.08)',
  borderColor: 'rgba(255, 255, 255, 0.14)',
  color: 'var(--color-text-primary)',
} as const;

export const btnDanger = {
  padding: '0.5rem 1rem',
  background: 'rgba(239, 68, 68, 0.08)',
  border: '1px solid rgba(239, 68, 68, 0.2)',
  borderColor: 'rgba(239, 68, 68, 0.2)',
  borderRadius: 0,
  color: '#ef4444',
  fontWeight: 500,
  fontSize: '0.875rem',
  cursor: 'pointer',
  transition: 'all 0.15s',
} as const;

export const btnDangerHover = {
  background: 'rgba(239, 68, 68, 0.14)',
  borderColor: 'rgba(239, 68, 68, 0.35)',
} as const;

/* ── Form Field Label ──────────────────────────────────────────────────────── */

export function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label
      style={{
        fontSize: '0.6875rem',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        display: 'block',
        marginBottom: '0.375rem',
        color: 'var(--color-text-tertiary)',
      }}
    >
      {children}
      {required && <span style={{ color: '#c5a059', marginLeft: '0.25rem' }}>*</span>}
    </label>
  );
}

/* ── Styled Input / Textarea ───────────────────────────────────────────────── */

export const inputStyle = {
  width: '100%',
  padding: '0.5rem 0.75rem',
  backgroundColor: 'rgba(255, 255, 255, 0.03)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  borderColor: 'rgba(255, 255, 255, 0.08)',
  borderRadius: 0,
  fontSize: '0.875rem',
  color: 'var(--color-text-primary)',
  outline: 'none',
  transition: 'border-color 0.15s, box-shadow 0.15s',
} as const;

export const inputFocus = {
  borderColor: 'rgba(197, 160, 89, 0.4)',
  boxShadow: '0 0 0 1px rgba(197, 160, 89, 0.1), 0 0 12px rgba(197,160,89,0.08)',
} as const;

export const textareaStyle = {
  ...inputStyle,
  resize: 'vertical',
  minHeight: '60px',
  fontFamily: 'inherit',
} as const;

/* ── Error Box ─────────────────────────────────────────────────────────────── */

export function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: '0.625rem 0.875rem',
        background: 'rgba(239, 68, 68, 0.06)',
        border: '1px solid rgba(239, 68, 68, 0.2)',
        borderRadius: 0,
        color: '#ef4444',
        fontSize: '0.8125rem',
        marginBottom: '1rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
      }}
    >
      <span style={{ fontSize: '1rem' }}>⚠</span>
      {children}
    </div>
  );
}
