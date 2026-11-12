import { Box, Stack, Typography } from '@mui/material';
import type { ApplicationRunResult } from '@atoms-builder/contracts';

export function ReviewPanel({ result }: { result: ApplicationRunResult | null }) {
  const review = result?.review;
  const labels: Record<string, string> = {
    pass: '通过',
    fail: '待修复',
    needs_fix: '待修复',
    blocked: '受阻',
  };
  return (
    <Box>
      <Stack component="dl" spacing={1.25} sx={{ m: 0 }}>
        {[
          [
            '审查结果',
            'report-status',
            review ? (labels[review.status] ?? review.status) : '待审查',
          ],
          ['质量评分', 'report-score', review ? `${review.score} / 100` : '—'],
          ['必须修复', 'report-must-fix', review?.mustFix.join('、') || '无'],
          ['风险提示', 'report-risks', review?.risks.join('、') || '无'],
        ].map(([label, id, value]) => (
          <Stack key={id} direction="row" justifyContent="space-between" gap={2}>
            <Typography
              component="dt"
              variant="caption"
              color="text.secondary"
              sx={{ flexShrink: 0 }}
            >
              {label}
            </Typography>
            <Typography
              component="dd"
              id={id}
              variant="caption"
              sx={{ m: 0, textAlign: 'right', overflowWrap: 'anywhere' }}
            >
              {value}
            </Typography>
          </Stack>
        ))}
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
        此结果为 AI 源码审查，尚未经过真实构建与浏览器测试。
      </Typography>
    </Box>
  );
}
