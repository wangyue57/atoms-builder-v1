import { useState } from 'react';
import type { FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Link,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffOutlined from '@mui/icons-material/VisibilityOffOutlined';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import { Link as RouterLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { accountInputSchema } from '@atoms-builder/contracts';
import { safeReturnPath, useAuth } from '../features/auth/auth-context';

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = safeReturnPath((location.state as { from?: unknown } | null)?.from);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const registering = mode === 'register';
  if (auth.user) return <Navigate to={returnTo} replace />;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const input = accountInputSchema.safeParse({ username, password });
    if (!input.success) {
      setError('用户名需为 3–32 位字母、数字或下划线，密码需为 8–128 位。');
      return;
    }
    setPending(true);
    setError('');
    try {
      await auth[mode](input.data);
      void navigate(returnTo, { replace: true });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '暂时无法完成，请重试。');
    } finally {
      setPending(false);
    }
  }
  return (
    <Container component="main" maxWidth="lg" sx={{ py: { xs: 4, md: 9 } }}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
          gap: { xs: 4, md: 10 },
          alignItems: 'center',
        }}
      >
        <Box sx={{ display: { xs: 'none', md: 'block' }, maxWidth: 450 }}>
          <Typography color="primary" variant="overline" letterSpacing={3}>
            从想法，到作品
          </Typography>
          <Typography variant="h1" sx={{ fontSize: 46, mt: 2 }}>
            专注创造，
            <br />
            让想法自然发生。
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 3, lineHeight: 2 }}>
            从第一版页面到每一次打磨，任务与作品保存在你的工作区，随时回来，继续创造。
          </Typography>
          <Stack spacing={2} sx={{ mt: 5 }}>
            {['从自然语言开始构建', '自动保存任务与运行历史', '边预览，边完善你的作品'].map(
              (text, index) => (
                <Stack direction="row" alignItems="center" spacing={1.5} key={text}>
                  <Box
                    sx={{
                      bgcolor: 'primary.light',
                      color: 'primary.main',
                      borderRadius: 2,
                      width: 28,
                      height: 28,
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: 12,
                    }}
                  >
                    {String(index + 1).padStart(2, '0')}
                  </Box>
                  <Typography variant="body2" color="text.secondary">
                    {text}
                  </Typography>
                </Stack>
              ),
            )}
          </Stack>
        </Box>
        <Paper
          variant="outlined"
          sx={{ p: { xs: 3, md: 5 }, borderRadius: 2, maxWidth: 460, width: '100%', mx: 'auto' }}
        >
          <Typography component="h1" variant="h2">
            {registering ? '创建你的工作区' : '欢迎回到 Atoms'}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 4 }}>
            {registering ? '创建账号，开始构建并保存你的作品。' : '登录后继续你的任务与创作。'}
          </Typography>
          <Stack component="form" onSubmit={submit} spacing={2.5}>
            <TextField
              id={`${mode}-username`}
              label="用户名"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              autoComplete="username"
              autoFocus
              disabled={pending}
              slotProps={{
                htmlInput: {
                  minLength: 3,
                  maxLength: 32,
                  pattern: '[A-Za-z0-9_]+',
                },
              }}
              helperText={registering ? '3–32 位字母、数字或下划线，不区分大小写' : undefined}
            />
            <TextField
              id={`${mode}-password`}
              label="密码"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              autoComplete={registering ? 'new-password' : 'current-password'}
              disabled={pending}
              slotProps={{
                htmlInput: { minLength: 8, maxLength: 128 },
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        aria-label={showPassword ? '隐藏密码' : '显示密码'}
                        edge="end"
                        onClick={() => setShowPassword(!showPassword)}
                        onMouseDown={(event) => event.preventDefault()}
                      >
                        {showPassword ? (
                          <VisibilityOffOutlined fontSize="small" />
                        ) : (
                          <VisibilityOutlined fontSize="small" />
                        )}
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
              helperText={registering ? '至少 8 位，最多 128 位' : undefined}
            />
            {error && (
              <Alert severity="error" role="alert">
                {error}
              </Alert>
            )}
            <Button
              id={`${mode}-submit`}
              type="submit"
              variant="contained"
              size="large"
              disabled={pending}
              endIcon={
                pending ? <CircularProgress size={17} color="inherit" /> : <ArrowForwardRounded />
              }
            >
              {pending ? '正在处理' : registering ? '注册并开始创作' : '登录工作区'}
            </Button>
          </Stack>
          <Typography variant="body2" color="text.secondary" textAlign="center" sx={{ mt: 3 }}>
            {registering ? '已经有账号？' : '还没有账号？'}{' '}
            <Link
              component={RouterLink}
              to={registering ? '/login' : '/register'}
              state={{ from: returnTo }}
              underline="hover"
            >
              {registering ? '前往登录' : '创建账号'}
            </Link>
          </Typography>
        </Paper>
      </Box>
    </Container>
  );
}
