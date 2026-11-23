import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '../index.css';
import { FeedbackProvider } from '../components/ui';
import { PlatformApp } from './PlatformApp';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 5000 } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <FeedbackProvider>
          <PlatformApp />
        </FeedbackProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
