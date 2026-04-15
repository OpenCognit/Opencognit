"use client";
import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect, useRef } from "react";
import { X, CheckCircle2, AlertCircle, Info, XCircle, Bot, ArrowRight } from "lucide-react";

type ToastType = "success" | "error" | "info" | "warning" | "agent";

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
  onClick?: () => void;
}

interface ToastContextType {
  toast: (toast: Omit<Toast, "id">) => void;
  success: (title: string, message?: string, onClick?: () => void) => void;
  error: (title: string, message?: string, onClick?: () => void) => void;
  info: (title: string, message?: string, onClick?: () => void) => void;
  warning: (title: string, message?: string, onClick?: () => void) => void;
  agent: (title: string, message?: string, onClick?: () => void) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const iconMap: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 size={18} />,
  error: <XCircle size={18} />,
  info: <Info size={18} />,
  warning: <AlertCircle size={18} />,
  agent: <Bot size={18} />,
};

const colorMap: Record<ToastType, { bg: string; border: string; accent: string }> = {
  success: { bg: "rgba(16,185,129,0.08)", border: "rgba(16,185,129,0.25)", accent: "#10b981" },
  error:   { bg: "rgba(239,68,68,0.08)",  border: "rgba(239,68,68,0.25)",  accent: "#ef4444" },
  info:    { bg: "rgba(59,130,246,0.08)", border: "rgba(59,130,246,0.25)", accent: "#3b82f6" },
  warning: { bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.25)", accent: "#f59e0b" },
  agent:   { bg: "rgba(35,205,203,0.12)", border: "rgba(35,205,203,0.45)", accent: "#23CDCB" },
};

// Inject CSS animation for agent pulse once
if (typeof document !== 'undefined') {
  const styleId = '__toast_agent_pulse';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      @keyframes agentPulse {
        0%, 100% { box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.06), 0 0 20px rgba(35,205,203,0.15); }
        50% { box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.06), 0 0 36px rgba(35,205,203,0.40); }
      }
      @keyframes agentBorderPulse {
        0%, 100% { border-color: rgba(35,205,203,0.35); }
        50% { border-color: rgba(35,205,203,0.75); }
      }
    `;
    document.head.appendChild(style);
  }
}

function ToastItem({ t, dismiss }: { t: Toast; dismiss: (id: string) => void }) {
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(100);
  const colors = colorMap[t.type];
  const duration = t.duration ?? 5000;
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));

    const start = Date.now();
    intervalRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      setProgress(Math.max(0, 100 - (elapsed / duration) * 100));
    }, 50);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [duration]);

  const handleDismiss = () => {
    setVisible(false);
    setTimeout(() => dismiss(t.id), 300);
  };

  const isAgent = t.type === "agent";

  return (
    <div
      onClick={t.onClick ? () => { t.onClick!(); handleDismiss(); } : undefined}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 0,
        borderRadius: "12px",
        background: isAgent ? "rgba(10, 16, 20, 0.97)" : "rgba(15, 17, 26, 0.92)",
        border: `1px solid ${colors.border}`,
        backdropFilter: "blur(20px)",
        boxShadow: `0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.06)`,
        overflow: "hidden",
        cursor: t.onClick ? "pointer" : "default",
        transform: visible ? "translateX(0) scale(1)" : "translateX(110%) scale(0.95)",
        opacity: visible ? 1 : 0,
        transition: "transform 0.35s cubic-bezier(0.34,1.56,0.64,1), opacity 0.35s ease",
        minWidth: isAgent ? "340px" : "300px",
        maxWidth: isAgent ? "420px" : "380px",
        animation: isAgent && visible ? "agentPulse 2s ease-in-out infinite, agentBorderPulse 2s ease-in-out infinite" : undefined,
      }}
    >
      {/* Content row */}
      <div style={{ display: "flex", gap: 12, padding: "12px 14px", alignItems: "flex-start" }}>
        {/* Icon */}
        <div style={{
          color: colors.accent,
          flexShrink: 0,
          marginTop: 1,
          filter: `drop-shadow(0 0 6px ${colors.accent}60)`,
        }}>
          {iconMap[t.type]}
        </div>

        {/* Text */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontWeight: 600,
            fontSize: "13px",
            color: "#f1f5f9",
            marginBottom: t.message ? 3 : 0,
            lineHeight: 1.3,
          }}>
            {t.title}
          </div>
          {t.message && (
            <div style={{
              fontSize: "12px",
              color: "rgba(148,163,184,0.85)",
              lineHeight: 1.5,
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}>
              {t.message}
            </div>
          )}
        </div>

        {/* Navigate hint */}
        {t.onClick && (
          <div style={{ color: colors.accent, opacity: 0.7, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
            <ArrowRight size={13} />
          </div>
        )}

        {/* Close */}
        <button
          onClick={(e) => { e.stopPropagation(); handleDismiss(); }}
          style={{
            background: "none", border: "none", cursor: "pointer",
            padding: "2px", color: "rgba(148,163,184,0.5)",
            display: "flex", alignItems: "center", flexShrink: 0,
            borderRadius: 4, transition: "color 0.15s",
          }}
          onMouseEnter={e => (e.currentTarget.style.color = "#f1f5f9")}
          onMouseLeave={e => (e.currentTarget.style.color = "rgba(148,163,184,0.5)")}
        >
          <X size={14} />
        </button>
      </div>

      {/* Progress bar */}
      <div style={{ height: 2, background: "rgba(255,255,255,0.04)" }}>
        <div style={{
          height: "100%",
          width: `${progress}%`,
          background: `linear-gradient(90deg, ${colors.accent}80, ${colors.accent})`,
          transition: "width 0.05s linear",
          borderRadius: "0 1px 1px 0",
        }} />
      </div>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => {
      // Max 5 toasts at once — remove oldest if exceeded
      const next = [...prev, { id, ...t }];
      return next.length > 5 ? next.slice(next.length - 5) : next;
    });
    setTimeout(() => dismiss(id), t.duration ?? 5000);
  }, [dismiss]);

  const success = useCallback((title: string, message?: string, onClick?: () => void) => toast({ type: "success", title, message, onClick }), [toast]);
  const error   = useCallback((title: string, message?: string, onClick?: () => void) => toast({ type: "error",   title, message, onClick, duration: 8000 }), [toast]);
  const info    = useCallback((title: string, message?: string, onClick?: () => void) => toast({ type: "info",    title, message, onClick }), [toast]);
  const warning = useCallback((title: string, message?: string, onClick?: () => void) => toast({ type: "warning", title, message, onClick, duration: 7000 }), [toast]);
  const agent   = useCallback((title: string, message?: string, onClick?: () => void) =>
    toast({ type: "agent", title, message, onClick, duration: 6000 }), [toast]);

  return (
    <ToastContext.Provider value={{ toast, success, error, info, warning, agent, dismiss }}>
      {children}

      {/* Toast container — top right */}
      <div style={{
        position: "fixed",
        top: 16,
        right: 16,
        zIndex: 99999,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        pointerEvents: "none",
      }}>
        {toasts.map(t => (
          <div key={t.id} style={{ pointerEvents: "all" }}>
            <ToastItem t={t} dismiss={dismiss} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within a ToastProvider");
  return context;
}
