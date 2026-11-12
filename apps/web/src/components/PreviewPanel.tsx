import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Box,
  Button,
  Card,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material';
import OpenInFullRounded from '@mui/icons-material/OpenInFullRounded';
import RefreshRounded from '@mui/icons-material/RefreshRounded';
import CloseFullscreenRounded from '@mui/icons-material/CloseFullscreenRounded';
import WebOutlined from '@mui/icons-material/WebOutlined';
import LockOutlined from '@mui/icons-material/LockOutlined';
import CodeRounded from '@mui/icons-material/CodeRounded';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import type { ApplicationTask } from '@atoms-builder/contracts';
import { buildPreviewDocument } from '../features/preview/preview-document';
import './preview-panel.css';

const SourceEditor = lazy(() =>
  import('./SourceEditor').then((module) => ({ default: module.SourceEditor })),
);

export interface PreviewPanelProps {
  html: string;
  versionLabel: string;
  versionId: string | null;
  phase: ApplicationTask['phase'];
}
type AtomicMoveHost = HTMLElement & { moveBefore?: (node: Node, before: Node | null) => void };
function moveContainer(host: HTMLElement, container: HTMLElement) {
  if (container.parentElement === host) return;
  const target = host as AtomicMoveHost;
  if (container.isConnected && target.moveBefore) target.moveBefore(container, null);
  else target.append(container);
}

