"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { Loader2 } from "lucide-react";

const DEFAULT_EMAIL_HTML = `
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
  <tr>
    <td style="padding: 24px;">
      <h1 style="margin: 0 0 16px; font-size: 24px;">Your heading</h1>
      <p style="margin: 0 0 16px; line-height: 1.5; color: #333;">Hello {{first_name}},</p>
      <p style="margin: 0 0 16px; line-height: 1.5; color: #333;">Add your email content here. Use variables like {{company}} and {{industry}} for personalization.</p>
      <p style="margin: 16px 0 0; line-height: 1.5; color: #666;">Best regards,<br/>Your team</p>
    </td>
  </tr>
</table>
`.trim();

export interface TemplateBuilderEditorRef {
  getHtml: () => string;
  getCss: () => string;
  setContent: (html: string) => void;
  clear: () => void;
}

interface TemplateBuilderEditorProps {
  initialHtml?: string | null;
  onReady?: (ref: TemplateBuilderEditorRef) => void;
  className?: string;
}

export function TemplateBuilderEditor({
  initialHtml,
  onReady,
  className = "",
}: TemplateBuilderEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorInstanceRef = useRef<{ getHtml: () => string; getCss: () => string; setComponents: (html: string) => void; destroy: () => void } | null>(null);
  const initialHtmlRef = useRef(initialHtml);
  const [isUploading, setIsUploading] = useState(false);
  const setUploadingRef = useRef(setIsUploading);
  const mountedRef = useRef(true);
  setUploadingRef.current = setIsUploading;

  const getRef = useCallback((): TemplateBuilderEditorRef => ({
    getHtml: () => editorInstanceRef.current?.getHtml() ?? "",
    getCss: () => editorInstanceRef.current?.getCss() ?? "",
    setContent: (html: string) => editorInstanceRef.current?.setComponents(html || DEFAULT_EMAIL_HTML),
    clear: () => editorInstanceRef.current?.setComponents(DEFAULT_EMAIL_HTML),
  }), []);

  useEffect(() => {
    mountedRef.current = true;
    if (typeof window === "undefined" || !containerRef.current) return;

    let mounted = true;

    async function init() {
      const grapesjs = await import("grapesjs");
      const newsletterPreset = await import("grapesjs-preset-newsletter");

      const gjs = grapesjs.default.init({
        container: containerRef.current!,
        height: "calc(100vh - 300px)",
        storageManager: false,
        assetManager: {
          upload: "/api/upload-template-image",
          uploadName: "files",
          multiUpload: false,
          credentials: "include",
          headers: {},
        },
        plugins: [newsletterPreset.default],
        pluginsOpts: {
          [newsletterPreset.default as unknown as string]: {
            inlineCss: false,
          },
        },
        canvas: {
          styles: [
            "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
          ],
          scripts: [],
        },
        deviceManager: {
          devices: [
            { name: "Desktop", width: "" },
            { name: "Tablet", width: "768px" },
            { name: "Mobile", width: "320px" },
          ],
        },
      });

      if (!mounted) {
        gjs.destroy();
        return;
      }

      editorInstanceRef.current = {
        getHtml: () => gjs.getHtml() ?? "",
        getCss: () => gjs.getCss() ?? "",
        setComponents: (html: string) => {
          gjs.setComponents(html || DEFAULT_EMAIL_HTML);
        },
        destroy: () => gjs.destroy(),
      };

      const html = initialHtmlRef.current;
      if (html && typeof html === "string" && html.trim()) {
        gjs.setComponents(html);
      } else {
        gjs.setComponents(DEFAULT_EMAIL_HTML);
      }

      const setUploading = (v: boolean) => {
        if (mountedRef.current) setUploadingRef.current?.(v);
      };
      gjs.on("asset:upload:start", () => setUploading(true));
      gjs.on("asset:upload:end", () => setUploading(false));
      gjs.on("asset:upload:error", () => setUploading(false));

      onReady?.(getRef());
    }

    init();
    return () => {
      mounted = false;
      mountedRef.current = false;
      editorInstanceRef.current?.destroy();
      editorInstanceRef.current = null;
    };
  }, [onReady, getRef]);

  return (
    <div className={`relative ${className}`}>
      {isUploading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-black/60 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-lg bg-[#1a1d27] px-6 py-4 shadow-xl border border-white/10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="text-sm font-medium text-white">Uploading image…</span>
          </div>
        </div>
      )}
      <div ref={containerRef} className="min-h-[500px] rounded-xl border overflow-hidden bg-[#1a1d27]" id="gjs-template-builder" />
      <style jsx global>{`
        #gjs-template-builder .gjs-one-bg { background-color: #2d3139; }
        #gjs-template-builder .gjs-two-color { color: #e4e4e7; }
        #gjs-template-builder .gjs-three-bg { background-color: #1a1d27; }
        #gjs-template-builder .gjs-four-color-hover:hover { color: #fb923c; }
        #gjs-template-builder .gjs-block { background: #2d3139; border: 1px solid #3f3f46; color: #e4e4e7; border-radius: 6px; }
        #gjs-template-builder .gjs-block:hover { border-color: #fb923c; }
      `}</style>
    </div>
  );
}
