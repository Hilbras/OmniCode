import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ApiProvider } from './api/provider';
import './theme.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const DAEMON_ORIGIN =
  (window as { __DAEMON_ORIGIN__?: string }).__DAEMON_ORIGIN__ ??
  window.location.origin;

const rootEl = document.querySelector('#root');
if (!rootEl) throw new Error('#root not found');

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ApiProvider origin={DAEMON_ORIGIN}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ApiProvider>
    </QueryClientProvider>
  </StrictMode>,
);
