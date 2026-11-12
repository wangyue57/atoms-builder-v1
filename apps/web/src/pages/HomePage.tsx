import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Box, Button, Container, Stack, Typography } from '@mui/material';
import ArrowOutwardRounded from '@mui/icons-material/ArrowOutwardRounded';
import WebOutlined from '@mui/icons-material/WebOutlined';
import DashboardOutlined from '@mui/icons-material/DashboardOutlined';
import PersonOutlineRounded from '@mui/icons-material/PersonOutlineRounded';
import { useNavigate } from 'react-router-dom';
import { useTaskSubmission } from '../features/tasks/queries';
import { RequestComposer } from '../components/RequestComposer';

const examples = [
  {
    label: '产品官网',
    description: '让产品拥有自己的舞台',
    request: '做一个极简风格的 SaaS 产品官网，包含产品介绍、功能亮点、定价和醒目的注册按钮。',
    icon: WebOutlined,
  },
  {
    label: '数据看板',
    description: '把业务数据变得一目了然',
    request: '做一个清晰专业的数据看板，展示收入、用户增长和近期业务活动，使用柔和的绿色。',
    icon: DashboardOutlined,
  },
  {
    label: '个人作品集',
    description: '以你的风格，展示你的作品',
    request: '做一个设计师个人作品集，使用温暖自然的配色，包含自我介绍、精选作品和联系入口。',
    icon: PersonOutlineRounded,
  },
];

export function HomePage() {
  const [request, setRequest] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const submission = useTaskSubmission();
  const navigate = useNavigate();
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const task = await submission.submit(request);
      if (task) void navigate(`/tasks/${task.id}`);
    } catch {
      /* Preserve the draft for retry. */
    }
  }
  return (
    <Box component="main" id="home-view" className="home-page">
      <Container maxWidth="md" className="home-content">
        <Stack alignItems="center" textAlign="center" sx={{ mb: { xs: 4, md: 5 } }}>
          <Typography className="eyebrow" sx={{ mb: 2.5 }}>
            用自然语言，构建下一件作品
          </Typography>
          <Typography component="h1" variant="h1" sx={{ fontSize: { xs: 34, sm: 48, md: 56 } }}>
            <Box component="span" sx={{ whiteSpace: 'nowrap' }}>
              让想法，
            </Box>
            <Box component="span" color="primary.main" sx={{ whiteSpace: 'nowrap' }}>
              成为作品。
            </Box>
          </Typography>
          <Typography
            color="text.secondary"
            sx={{ mt: 2.5, fontSize: { xs: 14, md: 16 }, lineHeight: 1.9 }}
          >
            描述你的想法，让 AI 构建页面。
            <br className="mobile-break" />
            在预览中探索，在对话中完善。
          </Typography>
        </Stack>
        <RequestComposer
          id="request"
          value={request}
          onChange={setRequest}
          onSubmit={submit}
          inputRef={inputRef}
          pending={submission.isPending}
          error={submission.error}
        />
        <Box component="section" aria-label="灵感起点" sx={{ mt: 4 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
            从一个方向开始
          </Typography>
          <Box className="idea-grid">
            {examples.map((example) => (
              <Button
                key={example.label}
                className="idea-button"
                disabled={submission.isPending}
                onClick={() => {
                  setRequest(example.request);
                  inputRef.current?.focus();
                }}
              >
                <example.icon sx={{ fontSize: 21, color: 'primary.main' }} />
                <Box sx={{ flex: 1, textAlign: 'left' }}>
                  <Typography variant="body2" color="text.primary" fontWeight={500}>
                    {example.label}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {example.description}
                  </Typography>
                </Box>
                <ArrowOutwardRounded sx={{ fontSize: 15, color: 'text.secondary' }} />
              </Button>
            ))}
          </Box>
        </Box>
      </Container>
      <Typography
        component="footer"
        variant="caption"
        color="text.secondary"
        sx={{ textAlign: 'center', p: 3 }}
      >
        你的创作，自动保存。随时回来，继续下一步。
      </Typography>
    </Box>
  );
}
