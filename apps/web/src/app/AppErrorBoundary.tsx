import { Component } from 'react';
import type { ReactNode } from 'react';
import { Button, Container, Paper, Stack, Typography } from '@mui/material';

export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <Container maxWidth="sm" sx={{ py: 10 }}>
          <Paper variant="outlined" role="alert" sx={{ p: 5, textAlign: 'center' }}>
            <Stack spacing={2}>
              <Typography component="h1" variant="h2">
                页面暂时遇到问题
              </Typography>
              <Typography color="text.secondary" variant="body2">
                任务已保存在工作区。请重新打开页面，后台运行会继续。
              </Typography>
              <Button variant="contained" onClick={() => window.location.assign('/')}>
                重新打开工作区
              </Button>
            </Stack>
          </Paper>
        </Container>
      );
    return this.props.children;
  }
}
