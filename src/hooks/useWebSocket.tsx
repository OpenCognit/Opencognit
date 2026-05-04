import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

interface WsMessage {
  type: string;
  unternehmenId?: string;
  data?: any;
  [key: string]: any;
}

interface WebSocketContextValue {
  connected: boolean;
  subscribe: (type: string, handler: (msg: WsMessage) => void) => () => void;
}

// ── Global singleton state (outside React) ───────────────────────────────────

let globalWs: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const listeners = new Map<string, Set<(msg: WsMessage) => void>>();
let globalConnected = false;
const statusListeners = new Set<(connected: boolean) => void>();

function buildWsUrl(): string {
  const token = localStorage.getItem('opencognit_token') || '';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws${token ? `?token=${token}` : ''}`;
}

function notifyStatus(connected: boolean) {
  globalConnected = connected;
  statusListeners.forEach(fn => fn(connected));
}

function dispatchMessage(msg: WsMessage) {
  const typeHandlers = listeners.get(msg.type);
  if (typeHandlers) {
    typeHandlers.forEach(h => {
      try { h(msg); } catch { /* ignore */ }
    });
  }
  // Also dispatch to wildcard listeners (type: '*')
  const wildcard = listeners.get('*');
  if (wildcard) {
    wildcard.forEach(h => {
      try { h(msg); } catch { /* ignore */ }
    });
  }
}

function connect() {
  if (globalWs?.readyState === WebSocket.OPEN || globalWs?.readyState === WebSocket.CONNECTING || globalWs?.readyState === WebSocket.CLOSING) return;

  const ws = new WebSocket(buildWsUrl());
  globalWs = ws;

  ws.onopen = () => {
    reconnectAttempts = 0;
    notifyStatus(true);
  };

  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data) as WsMessage;
      dispatchMessage(msg);
    } catch { /* ignore invalid JSON */ }
  };

  ws.onerror = () => {
    // Let onclose handle reconnect
  };

  ws.onclose = () => {
    notifyStatus(false);
    globalWs = null;
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.warn('WebSocket: max reconnect attempts reached');
      return;
    }
    reconnectAttempts++;
    const delay = Math.min(3000 * Math.pow(2, reconnectAttempts - 1), 30000);
    reconnectTimer = setTimeout(connect, delay);
  };
}

function disconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (globalWs) {
    const ws = globalWs;
    globalWs = null;
    // Suppress auto-reconnect by removing onclose handler before manual close
    ws.onclose = null;
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  }
  notifyStatus(false);
}

// ── React Context ────────────────────────────────────────────────────────────

const WebSocketContext = createContext<WebSocketContextValue>({
  connected: false,
  subscribe: () => () => {},
});

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const [connected, setConnected] = useState(globalConnected);

  useEffect(() => {
    statusListeners.add(setConnected);
    connect();
    return () => {
      statusListeners.delete(setConnected);
    };
  }, []);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, []);

  const subscribe = useCallback((type: string, handler: (msg: WsMessage) => void) => {
    if (!listeners.has(type)) {
      listeners.set(type, new Set());
    }
    listeners.get(type)!.add(handler);
    return () => {
      listeners.get(type)?.delete(handler);
    };
  }, []);

  return (
    <WebSocketContext.Provider value={{ connected, subscribe }}>
      {children}
    </WebSocketContext.Provider>
  );
}

// ── Hooks ────────────────────────────────────────────────────────────────────

export function useWebSocketEvent(
  type: string,
  handler: (msg: WsMessage) => void,
  deps?: React.DependencyList,
) {
  const { subscribe } = useContext(WebSocketContext);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    return subscribe(type, (msg) => handlerRef.current(msg));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, subscribe, ...(deps || [])]);
}

export function useWebSocketStatus(): boolean {
  const { connected } = useContext(WebSocketContext);
  return connected;
}

// Back-compat: return the raw context for advanced use cases
export function useWebSocket(): WebSocketContextValue {
  return useContext(WebSocketContext);
}
