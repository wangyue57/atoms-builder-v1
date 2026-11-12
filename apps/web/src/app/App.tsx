import { useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { AppErrorBoundary } from './AppErrorBoundary';
import { AppLayout, NotFoundPage, ProtectedRoute, TaskRoute } from './routes';
import { AuthProvider } from '../features/auth/AuthProvider';
import { AuthPage } from '../pages/AuthPage';
import { HomePage } from '../pages/HomePage';
import { HistoryPage } from '../pages/HistoryPage';
import { createQueryClient } from './query-client';
import { theme } from './theme';

export function App() {
  const [client] = useState(createQueryClient);
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppErrorBoundary>
        <QueryClientProvider client={client}>
          <AuthProvider>
            <BrowserRouter>
              <Routes>
                <Route element={<AppLayout />}>
                  <Route path="login" element={<AuthPage key="login" mode="login" />} />
                  <Route path="register" element={<AuthPage key="register" mode="register" />} />
                  <Route element={<ProtectedRoute />}>
                    <Route index element={<HomePage />} />
                    <Route path="tasks" element={<HistoryPage />} />
                    <Route path="tasks/:taskId" element={<TaskRoute />} />
                  </Route>
                  <Route path="*" element={<NotFoundPage />} />
                </Route>
              </Routes>
            </BrowserRouter>
          </AuthProvider>
        </QueryClientProvider>
      </AppErrorBoundary>
    </ThemeProvider>
  );
}
