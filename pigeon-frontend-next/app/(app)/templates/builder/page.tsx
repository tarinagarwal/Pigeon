"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Save, FilePlus, Loader2, FileText, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useTemplates, useCreateTemplate, useUpdateTemplate } from "@/hooks/useTemplates";
import { TemplateBuilderEditor, type TemplateBuilderEditorRef } from "@/components/TemplateBuilderEditor";
import { AppPageShell } from "@/components/AppPageShell";
import { toast } from "sonner";
import type { EmailTemplate } from "@/types/api";
import {
  getLibraryTemplateHtmlUrl,
  getLibraryTemplateById,
} from "@/lib/email-templates-library";

function inlineCssWithJuice(html: string, css: string): string {
  try {
    // juice/client is used in browser; main package has "browser": "client.js"
    const juice = require("juice");
    if (typeof juice.inlineContent === "function") {
      return juice.inlineContent(html, css || "", {
        removeStyleTags: true,
        preserveMediaQueries: true,
      });
    }
    return html;
  } catch (e) {
    console.error("Juice inline failed:", e);
    return html;
  }
}

export default function TemplateBuilderPage() {
  const searchParams = useSearchParams();
  const libraryId = searchParams?.get("library") || null;

  const { user, effectiveUserId } = useAuth();
  const userId = effectiveUserId;
  const editorRef = useRef<TemplateBuilderEditorRef | null>(null);
  const [editorReady, setEditorReady] = useState(false);

  const [templateName, setTemplateName] = useState("");
  const [templateSubject, setTemplateSubject] = useState("");
  const [openTemplateId, setOpenTemplateId] = useState<string>("");
  const [libraryHtml, setLibraryHtml] = useState<string | null>(null);
  const [libraryLoading, setLibraryLoading] = useState(!!libraryId);

  const { data: templates = [], isLoading: templatesLoading } = useTemplates(userId);
  const createTemplate = useCreateTemplate();
  const updateTemplate = useUpdateTemplate();

  useEffect(() => {
    if (!libraryId) {
      setLibraryLoading(false);
      return;
    }
    let cancelled = false;
    setLibraryLoading(true);
    fetch(getLibraryTemplateHtmlUrl(libraryId))
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error("Failed to load"))))
      .then((html) => {
        if (!cancelled) {
          setLibraryHtml(html);
          const meta = getLibraryTemplateById(libraryId);
          if (meta) {
            setTemplateName(`${meta.name} (from library)`);
            setTemplateSubject(meta.name);
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLibraryHtml(null);
          toast.error("Could not load library template");
        }
      })
      .finally(() => {
        if (!cancelled) setLibraryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [libraryId]);

  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/css/grapes.min.css";
    link.id = "grapesjs-css";
    if (!document.getElementById("grapesjs-css")) {
      document.head.appendChild(link);
    }
    return () => {
      document.getElementById("grapesjs-css")?.remove();
    };
  }, []);

  const selectedTemplate = templates.find((t) => t.id === openTemplateId);
  const initialHtml = libraryHtml ?? selectedTemplate?.body ?? null;

  const onEditorReady = useCallback((ref: TemplateBuilderEditorRef) => {
    editorRef.current = ref;
    setEditorReady(true);
  }, []);

  const handleOpenTemplate = (templateId: string) => {
    setOpenTemplateId(templateId);
    const t = templates.find((x) => x.id === templateId);
    if (t) {
      setTemplateName(t.name);
      setTemplateSubject(t.subject || "");
      if (editorRef.current) {
        editorRef.current.setContent(t.body || "");
      }
    }
  };

  const handleNew = () => {
    setOpenTemplateId("");
    setTemplateName("");
    setTemplateSubject("");
    editorRef.current?.clear();
  };

  const handleSave = async () => {
    if (!userId) return;
    const name = templateName.trim() || "Untitled template";
    const subject = templateSubject.trim() || "No subject";
    if (!editorRef.current) {
      toast.error("Editor not ready");
      return;
    }
    const html = editorRef.current.getHtml();
    const css = editorRef.current.getCss();
    const inlinedBody = inlineCssWithJuice(html, css);
    if (!inlinedBody.trim()) {
      toast.error("Template content is empty");
      return;
    }

    const maxSeq =
      templates.length > 0
        ? Math.max(...templates.map((t) => t.sequence_number ?? 0))
        : 0;
    const sequence_number = selectedTemplate?.sequence_number ?? maxSeq + 1;

    if (selectedTemplate) {
      updateTemplate.mutate(
        {
          templateId: selectedTemplate.id,
          data: {
            ...selectedTemplate,
            name,
            subject,
            body: inlinedBody,
            body_type: "rich",
            sequence_number,
            updated_at: new Date().toISOString(),
          },
        },
        {
          onSuccess: () => {
            toast.success("Template updated");
            setOpenTemplateId(selectedTemplate.id);
          },
        }
      );
    } else {
      const newTemplate: EmailTemplate = {
        id: crypto.randomUUID(),
        user_id: userId,
        name,
        subject,
        body: inlinedBody,
        body_type: "rich",
        sequence_number,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      createTemplate.mutate(newTemplate, {
        onSuccess: (saved) => {
          toast.success("Template saved");
          setOpenTemplateId(saved.id);
          setTemplateName(saved.name);
          setTemplateSubject(saved.subject || "");
        },
      });
    }
  };

  const isSaving = createTemplate.isPending || updateTemplate.isPending;

  return (
    <AppPageShell
      title="Template Builder"
      description="Design your emails with drag-and-drop. Save to your templates, then use them in campaigns or send as usual."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/templates" className="gap-2">
              <ArrowLeft className="w-4 h-4" />
              Back to templates
            </Link>
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div
          role="alert"
          className="flex gap-4 rounded-xl border border-amber-500/30 bg-card px-5 py-4 shadow-sm"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/15">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <h3 className="font-semibold text-foreground">
              Heads up — deliverability
            </h3>
            <p className="text-sm leading-relaxed text-foreground/90">
              Using flashy banner templates can increase the chance of landing in spam. Only use these if you really need a designed banner. For better deliverability, prefer{" "}
              <Link
                href="/ai-campaign-studio"
                className="font-medium text-primary underline underline-offset-2 hover:no-underline"
              >
                AI Campaign Studio
              </Link>
              , which creates natural, inbox-friendly emails.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-4 p-4 rounded-xl border bg-card">
          <div className="flex-1 min-w-[200px] space-y-2">
            <Label htmlFor="builder-name">Template name</Label>
            <Input
              id="builder-name"
              placeholder="e.g. Cold outreach v1"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
            />
          </div>
          <div className="flex-1 min-w-[200px] space-y-2">
            <Label htmlFor="builder-subject">Subject line</Label>
            <Input
              id="builder-subject"
              placeholder="e.g. Quick question about {{company}}"
              value={templateSubject}
              onChange={(e) => setTemplateSubject(e.target.value)}
            />
          </div>
          <div className="min-w-[200px] space-y-2">
            <Label>Load existing template</Label>
            <Select
              value={openTemplateId || "__new__"}
              onValueChange={(v) => (v === "__new__" ? handleNew() : handleOpenTemplate(v))}
            >
              <SelectTrigger>
                <SelectValue placeholder="New template" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__new__">
                  <span className="flex items-center gap-2">
                    <FilePlus className="w-4 h-4" />
                    New template
                  </span>
                </SelectItem>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    <span className="flex items-center gap-2 truncate">
                      <FileText className="w-4 h-4 shrink-0" />
                      {t.name || "Untitled"}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            className="gap-2"
            onClick={handleSave}
            disabled={!editorReady || isSaving}
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {selectedTemplate ? "Update template" : "Save as template"}
          </Button>
        </div>

        <div className="rounded-xl border bg-card p-2">
          {libraryLoading ? (
            <div className="min-h-[400px] flex items-center justify-center text-muted-foreground gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              Loading library template…
            </div>
          ) : templatesLoading ? (
            <div className="min-h-[400px] flex items-center justify-center text-muted-foreground">
              Loading templates…
            </div>
          ) : (
            <TemplateBuilderEditor
              key={libraryId || openTemplateId || "new"}
              initialHtml={initialHtml}
              onReady={onEditorReady}
            />
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Templates you save here appear in Template Management. Use them in campaigns or when sending emails.
        </p>
      </div>
    </AppPageShell>
  );
}
