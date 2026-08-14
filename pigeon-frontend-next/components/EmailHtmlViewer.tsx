"use client";

import React, { useEffect, useRef, useState } from "react";

interface EmailHtmlViewerProps {
  html: string;
}

export function EmailHtmlViewer({ html }: EmailHtmlViewerProps) {
  // If the content is likely plain text (no HTML tags), render a nicer text block instead of an iframe
  const isLikelyPlainText = !/[<][a-z!/][^>]*>/i.test(html);

  if (isLikelyPlainText) {
    return (
      <div className="min-w-0 w-full overflow-hidden rounded-md border bg-muted/40 px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words">
        {html}
      </div>
    );
  }

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleLoad = () => {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!doc) return;

        // Force long URLs to break and prevent overflow (override any email inline styles)
        const styleTag = doc.createElement("style");
        styleTag.textContent = `
          html, body { margin: 0; padding: 0.5rem 0; overflow: hidden !important; overflow-x: hidden !important; max-width: 100% !important; width: 100% !important; min-width: 0 !important; }
          html { scrollbar-width: none; }
          html::-webkit-scrollbar, body::-webkit-scrollbar { width: 0 !important; height: 0 !important; }
          * { box-sizing: border-box; max-width: 100% !important; }
          table { table-layout: fixed !important; width: 100% !important; max-width: 100% !important; }
          td, th { word-break: break-all !important; overflow-wrap: anywhere !important; }
          body, body *, body a, body p, body span, body div, body li, body td, body th {
            overflow-wrap: break-word !important;
            word-break: break-word !important;
            white-space: normal !important;
          }
          body a { word-break: break-all !important; overflow-wrap: anywhere !important; }
          /* Preserve formatting for plain-text bodies wrapped by backend */
          body [data-er-plain="1"], body [data-er-plain="1"] * { white-space: pre-wrap !important; }
        `;
        doc.head.appendChild(styleTag);

        // Wrap body content in a constraining div so width is bounded regardless of email structure
        const body = doc.body;
        const wrapper = doc.createElement("div");
        wrapper.setAttribute("style", "width:100%;max-width:100%;min-width:0;overflow-x:hidden;overflow-wrap:break-word;word-break:break-word;display:block;");
        while (body.firstChild) wrapper.appendChild(body.firstChild);
        body.appendChild(wrapper);

        const newHeight = doc.body.scrollHeight;
        setHeight(newHeight);
      } catch {
        // Ignore measurement errors
      }
    };

    iframe.addEventListener("load", handleLoad);
    return () => {
      iframe.removeEventListener("load", handleLoad);
    };
  }, [html]);

  return (
    <div className="email-html-viewer-isolated min-w-0 w-full overflow-hidden rounded-md border bg-background" data-isolated="true">
      <iframe
        ref={iframeRef}
        title="Email content"
        srcDoc={html}
        sandbox="allow-same-origin"
        scrolling="no"
        style={{
          border: "none",
          width: "100%",
          maxWidth: "100%",
          height: height ? `${height}px` : "150px",
          overflow: "hidden",
          display: "block",
        }}
      />
    </div>
  );
}

