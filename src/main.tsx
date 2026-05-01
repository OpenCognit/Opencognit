import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { ToastProvider } from './components/ToastProvider';
import { ErrorBoundary } from './components/ErrorBoundary';
import { I18nProvider } from './i18n';
import { WebSocketProvider } from './hooks/useWebSocket';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 Minuten
      retry: 1,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <I18nProvider>
        <QueryClientProvider client={queryClient}>
          <WebSocketProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </WebSocketProvider>
        </QueryClientProvider>
      </I18nProvider>
    </ErrorBoundary>
  </StrictMode>
);
