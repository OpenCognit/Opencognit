import { de } from '../i18n/de';

interface StatusBadgeProps {
  status: string;
}

const statusLabels: Record<string, string> = {
  ...de.status,
};

export function StatusBadge({ status }: StatusBadgeProps) {
  // Map status to CSS modifier
  let modifier = 'idle';
  if (['active', 'done'].includes(status)) modifier = 'active';
  else if (['running', 'in_progress'].includes(status)) modifier = 'running';
  else if (['paused', 'blocked', 'in_review'].includes(status)) modifier = 'paused';
  else if (['error', 'terminated', 'cancelled'].includes(status)) modifier = 'error';

  return (
    <span className={`status-badge status-badge--${modifier}`}>
      <span className="status-dot" />
      {statusLabels[status] || status}
    </span>
  );
}
