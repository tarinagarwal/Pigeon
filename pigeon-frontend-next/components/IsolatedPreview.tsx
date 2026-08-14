"use client";

import React from "react";

const PREVIEW_DOC_STYLE = `
  body { margin: 0; padding: 12px; font-family: system-ui, -apple-system, sans-serif; font-size: 14px; line-height: 1.6; color: #1a1a1a; background: #fff; }
  a { color: #9a3412; }
  ul, ol { margin: 0.5em 0; padding-left: 1.5em; }
  pre { white-space: pre-wrap; margin: 0; font-family: inherit; }
`;

type IsolatedPreviewProps = {
  /** HTML content to render (used when mode is "html") */
  html?: string;
  /** Plain text content (used when mode is "plain") */
  plainText?: string;
  /** "html" = render as HTML; "plain" = render as pre-wrapped text; "rich" = render as HTML (Tiptap output) */
  mode: "html" | "plain" | "rich";
  /** Optional title for the iframe */
  title?: string;
  /** Class name for the wrapper div (e.g. min-h, max-h) */
  className?: string;
};

/**
 * Renders content in an iframe so that:
 * - Parent page CSS does not affect the preview.
 * - Preview CSS/HTML does not affect the parent page.
 */
export function IsolatedPreview({
  html = "",
  plainText = "",
  mode,
  title = "Preview",
  className = "min-h-[300px] max-h-[400px] w-full rounded-lg border bg-white overflow-hidden",
}: IsolatedPreviewProps) {
  const bodyContent =
    mode === "plain"
      ? `<pre>${escapeHtml(plainText)}</pre>`
      : html.trim(); // both "html" and "rich" render as HTML

  const srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${PREVIEW_DOC_STYLE}</style></head><body>${bodyContent}</body></html>`;

  return (
    <div className={className}>
      <iframe
        title={title}
        srcDoc={srcdoc}
        sandbox="allow-same-origin"
        className="w-full h-full min-h-[280px] border-0 block"
        style={{ display: "block" }}
      />
    </div>
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
