import { useRef } from 'react';
import type { FormEvent, Ref } from 'react';
import {
  Alert,
  Button,
  CircularProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ArrowUpwardRounded from '@mui/icons-material/ArrowUpwardRounded';

interface RequestComposerProps {
  id: 'request' | 'followup-request';
  value: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  inputRef?: Ref<HTMLTextAreaElement>;
  pending?: boolean;
  busy?: boolean;
  error?: Error | null;
}

/** Shared keyboard semantics, including IME confirmation and held-key protection. */
export function RequestComposer({
  id,
  value,
  onChange,
  onSubmit,
  inputRef,
  pending = false,
  busy = false,
  error,
}: RequestComposerProps) {
  const composing = useRef(false);
  const home = id === 'request';
  const disabled = pending || busy || !value.trim();
  return (
    <Paper
      component="form"
      id={home ? 'run-form' : 'followup-form'}
      onSubmit={onSubmit}
      className={`request-composer ${home ? 'home-composer' : ''}`}
      variant="outlined"
    >
      <TextField
        id={id}
        inputRef={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={
          home
            ? '描述你想做的网站、应用，或一个尚未成形的想法…'
            : busy
              ? '可以先写下下一步想修改的内容…'
              : '描述想调整的细节，继续完善作品…'
        }
        multiline
        minRows={home ? 3 : 2}
        maxRows={home ? 8 : 5}
        fullWidth
        required
        variant="standard"
        disabled={pending}
        slotProps={{
          input: { disableUnderline: true },
          htmlInput: {
            maxLength: 10_000,
            'aria-label': home ? '构建需求' : '修改需求',
            'aria-describedby': `${id}-hint`,
          },
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={(event) => {
          if (
            event.key !== 'Enter' ||
            event.shiftKey ||
            event.nativeEvent.isComposing ||
            composing.current ||
            event.keyCode === 229
          )
            return;
          event.preventDefault();
          if (!disabled && !event.repeat) event.currentTarget.closest('form')?.requestSubmit();
        }}
      />
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        gap={1}
        sx={{ mt: 2 }}
      >
        <Typography
          id={`${id}-hint`}
          variant="caption"
          color="text.secondary"
          sx={{ fontSize: 11 }}
        >
          {busy ? '本轮完成后可发送' : 'Enter 发送 · Shift + Enter 换行'}
        </Typography>
        <Button
          id={home ? 'submit' : 'followup-submit'}
          type="submit"
          variant="contained"
          disabled={disabled}
          endIcon={
            pending ? (
              <CircularProgress size={16} color="inherit" />
            ) : (
              <ArrowUpwardRounded fontSize="small" />
            )
          }
          sx={{ flexShrink: 0 }}
        >
          {pending ? '正在提交' : home ? '开始构建' : '发送修改'}
        </Button>
      </Stack>
      {value.length >= 9500 && (
        <Typography color="text.secondary" variant="caption">
          {value.length.toLocaleString()} / 10,000
        </Typography>
      )}
      {error && (
        <Alert id="error" severity="error" sx={{ mt: 2 }}>
          {error.message}
        </Alert>
      )}
    </Paper>
  );
}
