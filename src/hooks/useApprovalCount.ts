import { useState, useEffect, useRef, useCallback } from 'react';
import { useToast } from '../components/ToastProvider';
import { useCompany } from './useCompany';

import { authFetch } from '../utils/api';

let globalCount = 0;
const listeners: Set<(n: number) => void> = new Set();

function setGlobalCount(n: number) {
  globalCount = n;
  listeners.forEach(fn => fn(n));
}

/** Singleton WS approval notifier — mounted once in Layout */
export function useApprovalNotifier() {
  const { aktivesUnternehmen } = useCompany();
  const toast = useToast();
  const wsRef = useRef<WebSocket | null>(null);

  const fetchCount = useCallback(async () => {
    if (!aktivesUnternehmen) return;
    try {
      const r = await authFetch(`/api/unternehmen/${aktivesUnternehmen.id}/genehmigungen`);
      const data = await r.json();
      const pending = Array.isArray(data) ? data.filter((g: any) => g.status === 'pending').length : 0;
      setGlobalCount(pending);
    } catch {}
  }, [aktivesUnternehmen]);

  useEffect(() => {
    if (!aktivesUnternehmen) return;
    fetchCount();

    const _tok = localStorage.getItem('opencognit_token') || '';
    const wsUrl = (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + '/ws' + (_tok ? `?token=${_tok}` : '');
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.data?.unternehmenId && msg.data.unternehmenId !== aktivesUnternehmen.id) return;

        if (msg.type === 'approval_updated') {
          // Re-fetch the real count after an approve/reject decision
          fetchCount();
        }

        else if (msg.type === 'approval_created') {
          setGlobalCount(globalCount + 1);
          const agentName = msg.data?.agentName || 'Ein Agent';
          const actionName = msg.data?.action || 'eine Aktion';
          toast.warning(
            'Genehmigung erforderlich',
            `${agentName} möchte "${actionName}" ausführen`
          );
        }

        else if (msg.type === 'task_completed') {
          const agentName = msg.data?.agentName || 'Agent';
          const taskTitle = msg.data?.titel || 'Task';
          toast.success(
            'Task abgeschlossen',
            `${agentName}: ${taskTitle}`
          );
        }

        else if (msg.type === 'meeting_created') {
          const { veranstalterName, titel, teilnehmerIds } = msg.data || {};
          toast.agent(
            `Meeting: ${veranstalterName || 'CEO'}`,
            `"${titel}" · ${(teilnehmerIds?.length || 0)} Teilnehmer eingeladen`,
          );
        }

        else if (msg.type === 'task_started') {
          const agentName = msg.data?.agentName || 'Agent';
          const taskTitle = msg.data?.titel || 'Task';
          toast.info(
            'Agent arbeitet...',
            `${agentName} hat begonnen: ${taskTitle}`
          );
        }

        else if (msg.type === 'chat_message') {
          const { absenderTyp, absenderName, nachricht } = msg.data || {};
          if (absenderTyp === 'agent') {
            const preview = typeof nachricht === 'string'
              ? nachricht.slice(0, 80) + (nachricht.length > 80 ? '…' : '')
              : '';
            toast.agent(
              absenderName || 'Agent',
              preview,
              msg.data?.onClick
            );
          } else if (absenderTyp === 'system' && typeof nachricht === 'string' && nachricht.toLowerCase().includes('fehler')) {
            toast.error('System-Fehler', nachricht.slice(0, 100));
          }
        }

      } catch {}
    };

    return () => { ws.close(); wsRef.current = null; };
  }, [aktivesUnternehmen?.id]);

  return { fetchCount };
}

/** Lightweight hook for any component just needing the count (e.g. Sidebar) */
export function useApprovalCount() {
  const [count, setCount] = useState(globalCount);

  useEffect(() => {
    setCount(globalCount);
    listeners.add(setCount);
    return () => { listeners.delete(setCount); };
  }, []);

  return count;
}
