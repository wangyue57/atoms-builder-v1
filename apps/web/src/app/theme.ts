import { createTheme, alpha } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    primary: { main: '#4168ed', dark: '#2c4fc6', light: '#eef3ff' },
    secondary: { main: '#52647b' },
    background: { default: '#ffffff', paper: '#ffffff' },
    text: { primary: '#202838', secondary: '#687488' },
    divider: '#e8ecf2',
    success: { main: '#258166' },
    error: { main: '#c74343' },
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily:
      'Inter, -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
    h1: { fontSize: '3.25rem', fontWeight: 600, lineHeight: 1.35, letterSpacing: '-0.035em' },
    h2: { fontSize: '1.75rem', fontWeight: 600, letterSpacing: '-0.025em' },
    h3: { fontSize: '1.1rem', fontWeight: 600 },
    h4: { fontSize: '0.95rem', fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 500 },
    body2: { fontSize: '0.875rem', lineHeight: 1.75 },
    caption: { fontSize: '0.75rem', lineHeight: 1.65 },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 10, minHeight: 38 },
        outlined: { borderColor: '#dce3ee' },
      },
    },
    MuiPaper: { defaultProps: { elevation: 0 } },
    MuiCard: {
      defaultProps: { variant: 'outlined' },
      styleOverrides: { root: { borderRadius: 16 } },
    },
    MuiTextField: { defaultProps: { variant: 'outlined' } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: '#fff',
          '&.Mui-focused': { boxShadow: `0 0 0 3px ${alpha('#4168ed', 0.07)}` },
        },
      },
    },
    MuiChip: { styleOverrides: { root: { borderRadius: 7, fontWeight: 500 } } },
    MuiAlert: {
      styleOverrides: { root: { borderRadius: 10, fontSize: '0.82rem', overflowWrap: 'anywhere' } },
    },
    MuiTab: { styleOverrides: { root: { textTransform: 'none', minHeight: 46 } } },
    MuiTooltip: { defaultProps: { arrow: true } },
  },
});
