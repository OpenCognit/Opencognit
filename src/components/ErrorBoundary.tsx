import React, { Component, ErrorInfo, ReactNode } from "react";
import { useToast } from "./ToastProvider";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          padding: "var(--space-8)",
          textAlign: "center",
        }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "64px",
            height: "64px",
            borderRadius: "50%",
            background: "rgba(239, 68, 68, 0.1)",
            color: "var(--color-error)",
            marginBottom: "var(--space-4)",
          }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
          </div>
          <h1 style={{ fontSize: "var(--font-size-xl)", fontWeight: 700, marginBottom: "var(--space-2)" }}>
            Etwas ist schiefgelaufen
          </h1>
          <p style={{ color: "var(--muted-foreground)", marginBottom: "var(--space-4)", maxWidth: "400px" }}>
            Die Anwendung ist auf einen unerwarteten Fehler gestoßen. Bitte laden Sie die Seite neu.
          </p>
          <button
            className="btn btn-primary"
            onClick={() => window.location.reload()}
          >
            Seite neu laden
          </button>
          {this.state.error && (
            <details style={{
              marginTop: "var(--space-4)",
              padding: "var(--space-3)",
              borderRadius: "0",
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              maxWidth: "600px",
              textAlign: "left",
            }}>
              <summary style={{ fontWeight: 500, cursor: "pointer", marginBottom: "var(--space-2)" }}>
                Fehlerdetails
              </summary>
              <pre style={{
                fontSize: "var(--font-size-xs)",
                color: "var(--muted-foreground)",
                overflow: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}>
                {this.state.error.toString()}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

// Hook-based wrapper for functional components
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  fallback?: ReactNode
) {
  return function WrappedComponent(props: P) {
    return (
      <ErrorBoundary fallback={fallback}>
        <Component {...props} />
      </ErrorBoundary>
    );
  };
}
