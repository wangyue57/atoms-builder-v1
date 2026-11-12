const PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

/** Generated HTML must only reach the isolated iframe, never the application DOM. */
export function buildPreviewDocument(html: string): string {
  const policy = PREVIEW_CSP.replaceAll("'", '&apos;');
  return `<meta http-equiv="Content-Security-Policy" content="${policy}">${html}`;
}
