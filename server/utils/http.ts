/**
 * Hilfsfunktion für HTTP-Retries mit Exponential Backoff.
 * Besonders nützlich für die Handhabung von Rate-Limits (429).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelayMs?: number;
    shouldRetry?: (error: any) => boolean;
    onRetry?: (error: any, attempt: number, delay: number) => void;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 2000,
    shouldRetry = (err: any) => {
      // Standardmäßig bei 429 (Rate Limit) und 5xx (Server Fehler) retrien
      if (err.status === 429) return true;
      if (err.status >= 500 && err.status <= 599) return true;
      if (err.message?.toLowerCase().includes('rate limit')) return true;
      if (err.message?.toLowerCase().includes('timeout')) return true;
      return false;
    },
    onRetry = (err, attempt, delay) => {
      console.warn(`[HTTP Retry] Versuch ${attempt} nach Fehler: ${err.message || err.status}. Warte ${delay}ms...`);
    }
  } = options;

  let lastError: any;
  
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      // Wenn wir noch Versuche haben und der Fehler ein Retry wert ist
      if (attempt <= maxRetries && shouldRetry(error)) {
        const delay = initialDelayMs * Math.pow(2, attempt - 1); // 2s, 4s, 8s...
        onRetry(error, attempt, delay);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      // Keine Versuche mehr oder kein Retry-Fehler
      throw error;
    }
  }
  
  throw lastError;
}
