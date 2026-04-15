import { useQuery } from '@tanstack/react-query';
import { apiHealth, apiUnternehmen } from '../api/client';
import { queryKeys } from '../lib/queryKeys';

export function useSystemStatus() {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.system.status,
    queryFn: async () => {
      try {
        // Check if server is reachable
        await apiHealth.check();

        // Check if registration is needed (no users)
        const token = localStorage.getItem('opencognit_token');
        if (!token) {
          // No token = not logged in, check if any users exist
          try {
            const statusRes = await fetch('/api/system/status');
            if (statusRes.ok) {
              const status = await statusRes.json();
              return {
                needsSetup: status.needsSetup,
                brauchtRegistrierung: status.brauchtRegistrierung,
                isHealthy: true,
              };
            }
          } catch {
            // Fallback: assume registration needed
            return {
              needsSetup: true,
              brauchtRegistrierung: true,
              isHealthy: false,
            };
          }
        }

        // Logged in: check if setup is needed (no companies)
        try {
          const unternehmen = await apiUnternehmen.liste();
          return {
            needsSetup: unternehmen.length === 0,
            brauchtRegistrierung: false,
            isHealthy: true,
          };
        } catch {
          return {
            needsSetup: true,
            brauchtRegistrierung: false,
            isHealthy: true,
          };
        }
      } catch (err) {
        // Server nicht erreichbar
        return {
          needsSetup: true,
          brauchtRegistrierung: true,
          isHealthy: false,
        };
      }
    },
    retry: false,
    refetchInterval: 5000,
  });

  return {
    needsSetup: data?.needsSetup ?? false,
    brauchtRegistrierung: data?.brauchtRegistrierung ?? false,
    isLoading,
    error: error instanceof Error ? error.message : null,
  };
}
