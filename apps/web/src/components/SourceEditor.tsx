import { useLayoutEffect, useRef } from 'react';
import { Box, Button, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import CodeRounded from '@mui/icons-material/CodeRounded';
import RestoreRounded from '@mui/icons-material/RestoreRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import UndoRounded from '@mui/icons-material/UndoRounded';
import RedoRounded from '@mui/icons-material/RedoRounded';
import { basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { html } from '@codemirror/lang-html';
import { indentUnit } from '@codemirror/language';
import { indentWithTab, undo, redo } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';

function sourceState(doc: string, onChange: (value: string) => void) {
  return EditorState.create({
    doc,
    extensions: [
      basicSetup,
      html(),
      indentUnit.of('  '),
      keymap.of([indentWithTab]),
      EditorView.contentAttributes.of({
        id: 'artifact-source',
        'aria-label': '产物 HTML 源代码',
        'aria-describedby': 'source-editing-hint source-keyboard-hint',
        spellcheck: 'false',
      }),
      EditorState.phrases.of({
        Find: '查找',
        Replace: '替换',
        next: '下一个',
        previous: '上一个',
        all: '全部',
        'match case': '区分大小写',
        regexp: '正则表达式',
        'by word': '全词匹配',
        replace: '替换',
        'replace all': '全部替换',
        close: '关闭',
        'Fold line': '折叠代码',
        'Unfold line': '展开代码',
        'Go to line': '跳转到行',
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChange(update.state.doc.toString());
      }),
    ],
  });
}

interface SourceEditorProps {
  value: string;
  onChange: (value: string) => void;
  modified: boolean;
  onRestore: () => void;
  active: boolean;
}

export function SourceEditor({ value, onChange, modified, onRestore, active }: SourceEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const initialValue = useRef(value);
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useLayoutEffect(() => {
    if (!hostRef.current) return;
    const editor = new EditorView({
      state: sourceState(initialValue.current, (next) => onChangeRef.current(next)),
      parent: hostRef.current,
    });
    editorRef.current = editor;
    return () => {
      editor.destroy();
      editorRef.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.state.doc.toString() !== value) {
      // External restore/version changes start a new history; user edits keep their history.
      editor.setState(sourceState(value, (next) => onChangeRef.current(next)));
    }
  }, [value]);
  useLayoutEffect(() => {
    if (active) editorRef.current?.requestMeasure();
  }, [active]);
  const lineCount = value.split('\n').length;
  return (
    <Box className="source-editor">
      <Box component="aside" className="source-files" aria-label="产物文件">
        <Typography variant="caption" color="text.secondary">
          产物文件
        </Typography>
        <Typography className="source-folder" variant="body2">
          ⌄ public
        </Typography>
        <Box className="source-file" aria-current="true">
          <CodeRounded sx={{ fontSize: 16 }} /> preview.html
        </Box>
      </Box>
      <Box className="source-main">
        <Stack className="source-toolbar" direction="row" alignItems="center" gap={1}>
          <CodeRounded color="primary" sx={{ fontSize: 17 }} />
          <Typography variant="caption" sx={{ flex: 1 }}>
            public/preview.html
          </Typography>
          <Stack direction="row" className="source-editor-actions">
            <Tooltip title="撤销（Ctrl/⌘ Z）">
              <IconButton
                size="small"
                aria-label="撤销代码修改"
                onClick={() => {
                  if (editorRef.current) {
                    undo(editorRef.current);
                    editorRef.current.focus();
                  }
                }}
              >
                <UndoRounded fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="重做（Ctrl/⌘ Shift Z）">
              <IconButton
                size="small"
                aria-label="重做代码修改"
                onClick={() => {
                  if (editorRef.current) {
                    redo(editorRef.current);
                    editorRef.current.focus();
                  }
                }}
              >
                <RedoRounded fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="查找和替换（Ctrl/⌘ F）">
              <IconButton
                size="small"
                aria-label="查找和替换代码"
                onClick={() => {
                  if (editorRef.current) openSearchPanel(editorRef.current);
                }}
              >
                <SearchRounded fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
          <Button
            size="small"
            startIcon={<RestoreRounded sx={{ fontSize: 16 }} />}
            disabled={!modified}
            onClick={onRestore}
          >
            恢复原始代码
          </Button>
        </Stack>
        <Box ref={hostRef} className="source-codemirror" />
        <Typography id="source-keyboard-hint" className="source-keyboard-hint" variant="caption">
          Tab 缩进 · Esc 后按 Tab 移出编辑器
        </Typography>
        <Stack className="source-statusbar" direction="row" justifyContent="space-between" gap={1}>
          <span>HTML · CSS · JavaScript</span>
          <span>{lineCount} 行 · UTF-8</span>
        </Stack>
      </Box>
    </Box>
  );
}
