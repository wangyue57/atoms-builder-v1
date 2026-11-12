import { useState } from 'react';
import {
  AppBar,
  Avatar,
  Box,
  Button,
  Container,
  Menu,
  MenuItem,
  Stack,
  Toolbar,
  Typography,
} from '@mui/material';
import KeyboardArrowDownRounded from '@mui/icons-material/KeyboardArrowDownRounded';
import LogoutRounded from '@mui/icons-material/LogoutRounded';
import { Link as RouterLink, NavLink } from 'react-router-dom';
import type { ApplicationUser } from '@atoms-builder/contracts';

export function AppHeader({
  user,
  signingOut,
  onLogout,
}: {
  user: ApplicationUser | null;
  signingOut: boolean;
  onLogout: () => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <AppBar position="static" color="transparent" elevation={0} className="app-header">
      <Container maxWidth={false} sx={{ px: { xs: 2, md: 4 } }}>
        <Toolbar disableGutters sx={{ gap: { xs: 1, sm: 2, md: 5 }, minHeight: '72px !important' }}>
          <Box component={RouterLink} to="/" className="brand" aria-label="Atoms 首页">
            <svg width="30" height="30" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <path
                d="M16 3 29 25H3L16 3Z"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinejoin="round"
              />
              <path
                d="m9 15 7 12 7-12M3 25l20-10M29 25 9 15"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
            <span>
              atoms<span className="brand-dot">.</span>
            </span>
          </Box>
          {user && (
            <Stack
              component="nav"
              aria-label="主导航"
              direction="row"
              gap={{ xs: 1, sm: 2 }}
              className="main-nav"
            >
              <Button component={NavLink} to="/" end>
                新建
              </Button>
              <Button component={NavLink} to="/tasks">
                历史任务
              </Button>
            </Stack>
          )}
          <Box sx={{ flex: 1 }} />
          {user ? (
            <>
              <Button
                aria-label={`账号 ${user.username}`}
                aria-controls={anchor ? 'account-menu' : undefined}
                aria-haspopup="true"
                aria-expanded={Boolean(anchor)}
                onClick={(event) => setAnchor(event.currentTarget)}
                sx={{ minWidth: 0, px: 0.5, color: 'text.secondary' }}
              >
                <Avatar
                  sx={{
                    width: 30,
                    height: 30,
                    bgcolor: 'primary.light',
                    color: 'primary.main',
                    fontSize: 12,
                  }}
                >
                  {user.username.slice(0, 1).toUpperCase()}
                </Avatar>
                <Typography
                  variant="body2"
                  noWrap
                  sx={{ mx: 1, maxWidth: 150, display: { xs: 'none', sm: 'block' } }}
                >
                  {user.username}
                </Typography>
                <KeyboardArrowDownRounded
                  sx={{ fontSize: 17, display: { xs: 'none', sm: 'block' } }}
                />
              </Button>
              <Menu
                id="account-menu"
                anchorEl={anchor}
                open={Boolean(anchor)}
                onClose={() => setAnchor(null)}
              >
                <MenuItem
                  id="logout"
                  disabled={signingOut}
                  onClick={() => {
                    setAnchor(null);
                    onLogout();
                  }}
                >
                  <LogoutRounded fontSize="small" sx={{ mr: 1.5 }} />
                  退出登录
                </MenuItem>
              </Menu>
            </>
          ) : (
            <Typography variant="body2" color="text.secondary">
              创作，从想法开始
            </Typography>
          )}
        </Toolbar>
      </Container>
    </AppBar>
  );
}
