import { useEffect, useState } from 'react';
import { Alert, Box, CircularProgress, Stack, Typography } from '@mui/material';
import CheckRounded from '@mui/icons-material/CheckRounded';
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded';
import type { ApplicationTask } from '@atoms-builder/contracts';
import { isTaskActive } from '../features/tasks/queries';

function formatElapsed(startedAt: string | undefined, now: number) {
  if (!startedAt) return '刚刚';
  const seconds = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${minutes} 分 ${seconds % 60} 秒`
    : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

export function StatusPanel({ task }: { task: ApplicationTask }) {
  const busy = isTaskActive(task);
  const activeRun = task.runs.find((run) => run.status === 'queued' || run.status === 'running');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);
  const longRunning = activeRun && now - Date.parse(activeRun.createdAt) > 90_000;
  const failed = task.phase === 'failed';
  const title =
    task.phase === 'queued'
      ? '已收到，正在等待开始'
      : busy
        ? '正在构建你的作品'
        : failed
          ? '这次构建未能完成'
          : '作品已就绪';
  return (
    <Box id="task-progress" className={`task-progress ${failed ? 'is-failed' : ''}`}>
      <Stack direction="row" gap={1.5} alignItems="center">
        <Box className="progress-symbol">
          {busy ? (
            <CircularProgress size={19} aria-label="任务处理中" />
          ) : failed ? (
            <ErrorOutlineRounded color="error" />
          ) : (
            <CheckRounded color="success" />
          )}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography component="h2" variant="body2" fontWeight={600} role="status">
            {title}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {busy
              ? `提交已过 ${formatElapsed(activeRun?.createdAt, now)} · 自动更新`
              : failed
                ? task.previewHtml
                  ? '上一版作品已保留，可调整需求后重试'
                  : '可调整需求后重新提交'
                : '查看预览，或继续提出修改'}
          </Typography>
        </Box>
      </Stack>
      {busy && (
        <>
          <Box className="progress-steps" aria-label="构建进度">
            {['需求已保存', '生成与审查', '预览就绪'].map((label, index) => (
              <Box
                key={label}
                className={
                  index === 0 ? 'complete' : index === 1 && task.phase === 'running' ? 'active' : ''
                }
              >
                <span />
                <Typography variant="caption">{label}</Typography>
              </Box>
            ))}
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
            {longRunning
              ? '本次处理时间较长，完成后会自动更新。你可以离开页面，稍后从历史任务继续。'
              : task.phase === 'queued'
                ? '任务已保存，开始后会自动更新。无需重复提交。'
                : '正在生成页面并进行源码审查。离开页面不会中断任务。'}
          </Typography>
        </>
      )}
      {task.error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {task.error}
        </Alert>
      )}
    </Box>
  );
}
