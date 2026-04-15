import { useState, useEffect, useCallback } from 'react';
import { useToast } from '../components/ToastProvider';
import { ApiError } from '../api/client';

type Status = 'idle' | 'loading' | 'success' | 'error';

interface UseApiOptions {
  showToast?: boolean;
  errorMessage?: string;
  retryCount?: number;
  retryDelay?: number;
}

export function useApi<T>(
  fetcher: () => Promise<T>,
  deps: any[] = [],
  options: UseApiOptions = {}
) {
  const { showToast = false, errorMessage, retryCount = 1, retryDelay = 1000 } = options;
  const toast = useToast();
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  // Skip fetch if any dep is null/undefined (e.g. aktivesUnternehmen not loaded yet)
  const enabled = deps.every(d => d !== null && d !== undefined);

  const load = useCallback(async () => {
    if (!enabled) return;
    setStatus('loading');
    setError(null);

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= retryCount; attempt++) {
      try {
        if (attempt > 0) {
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
        const result = await fetcher();
        setData(result);
        setStatus('success');
        return;
      } catch (e: any) {
        lastError = e;
        if (attempt < retryCount) {
          console.warn(`Retry ${attempt + 1}/${retryCount} failed:`, e.message);
        }
      }
    }

    const errorMsg = errorMessage || lastError?.message || 'Unbekannter Fehler';
    setError(errorMsg);
    setStatus('error');

    if (showToast) {
      const title = lastError instanceof ApiError
        ? `Fehler (${lastError.status})`
        : 'Fehler';
      toast.error(title, errorMsg);
    }
  }, [...deps, enabled, showToast, errorMessage, retryCount, retryDelay]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, status, error, loading: status === 'loading', reload: load, setData };
}
