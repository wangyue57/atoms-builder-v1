import { Chip } from '@mui/material';
import type { ApplicationTaskSummary } from '@atoms-builder/contracts';

export function TaskStatus({ phase }: { phase: ApplicationTaskSummary['phase'] }) {
  const status = {
    queued: { label: '等待构建', color: 'warning' },
    running: { label: '构建中', color: 'primary' },
    succeeded: { label: '构建完成', color: 'success' },
    failed: { label: '需要处理', color: 'error' },
  } as const;
  return (
    <Chip
      size="small"
      color={status[phase].color}
      label={status[phase].label}
      variant="outlined"
      sx={{ height: 25, fontSize: 11 }}
    />
  );
}
