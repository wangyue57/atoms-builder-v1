import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom';
import { Alert, Box, Snackbar } from '@mui/material';
import { AppHeader } from '../components/AppHeader';
import { LoadingState, RecoveryState } from '../components/PageState';
import { useAuth } from '../features/auth/auth-context';
import { useTask } from '../features/tasks/queries';
import { TaskPage } from '../pages/TaskPage';
import { ApiError } from '../api/client';

export function AppLayout() {
  const auth = useAuth();
  const location = useLocation();
  const [logoutError, setLogoutError] = useState('');
  useEffect(() => {
    window.scrollTo(0, 0);
    document.title = 'Atoms Builder · 你的创作工作区';
  }, [location.pathname]);
  return (
    <>
      <AppHeader
        user={auth.user}
        signingOut={auth.signingOut}
        onLogout={() => {
          void auth
            .logout()
            .catch(() => setLogoutError('退出请求未确认，请重新登录前检查网络连接。'));
        }}
      />
      <Outlet />
      <Snackbar
        open={Boolean(logoutError)}
        autoHideDuration={6000}
        onClose={() => setLogoutError('')}
      >
        <Alert severity="warning" onClose={() => setLogoutError('')}>
          {logoutError}
        </Alert>
      </Snackbar>
    </>
  );
}

export function ProtectedRoute() {
  const auth = useAuth();
  const location = useLocation();
  if (auth.loading) return <LoadingState label="正在连接你的工作区…" />;
  if (auth.error && !auth.user)
    return (
      <RecoveryState
        title="暂时无法连接工作区"
        message="请检查网络连接后重新加载。"
        onRetry={auth.retry}
      />
    );
  if (!auth.user)
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}${location.hash}` }}
      />
    );
  return <Outlet key={auth.user.id} />;
}

export function TaskRoute() {
  const { taskId = '' } = useParams();
  const query = useTask(taskId);
  if (query.isPending) return <LoadingState label="正在加载已保存的任务…" />;
  if (query.isLoadingError)
    return (
      <RecoveryState
        title={
          query.error instanceof ApiError && query.error.status === 404
            ? '找不到这个任务'
            : '暂时无法加载任务'
        }
        message={
          query.error instanceof ApiError && query.error.status === 404
            ? '任务可能不存在，或不属于当前账号。你可以从历史任务中继续。'
            : query.error.message
        }
        onRetry={
          query.error instanceof ApiError && query.error.status === 404
            ? undefined
            : () => {
                void query.refetch();
              }
        }
      />
    );
  return (
    <Box>
      {query.isRefetchError && (
        <Alert severity="warning" role="status">
          状态更新暂时中断，正在重新连接。以下为最近一次保存的进度。
        </Alert>
      )}
      <TaskPage key={query.data.id} task={query.data} />
    </Box>
  );
}

export function NotFoundPage() {
  return (
    <RecoveryState title="页面不存在" message="这个地址暂时没有内容，请返回工作区继续创作。" />
  );
}
