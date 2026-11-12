import { useQuery } from '@tanstack/react-query';
import { useSearchParams, Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Container,
  Pagination,
  Stack,
  Typography,
} from '@mui/material';
import AddRounded from '@mui/icons-material/AddRounded';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import FolderOpenOutlined from '@mui/icons-material/FolderOpenOutlined';
import { applicationClient } from '../api/client';
import { queryKeys } from '../app/query-client';
import { TaskStatus } from '../components/TaskStatus';
import { formatTaskDate } from '../features/tasks/format-task-date';
import { LoadingState } from '../components/PageState';

export function HistoryPage() {
  const [params, setParams] = useSearchParams();
  const rawPage = params.get('page') ?? '1';
  const parsedPage = /^\d+$/.test(rawPage) ? Number(rawPage) : 1;
  const page = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const query = useQuery({
    queryKey: queryKeys.list(page),
    queryFn: ({ signal }) => applicationClient.tasks(page, signal),
    refetchInterval: (data) =>
      data.state.data?.tasks.some((task) => task.phase === 'queued' || task.phase === 'running')
        ? 3000
        : false,
  });
  return (
    <Container component="main" maxWidth="lg" sx={{ py: { xs: 4, md: 7 }, px: { xs: 2, md: 5 } }}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        gap={2}
        sx={{ mb: 5 }}
      >
        <Box>
          <Typography component="h1" variant="h2">
            历史任务
          </Typography>
          <Typography color="text.secondary" variant="body2" sx={{ mt: 1 }}>
            所有作品都在这里，随时继续上次的想法。
          </Typography>
        </Box>
        <Button
          component={RouterLink}
          to="/"
          variant="contained"
          startIcon={<AddRounded />}
          sx={{ flexShrink: 0 }}
        >
          新建任务
        </Button>
      </Stack>
      {query.isRefetchError && (
        <Alert
          severity="warning"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" onClick={() => void query.refetch()}>
              重试
            </Button>
          }
        >
          暂时无法更新，当前展示上次加载的任务。
        </Alert>
      )}
      {query.isPending ? (
        <LoadingState label="正在加载任务历史…" />
      ) : query.isLoadingError ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" onClick={() => void query.refetch()}>
              重试
            </Button>
          }
        >
          {query.error.message}
        </Alert>
      ) : query.data.tasks.length ? (
        <>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
            共 {query.data.total} 个任务 · 按最近更新排列
          </Typography>
          <Box className="history-list">
            {query.data.tasks.map((task) => (
              <ButtonBase
                component={RouterLink}
                to={`/tasks/${task.id}`}
                key={task.id}
                className="history-row"
                aria-label={`继续编辑 ${task.title}`}
                sx={{ width: '100%', textAlign: 'left', justifyContent: 'flex-start' }}
              >
                <Box
                  sx={{
                    width: 42,
                    height: 42,
                    borderRadius: 2,
                    display: { xs: 'none', sm: 'grid' },
                    placeItems: 'center',
                    bgcolor: 'primary.light',
                    color: 'primary.main',
                    flexShrink: 0,
                  }}
                >
                  <FolderOpenOutlined fontSize="small" />
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography component="h2" variant="body2" fontWeight={600} noWrap>
                    {task.title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {formatTaskDate(task.updatedAt)}
                  </Typography>
                </Box>
                <TaskStatus phase={task.phase} />
                <ArrowForwardRounded
                  sx={{
                    fontSize: 18,
                    color: 'text.secondary',
                    display: { xs: 'none', sm: 'block' },
                  }}
                />
              </ButtonBase>
            ))}
          </Box>
          {query.data.total > query.data.pageSize && (
            <Stack alignItems="center" sx={{ mt: 4 }}>
              <Pagination
                page={page}
                count={Math.ceil(query.data.total / query.data.pageSize)}
                color="primary"
                size="small"
                onChange={(_, next) => {
                  setParams({ page: String(next) });
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              />
            </Stack>
          )}
        </>
      ) : (
        <Box
          sx={{
            py: 10,
            textAlign: 'center',
            border: '1px dashed',
            borderColor: 'divider',
            borderRadius: 3,
          }}
        >
          <FolderOpenOutlined sx={{ fontSize: 40, color: 'primary.main', mb: 2 }} />
          <Typography variant="h3" component="h2">
            {page > 1 ? '这一页没有任务' : '从第一个想法开始'}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 3 }}>
            {page > 1
              ? '返回前面的页面查看已保存的任务。'
              : '创建一个任务，你的作品和每次修改都会保存在这里。'}
          </Typography>
          {page > 1 ? (
            <Button onClick={() => setParams({ page: '1' })}>返回第一页</Button>
          ) : (
            <Button component={RouterLink} to="/" variant="contained" startIcon={<AddRounded />}>
              开始构建
            </Button>
          )}
        </Box>
      )}
    </Container>
  );
}
