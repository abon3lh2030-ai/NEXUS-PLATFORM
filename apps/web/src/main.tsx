import { TooltipProvider } from '@nexus/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { useTranslation } from 'react-i18next';
import { RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import './i18n';
import './styles.css';
import { ApiError } from './lib/api';
import { isConfigured } from './lib/env';
import { SessionProvider } from './providers/session';
import { ThemeProvider, useTheme } from './providers/theme';
import { router } from './router';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      // Never retry authorization/payment/validation failures.
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

function Toasts() {
  const { resolved } = useTheme();
  const { i18n } = useTranslation();
  return <Toaster theme={resolved} richColors position={i18n.language === 'ar' ? 'top-left' : 'top-right'} dir={i18n.language === 'ar' ? 'rtl' : 'ltr'} />;
}

function ConfigNotice() {
  return (
    <div style={{ padding: 32, fontFamily: 'system-ui', maxWidth: 640, margin: '10vh auto' }} dir="rtl">
      <h1>إعداد ناقص / Missing configuration</h1>
      <p>متغيرات VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY و VITE_API_BASE_URL غير مضبوطة. راجع ENV_SETUP.md</p>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isConfigured ? (
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            <TooltipProvider>
              <RouterProvider router={router} />
              <Toasts />
            </TooltipProvider>
          </SessionProvider>
        </QueryClientProvider>
      </ThemeProvider>
    ) : (
      <ConfigNotice />
    )}
  </StrictMode>,
);
