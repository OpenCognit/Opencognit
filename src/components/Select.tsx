import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  style?: React.CSSProperties;
  icon?: React.ReactNode;
}

export function Select({ value, onChange, options, style, icon }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selected = options.find(o => o.value === value);

  // Position dropdown via fixed coords, recalculated on open
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setDropdownStyle({
      position: 'fixed',
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      zIndex: 99999,
    });
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Close on scroll/resize — but NOT when scrolling inside the dropdown itself
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (dropdownRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const closeResize = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', closeResize);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', closeResize);
    };
  }, [open]);

  return (
    <div style={{ position: 'relative', ...style }}>
      <button
        ref={triggerRef}
        type="button"
        className="select-trigger"
        data-open={open}
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          padding: '0.5rem 2rem 0.5rem 0.75rem',
          background: open ? 'rgba(35, 205, 202, 0.08)' : 'rgba(255, 255, 255, 0.05)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '8px',
          fontSize: '0.875rem',
          color: 'var(--color-text-primary)',
          textAlign: 'left',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
          outline: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flex: 1, overflow: 'hidden' }}>
          {icon && <div style={{ color: 'var(--color-text-tertiary)', flexShrink: 0, display: 'flex' }}>{icon}</div>}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {selected?.label ?? ''}
          </span>
        </div>
        <ChevronDown
          size={14}
          style={{
            color: 'var(--color-text-tertiary)',
            transition: 'transform 0.2s',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            flexShrink: 0,
          }}
        />
      </button>

      {open && createPortal(
        <div
          ref={dropdownRef}
          className="select-dropdown"
          style={{
            ...dropdownStyle,
            background: 'rgba(12, 12, 24, 0.97)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: '10px',
            overflow: 'hidden',
            overflowY: 'auto',
            maxHeight: '240px',
            boxShadow: '0 16px 40px rgba(0,0,0,0.6)',
          }}
        >
          {options.map(opt => (
            <button
              key={opt.value}
              type="button"
              className="select-option"
              onClick={() => { onChange(opt.value); setOpen(false); }}
              style={{
                width: '100%',
                padding: '0.5rem 0.75rem',
                fontSize: '0.875rem',
                textAlign: 'left',
                cursor: 'pointer',
                background: opt.value === value ? 'rgba(35, 205, 202, 0.15)' : 'transparent',
                color: opt.value === value ? '#23CDCB' : 'var(--color-text-primary)',
                border: 'none',
                display: 'block',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => {
                if (opt.value !== value) {
                  (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)';
                }
              }}
              onMouseLeave={e => {
                if (opt.value !== value) {
                  (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                }
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
