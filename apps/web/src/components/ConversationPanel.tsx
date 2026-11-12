import { useLayoutEffect, useRef } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Avatar,
  Box,
  Stack,
  Typography,
} from '@mui/material';
import AutoAwesomeRounded from '@mui/icons-material/AutoAwesomeRounded';
import CheckCircleOutlineRounded from '@mui/icons-material/CheckCircleOutlineRounded';
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import type { ApplicationTask } from '@atoms-builder/contracts';
import { formatTaskDate } from '../features/tasks/format-task-date';
import { StatusPanel } from './StatusPanel';
import { ReviewPanel } from './ReviewPanel';

/** A conversation is a projection of persisted runs, not invented Agent messages. */
export function ConversationPanel({ task, visible }: { task: ApplicationTask; visible: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const previousRun = useRef<string | undefined>(undefined);
  const latest = task.runs[0];
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (stickToBottom.current || previousRun.current !== latest?.id) {
      element.scrollTop = element.scrollHeight;
    }
    previousRun.current = latest?.id;
  }, [latest?.id, latest?.status, task.error, visible]);

  return (
    <Box
      ref={scrollRef}
      className="activity-scroll"
      onScroll={(event) => {
        const element = event.currentTarget;
        stickToBottom.current =
          element.scrollHeight - element.scrollTop - element.clientHeight < 80;
      }}
    >
      <Typography className="conversation-intro" variant="caption" color="text.secondary">
        与 Atoms 一起构建 · {task.runs.length} 轮对话
      </Typography>
      <Box component="ol" className="conversation" aria-label="对话记录">
        {[...task.runs].reverse().map((run, index) => (
          <Box component="li" className="conversation-turn" key={run.id} data-run-id={run.id}>
            <Box className="chat-user">
              <Typography component="time" dateTime={run.createdAt} variant="caption">
                你 · {formatTaskDate(run.createdAt)}
              </Typography>
              <Box className="chat-user-bubble">{run.request}</Box>
            </Box>
            <Box className="chat-assistant">
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
                <Avatar className="assistant-avatar">
                  <AutoAwesomeRounded sx={{ fontSize: 16 }} />
                </Avatar>
                <Typography variant="body2" fontWeight={600}>
                  Atoms
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  第 {index + 1} 轮{index === 0 ? '构建' : '修改'}
                </Typography>
              </Stack>
              {run.id === latest?.id ? (
                <StatusPanel task={task} />
              ) : (
                <Stack className="chat-response" direction="row" alignItems="flex-start" gap={1}>
                  {run.status === 'completed' ? (
                    <CheckCircleOutlineRounded color="success" sx={{ fontSize: 18, mt: 0.2 }} />
                  ) : (
                    <ErrorOutlineRounded color="error" sx={{ fontSize: 18, mt: 0.2 }} />
                  )}
                  <Typography variant="body2" color="text.secondary">
                    {run.status === 'completed'
                      ? '本轮构建已完成，作品已保存。'
                      : run.error || '本轮构建未完成，可继续提出修改。'}
                  </Typography>
                </Stack>
              )}
              {task.result?.runId === run.id && (
                <Accordion disableGutters className="review-accordion">
                  <AccordionSummary expandIcon={<ExpandMoreRounded sx={{ fontSize: 18 }} />}>
                    <Typography variant="caption">已保存版本的源码审查</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <ReviewPanel result={task.result} />
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: 'block', mt: 2, overflowWrap: 'anywhere' }}
                    >
                      版本 ID <span id="version">{task.result.versionId}</span>
                    </Typography>
                  </AccordionDetails>
                </Accordion>
              )}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
