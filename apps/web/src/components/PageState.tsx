import {
  Box,
  Button,
  CircularProgress,
  Container,
  Paper,
  Stack,
  Typography,
  Alert,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

export function LoadingState({ label = '正在加载…' }: { label?: string }) {
  return (
    <Stack
      role="status"
      alignItems="center"
      justifyContent="center"
      spacing={2}
      sx={{ minHeight: 280 }}
    >
      <CircularProgress size={28} />
      <Typography color="text.secondary" variant="body2">
        {label}
      </Typography>
    </Stack>
  );
}

export function RecoveryState({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <Container maxWidth="sm" sx={{ py: 8 }}>
      <Paper variant="outlined" sx={{ p: { xs: 3, md: 5 }, textAlign: 'center' }}>
        <Box
          sx={{ width: 46, height: 5, bgcolor: 'primary.main', borderRadius: 8, mx: 'auto', mb: 3 }}
        />
        <Typography component="h1" variant="h2" gutterBottom>
          {title}
        </Typography>
        <Typography color="text.secondary" variant="body2" sx={{ mb: 3 }}>
          {message}
        </Typography>
        <Stack direction="row" justifyContent="center" spacing={1}>
          {onRetry && (
            <Button variant="contained" onClick={onRetry}>
              重新加载
            </Button>
          )}
          <Button component={RouterLink} to="/" variant="outlined">
            返回首页
          </Button>
        </Stack>
      </Paper>
    </Container>
  );
}

export function ErrorNotice({ error }: { error: Error | null }) {
  return error ? (
    <Alert id="error" severity="error" role="alert">
      {error.message}
    </Alert>
  ) : null;
}
