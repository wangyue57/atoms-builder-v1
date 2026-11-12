import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Box, Button, IconButton, Stack, Tab, Tabs, Tooltip, Typography } from '@mui/material';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import AddRounded from '@mui/icons-material/AddRounded';
import type { ApplicationTask } from '@atoms-builder/contracts';
import { Link as RouterLink } from 'react-router-dom';
import { PreviewPanel } from '../components/PreviewPanel';
import { ConversationPanel } from '../components/ConversationPanel';
import { RequestComposer } from '../components/RequestComposer';
import { TaskStatus } from '../components/TaskStatus';
import { formatTaskDate } from '../features/tasks/format-task-date';
import { isTaskActive, useTaskSubmission } from '../features/tasks/queries';

export function TaskPage({ task }: { task: ApplicationTask }) {
  const [request, setRequest] = useState(task.phase === 'failed' ? task.lastRequest : '');
  const [tab, setTab] = useState(0);
  useEffect(() => {
    if (task.phase === 'failed') setRequest((current) => current || task.lastRequest);
  }, [task.phase, task.lastRequest]);
  const submission = useTaskSubmission(task.id);
  const busy = isTaskActive(task);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || submission.isPending) return;
    try {
      const result = await submission.submit(request);
      if (result) setRequest('');
    } catch {
      /* Preserve the edit for a safe retry. */
    }
  }
  const versionNumber = task.runs.filter((run) => run.status === 'completed').length;
  return (
    <Box component="main" id="task-view" className="task-page">
      <Stack direction="row" alignItems="center" gap={1.5} className="task-toolbar">
        <Tooltip title="返回历史任务">
          <IconButton
            component={RouterLink}
            to="/tasks"
            id="home-button"
            aria-label="返回历史任务"
            size="small"
          >
            <ArrowBackRounded fontSize="small" />
          </IconButton>
        </Tooltip>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography component="h1" id="task-title" variant="h4" noWrap title={task.title}>
            {task.title}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
            已保存 · {formatTaskDate(task.updatedAt)}
          </Typography>
        </Box>
        <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
          <TaskStatus phase={task.phase} />
        </Box>
        <Button
          id="new-task"
          component={RouterLink}
          to="/"
          startIcon={<AddRounded />}
          sx={{ flexShrink: 0 }}
        >
          新建任务
        </Button>
      </Stack>
      <Tabs
        value={tab}
        onChange={(_, next: number) => setTab(next)}
        variant="fullWidth"
        className="workspace-mobile-tabs"
        aria-label="工作区视图"
      >
        <Tab id="activity-tab" aria-controls="activity-panel" label="需求与进展" />
        <Tab id="preview-tab" aria-controls="preview-panel" label="作品预览" />
      </Tabs>
      <Box className="task-workspace">
        <Box
          id="activity-panel"
          className={`activity-panel ${tab === 0 ? 'mobile-active' : ''}`}
          aria-label="需求与进展"
        >
          <ConversationPanel task={task} visible={tab === 0} />
          <Box className="followup-dock">
            <Typography variant="caption" fontWeight={500} sx={{ display: 'block', mb: 1 }}>
              {task.phase === 'failed' ? '调整需求，再试一次' : '继续对话，完善你的作品'}
            </Typography>
            <RequestComposer
              id="followup-request"
              value={request}
              onChange={setRequest}
              onSubmit={submit}
              busy={busy}
              pending={submission.isPending}
              error={submission.error}
            />
          </Box>
        </Box>
        <Box
          id="preview-panel"
          className={`workspace-preview ${tab === 1 ? 'mobile-active' : ''}`}
          aria-label="作品预览"
        >
          <PreviewPanel
            html={task.previewHtml}
            versionId={task.currentVersionId}
            phase={task.phase}
            versionLabel={
              task.currentVersionId
                ? `版本 ${versionNumber || 1}${busy || task.phase === 'failed' ? ' · 上次完成' : ' · 最新'}`
                : '等待首次生成'
            }
          />
        </Box>
      </Box>
    </Box>
  );
}