/** One stable portal owns the isolated iframe; fullscreen moves only its connected host. */
export function PreviewPanel({ html, versionLabel, versionId, phase }: PreviewPanelProps) {
  const [view, setView] = useState<'preview' | 'source'>('preview');
  const [sourceOpened, setSourceOpened] = useState(false);
  const [draft, setDraft] = useState<{
    html: string;
    baseHtml: string;
    versionId: string | null;
  } | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const modified = draft !== null && draft.html !== draft.baseHtml;
  const sourceHtml = modified ? draft.html : html;
  const sourceVersionId = modified ? draft.versionId : versionId;
  const incomingVersion = modified && (versionId !== draft.versionId || html !== draft.baseHtml);
  const [debouncedSource, setDebouncedSource] = useState({
    html: sourceHtml,
    versionId: sourceVersionId,
  });
  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedSource({ html: sourceHtml, versionId: sourceVersionId }),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [sourceHtml, sourceVersionId]);
  // Saved versions switch atomically; only typing a draft is debounced.
  const liveHtml =
    modified && debouncedSource.versionId === sourceVersionId ? debouncedSource.html : sourceHtml;
  useEffect(() => {
    if (!modified) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [modified]);
  const [expanded, setExpanded] = useState(false);
  const [frameRevision, setFrameRevision] = useState(0);
  const [hostAttached, setHostAttached] = useState(false);
  const [container] = useState(() => {
    const element = document.createElement('div');
    element.className = 'preview-frame-host';
    return element;
  });
  const stageRef = useRef<HTMLDivElement>(null);
  const fullscreenRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const srcDoc = useMemo(
    () => (liveHtml.trim() ? buildPreviewDocument(liveHtml) : undefined),
    [liveHtml],
  );
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const host = expanded ? fullscreenRef.current : stageRef.current;
    const opener = expandRef.current;
    if (!dialog || !host) return;
    if (expanded) dialog.showModal();
    moveContainer(host, container);
    // Mount the browsing context after its stable host joins the document.
    setHostAttached(true);
    if (expanded) {
      document.body.classList.add('preview-open');
      closeRef.current?.focus();
    }
    return () => {
      if (expanded) {
        if (dialog.open) dialog.close();
        document.body.classList.remove('preview-open');
        opener?.focus();
      }
    };
  }, [expanded, container]);
  useLayoutEffect(() => () => container.remove(), [container]);
  const busy = phase === 'queued' || phase === 'running';
  const title =
    modified && !sourceHtml.trim()
      ? 'HTML 草稿为空'
      : busy
        ? '作品正在成形'
        : phase === 'failed'
          ? '这次构建未能完成'
          : '暂时没有可展示的预览';
  return (
    <Card className="preview-card" sx={{ overflow: 'hidden' }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        gap={1}
        className="artifact-toolbar"
      >
        <Tabs
          value={view}
          onChange={(_, next: 'preview' | 'source') => {
            setView(next);
            if (next === 'source') setSourceOpened(true);
          }}
          aria-label="产物视图"
          className="artifact-tabs"
        >
          <Tab
            id="artifact-preview-tab"
            aria-controls="artifact-preview-panel"
            value="preview"
            icon={<VisibilityOutlined />}
            iconPosition="start"
            label="预览"
          />
          <Tab
            id="artifact-source-tab"
            aria-controls="artifact-source-panel"
            value="source"
            icon={<CodeRounded />}
            iconPosition="start"
            label="代码"
            disabled={!html && !modified}
          />
        </Tabs>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography
            id="preview-label"
            variant="caption"
            color="text.secondary"
            sx={{
              display: { xs: 'none', sm: 'block' },
              maxWidth: 230,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {modified ? '本页编辑草稿' : versionLabel}
          </Typography>
          <Tooltip title="重新加载预览（不重新生成作品）">
            <span>
              <IconButton
                id="reload-preview"
                size="small"
                disabled={!srcDoc}
                aria-label="重新加载预览"
                onClick={() => setFrameRevision((value) => value + 1)}
              >
                <RefreshRounded sx={{ fontSize: 18 }} />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="全屏展开预览">
            <span>
              <IconButton
                id="expand-preview"
                ref={expandRef}
                size="small"
                onClick={() => setExpanded(true)}
                disabled={!srcDoc}
                aria-label="全屏展开预览"
                sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5 }}
              >
                <OpenInFullRounded sx={{ fontSize: 16 }} />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Stack>
      {incomingVersion && (
        <Stack
          role="status"
          className="incoming-version"
          direction="row"
          alignItems="center"
          gap={1}
        >
          <Typography variant="caption" sx={{ flex: 1 }}>
            新版本已就绪，当前保留你的编辑草稿。
          </Typography>
          <Button size="small" onClick={() => setRestoreOpen(true)}>
            载入新版本
          </Button>
        </Stack>
      )}
      {srcDoc && !modified && (busy || phase === 'failed') && (
        <Box
          role="status"
          sx={{ px: 2, py: 1, bgcolor: 'primary.light', color: 'primary.dark', fontSize: 12 }}
        >
          {busy
            ? '正在生成新版本 · 当前展示上次完成的作品'
            : '本次修改未完成 · 当前展示上次完成的作品'}
        </Box>
      )}
      <Box
        id="artifact-preview-panel"
        role="tabpanel"
        aria-labelledby="artifact-preview-tab"
        hidden={view !== 'preview'}
        className="artifact-panel"
      >
        <Box
          id="preview-stage"
          ref={stageRef}
          sx={{
            height: '100%',
            position: 'relative',
            bgcolor: '#fff',
          }}
        >
          <Stack
            hidden={Boolean(srcDoc)}
            id="preview-empty"
            alignItems="center"
            justifyContent="center"
            spacing={1.5}
            sx={{
              height: '100%',
              px: 3,
              textAlign: 'center',
              background: 'radial-gradient(ellipse at center,#f4f7ff 0,white 75%)',
            }}
          >
            <Box className="preview-skeleton" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </Box>
            <Box
              sx={{ p: 2, borderRadius: 4, bgcolor: 'primary.light', color: 'primary.main', mb: 1 }}
            >
              {busy ? (
                <CircularProgress size={24} color="inherit" aria-label="正在构建" />
              ) : (
                <WebOutlined />
              )}
            </Box>
            <Typography component="h2" variant="h3" aria-live="polite">
              {title}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 320 }}>
              {modified && !sourceHtml.trim()
                ? '输入 HTML 后会自动更新预览，也可以在代码页签恢复已保存的代码。'
                : busy
                  ? phase === 'queued'
                    ? '需求已保存。开始构建后，你可以在「需求与进展」中查看状态。'
                    : '正在生成页面并进行源码审查。完成后，你的作品会自动出现在这里。'
                  : '可查看运行记录，补充需求后继续构建。'}
            </Typography>
            {busy && (
              <Typography variant="caption" color="text.primary" sx={{ mt: 0.5 }}>
                无需停留等待，任务会在后台继续
              </Typography>
            )}
          </Stack>
        </Box>
      </Box>
      <Box
        id="artifact-source-panel"
        role="tabpanel"
        aria-labelledby="artifact-source-tab"
        hidden={view !== 'source'}
        className="artifact-panel"
      >
        {sourceOpened && (
          <Suspense
            fallback={
              <Stack
                role="status"
                alignItems="center"
                justifyContent="center"
                sx={{ height: '100%' }}
              >
                <CircularProgress size={24} />
                <Typography variant="caption" sx={{ mt: 2 }}>
                  正在加载代码编辑器…
                </Typography>
              </Stack>
            }
          >
            <SourceEditor
              key={sourceVersionId ?? 'preview'}
              active={view === 'source'}
              value={sourceHtml}
              modified={modified}
              onRestore={() => setRestoreOpen(true)}
              onChange={(next) =>
                setDraft({
                  html: next,
                  baseHtml: modified ? draft.baseHtml : html,
                  versionId: sourceVersionId,
                })
              }
            />
          </Suspense>
        )}
      </Box>
      <Stack direction="row" alignItems="center" spacing={0.75} className="artifact-footer">
        <LockOutlined sx={{ fontSize: 12, color: 'text.secondary' }} />
        <Typography
          id="source-editing-hint"
          variant="caption"
          color="text.secondary"
          sx={{ fontSize: 11 }}
        >
          {view === 'source' || modified
            ? '编辑自动预览 · 草稿仅本页有效，刷新后恢复已保存版本'
            : 'HTML 预览 · 切换代码可直接编辑'}
        </Typography>
      </Stack>
      <Dialog
        open={restoreOpen}
        onClose={() => setRestoreOpen(false)}
        aria-labelledby="restore-source-title"
      >
        <DialogTitle id="restore-source-title">
          {incomingVersion ? '载入最新版本？' : '恢复已保存的代码？'}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>当前编辑草稿将被替换，预览也会随之更新。</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRestoreOpen(false)}>保留草稿</Button>
          <Button
            variant="contained"
            onClick={() => {
              setDraft(null);
              setRestoreOpen(false);
            }}
          >
            确认恢复
          </Button>
        </DialogActions>
      </Dialog>
      <dialog
        id="preview-dialog"
        ref={dialogRef}
        className="preview-dialog"
        aria-labelledby="fullscreen-title"
        onClose={() => setExpanded(false)}
      >
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          sx={{ height: 60, px: 3, borderBottom: '1px solid', borderColor: 'divider' }}
        >
          <Typography id="fullscreen-title" component="h2" variant="h4">
            作品预览
          </Typography>
          <Button
            id="close-preview"
            ref={closeRef}
            variant="outlined"
            onClick={() => setExpanded(false)}
            startIcon={<CloseFullscreenRounded fontSize="small" />}
          >
            退出全屏 Esc
          </Button>
        </Stack>
        <div id="fullscreen-content" className="fullscreen-content" ref={fullscreenRef} />
      </dialog>
      {hostAttached &&
        srcDoc &&
        createPortal(
          <iframe
            key={`${sourceVersionId ?? 'preview'}:${frameRevision}`}
            id="preview"
            title="项目预览"
            sandbox="allow-scripts"
            srcDoc={srcDoc}
            hidden={!srcDoc}
          />,
          container,
        )}
    </Card>
  );
}
