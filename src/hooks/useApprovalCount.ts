import { useState, useEffect, useCallback } from 'react';
import { useToast } from '../components/ToastProvider';
import { useCompany } from './useCompany';
import { useWebSocketEvent } from './useWebSocket';

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

    // Fallback polling — re-fetch every 30s even if WS fails
    const pollId = setInterval(fetchCount, 30_000);
    return () => { clearInterval(pollId); };
  }, [aktivesUnternehmen?.id, fetchCount]);

  useWebSocketEvent('approval_updated', (msg) => {
    if (msg.data?.unternehmenId && msg.data.unternehmenId !== aktivesUnternehmen?.id) return;
    fetchCount();
    window.dispatchEvent(new CustomEvent('opencognit:approval-changed', {
      detail: { unternehmenId: msg.data?.unternehmenId || msg.unternehmenId, status: msg.data?.status || msg.status },
    }));
  }, [aktivesUnternehmen?.id, fetchCount]);

  useWebSocketEvent('approval_created', (msg) => {
    if (msg.data?.unternehmenId && msg.data.unternehmenId !== aktivesUnternehmen?.id) return;
    setGlobalCount(globalCount + 1);
    const agentName = msg.data?.agentName || 'Ein Agent';
    const actionName = msg.data?.action || msg.data?.titel || 'eine Aktion';
    toast.warning('Genehmigung erforderlich', `${agentName} möchte "${actionName}" ausführen`);
    window.dispatchEvent(new CustomEvent('opencognit:approval-changed', {
      detail: { unternehmenId: msg.data?.unternehmenId || msg.unternehmenId, status: 'pending' },
    }));
  }, [aktivesUnternehmen?.id]);

  useWebSocketEvent('approval_requested', (msg) => {
    if (msg.data?.unternehmenId && msg.data.unternehmenId !== aktivesUnternehmen?.id) return;
    setGlobalCount(globalCount + 1);
    const agentName = msg.data?.agentName || 'Ein Agent';
    const actionName = msg.data?.action || msg.data?.titel || 'eine Aktion';
    toast.warning('Genehmigung erforderlich', `${agentName} möchte "${actionName}" ausführen`);
    window.dispatchEvent(new CustomEvent('opencognit:approval-changed', {
      detail: { unternehmenId: msg.data?.unternehmenId || msg.unternehmenId, status: 'pending' },
    }));
  }, [aktivesUnternehmen?.id]);

  useWebSocketEvent('task_completed', (msg) => {
    if (msg.data?.unternehmenId && msg.data.unternehmenId !== aktivesUnternehmen?.id) return;
    const agentName = msg.data?.agentName || 'Agent';
    const taskTitle = msg.data?.titel || 'Task';
    toast.success('Task abgeschlossen', `${agentName}: ${taskTitle}`);
  }, [aktivesUnternehmen?.id]);

  useWebSocketEvent('meeting_created', (msg) => {
    if (msg.data?.unternehmenId && msg.data.unternehmenId !== aktivesUnternehmen?.id) return;
    const { veranstalterName, titel, teilnehmerIds } = msg.data || {};
    toast.agent(`Meeting: ${veranstalterName || 'CEO'}`, `"${titel}" · ${(teilnehmerIds?.length || 0)} Teilnehmer eingeladen`);
  }, [aktivesUnternehmen?.id]);

  useWebSocketEvent('task_started', (msg) => {
    if (msg.data?.unternehmenId && msg.data.unternehmenId !== aktivesUnternehmen?.id) return;
    const agentName = msg.data?.agentName || 'Agent';
    const taskTitle = msg.data?.titel || 'Task';
    toast.info('Agent arbeitet...', `${agentName} hat begonnen: ${taskTitle}`);
  }, [aktivesUnternehmen?.id]);

  useWebSocketEvent('chat_message', (msg) => {
    if (msg.data?.unternehmenId && msg.data.unternehmenId !== aktivesUnternehmen?.id) return;
    const { absenderTyp, absenderName, nachricht } = msg.data || {};
    if (absenderTyp === 'agent') {
      const preview = typeof nachricht === 'string'
        ? nachricht.slice(0, 80) + (nachricht.length > 80 ? '…' : '')
        : '';
      toast.agent(absenderName || 'Agent', preview, msg.data?.onClick);
    } else if (absenderTyp === 'system' && typeof nachricht === 'string' && nachricht.toLowerCase().includes('fehler')) {
      toast.error('System-Fehler', nachricht.slice(0, 100));
    }
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
