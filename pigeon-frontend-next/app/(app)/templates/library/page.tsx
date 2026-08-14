"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Eye,
  Pencil,
  Search,
  Library,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AppPageShell } from "@/components/AppPageShell";
import {
  LIBRARY_TEMPLATES,
  getLibraryTemplateHtmlUrl,
  getLibraryTemplateById,
} from "@/lib/email-templates-library";

export default function TemplatesLibraryPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);

  const filtered = LIBRARY_TEMPLATES.filter((t) =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <AppPageShell
      title="Templates Library"
      description="Ready-made email designs. Preview any template or customize it in the visual editor."
      actions={
        <Button variant="outline" size="sm" asChild>
          <Link href="/templates" className="gap-2">
            <ArrowLeft className="w-4 h-4" />
            Back to templates
          </Link>
        </Button>
      }
    >
      <div className="space-y-6">
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

        <div className="flex flex-wrap items-center gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search templates..."
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {filtered.length} template{filtered.length !== 1 ? "s" : ""}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((template, index) => (
            <motion.div
              key={template.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index * 0.03, 0.3) }}
            >
              <Card className="overflow-hidden border bg-card hover:border-primary/40 transition-colors flex flex-col h-full">
                <div className="aspect-[4/3] bg-muted/50 relative overflow-hidden border-b">
                  <iframe
                    title={template.name}
                    src={getLibraryTemplateHtmlUrl(template.id)}
                    className="absolute inset-0 w-full h-full pointer-events-none border-0"
                    style={{
                      transform: "scale(0.25)",
                      transformOrigin: "top left",
                      width: "400%",
                      height: "400%",
                    }}
                  />
                </div>
                <CardHeader className="py-3">
                  <h3 className="font-semibold text-sm leading-tight line-clamp-2">
                    {template.name}
                  </h3>
                </CardHeader>
                <CardContent className="pt-0 pb-4 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={() => setPreviewId(template.id)}
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Preview
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-xs"
                    asChild
                  >
                    <Link href={`/templates/builder?library=${template.id}`}>
                      <Pencil className="w-3.5 h-3.5" />
                      Customize
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="rounded-xl border border-dashed bg-muted/20 p-12 text-center">
            <Library className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No templates match your search.</p>
          </div>
        )}
      </div>

      {/* Full preview modal */}
      <Dialog open={!!previewId} onOpenChange={() => setPreviewId(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
            <DialogTitle>
              {previewId ? getLibraryTemplateById(previewId)?.name : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-auto px-6 pb-6">
            {previewId && (
              <iframe
                title={`Preview ${previewId}`}
                src={getLibraryTemplateHtmlUrl(previewId)}
                className="w-full border rounded-lg bg-white"
                style={{ minHeight: "70vh" }}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </AppPageShell>
  );
}
