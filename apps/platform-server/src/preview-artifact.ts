import { parse } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";
import type { ReviewReport } from "@atoms-builder/contracts";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];

/** Static delivery checks only. Parsing HTML never executes generated scripts. */
export function previewArtifactIssues(html: string): string[] {
  if (!html.trim())
    return ["必须生成非空的 public/preview.html，而不能只交付 app/page.tsx。"];
  if (html.length > 200_000) return ["预览 HTML 过大，请保持独立页面精简。"];
  const issues: string[] = [];
  if (!/<html(?:\s|>)/i.test(html) || !/<body(?:\s|>)/i.test(html)) {
    issues.push(
      "预览必须是包含 html/body 的完整 HTML 文档，不是 JSX、源码或 Markdown 代码块。",
    );
  }
  const document = parse(html);
  let visibleContent = false;
  let unsupportedResource = false;
  let unsupportedScript = false;
  const value = (element: Element, name: string) =>
    element.attrs.find((attr) => attr.name === name)?.value ?? "";
  function visit(node: Node, inBody = false, hidden = false) {
    if ("tagName" in node) {
      const tag = node.tagName;
      inBody ||= tag === "body";
      const style = value(node, "style");
      hidden ||=
        node.attrs.some((attr) => attr.name === "hidden") ||
        /(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:;|$))/i.test(
          style,
        );
      if (
        ["script", "img", "iframe", "video", "audio", "source"].includes(tag)
      ) {
        const src = value(node, "src");
        if (src && !(tag === "img" && src.startsWith("data:")))
          unsupportedResource = true;
      }
      if (
        tag === "link" &&
        /stylesheet|preload|modulepreload/i.test(value(node, "rel"))
      )
        unsupportedResource = true;
      if (tag === "style") {
        const css = node.childNodes
          .filter((child) => "value" in child)
          .map((child) => ("value" in child ? child.value : ""))
          .join("");
        if (/@import\b/i.test(css)) unsupportedResource = true;
        for (const match of css.matchAll(
          /url\(\s*['"]?([^)'"\s]+)[\s'"]*\)/gi,
        )) {
          if (!match[1]?.startsWith("data:") && !match[1]?.startsWith("#"))
            unsupportedResource = true;
        }
      }
      if (tag === "script") {
        const type = value(node, "type");
        const script = node.childNodes
          .filter((child) => "value" in child)
          .map((child) => ("value" in child ? child.value : ""))
          .join("");
        if (
          /babel|jsx/i.test(type) ||
          (type === "module" && /\bimport\s*(?:\(|[\w*{'"])/.test(script))
        )
          unsupportedScript = true;
      }
      if (["script", "style", "template", "noscript"].includes(tag)) return;
      if (inBody && !hidden && ["svg", "canvas", "img"].includes(tag))
        visibleContent = true;
    }
    if (inBody && !hidden && "value" in node && node.value.trim())
      visibleContent = true;
    if ("childNodes" in node)
      for (const child of node.childNodes) visit(child, inBody, hidden);
  }
  visit(document);
  if (!visibleContent)
    issues.push(
      "预览正文没有可见内容，空挂载节点不能作为已交付页面；请提供可见的基础界面。",
    );
  if (unsupportedResource)
    issues.push(
      "隔离预览禁止外部脚本、样式和媒体资源；请内联 CSS/JavaScript，图片使用 data URI 或 CSS 图形。",
    );
  if (unsupportedScript)
    issues.push(
      "独立预览不能执行 JSX/Babel 或模块导入；请使用浏览器可直接执行的内联 JavaScript。",
    );
  return issues;
}

export function previewFailureReview(issues: string[]): ReviewReport {
  return {
    status: "fail",
    score: 0,
    checks: [
      {
        name: "preview-artifact",
        status: "fail",
        summary: "静态 HTML 交付检查失败；未执行生成代码。",
        evidence: [],
      },
    ],
    failures: [],
    evidence: [],
    mustFix: issues,
    shouldFix: [],
    risks: ["静态产物校验不等于实际浏览器或完整项目构建验收。"],
  };
}

export class PreviewArtifactError extends Error {
  constructor(readonly issues: string[]) {
    super(`预览未通过交付检查：${issues.join(" ")}`);
    this.name = "PreviewArtifactError";
  }
}
