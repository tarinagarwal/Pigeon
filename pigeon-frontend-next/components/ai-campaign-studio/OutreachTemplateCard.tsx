"use client";

import Link from "next/link";
import { FileText, ExternalLink, Eye, Tag } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { EmailTemplate } from "@/types/api";

interface OutreachTemplateCardProps {
  template: EmailTemplate;
  onPreview?: () => void;
  onEdit?: () => void;
  /** When true, this template is selected for update (next "update" message will apply to it). */
  taggedForUpdate?: boolean;
  onTagForUpdate?: () => void;
}

export function OutreachTemplateCard({
  template,
  onPreview,
  onEdit,
  taggedForUpdate,
  onTagForUpdate,
}: OutreachTemplateCardProps) {
  const subjectSnippet =
    template.subject.length > 60
      ? `${template.subject.slice(0, 60)}...`
      : template.subject;

  return (
    <Card
      className={cn(
        "w-full max-w-md rounded-xl border bg-card/80 shadow-sm overflow-hidden",
        taggedForUpdate ? "border-primary/60 ring-1 ring-primary/20" : "border-border/60"
      )}
    >
      <CardHeader className="pb-2 pt-3 px-3">
        <div className="flex items-start gap-2 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <FileText className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <span className="font-medium text-sm text-foreground break-words">{template.name}</span>
            {taggedForUpdate && (
              <span className="mt-1 block text-[10px] font-medium text-primary">
                Selected for update
              </span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 px-3 pb-3">
        <p className="text-xs text-muted-foreground line-clamp-2">
          {subjectSnippet}
        </p>
        <div className="flex flex-wrap gap-2">
          {onEdit ? (
            <Button variant="outline" size="sm" className="rounded-lg border-border/60 gap-1.5" onClick={onEdit}>
              Edit email
              <ExternalLink className="h-3 w-3" />
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="rounded-lg border-border/60 gap-1.5" asChild>
              <Link href={`/templates/${template.id}/edit`} target="_blank" rel="noopener noreferrer">
                Edit email
                <ExternalLink className="h-3 w-3" />
              </Link>
            </Button>
          )}
          {onPreview && (
            <Button
              variant="outline"
              size="sm"
              className="rounded-lg gap-1.5 border-border/60"
              onClick={onPreview}
            >
              <Eye className="h-3 w-3" />
              Preview
            </Button>
          )}
          {onTagForUpdate && !taggedForUpdate && (
            <Button
              variant="outline"
              size="sm"
              className="rounded-lg gap-1.5 border-border/60"
              onClick={onTagForUpdate}
            >
              <Tag className="h-3 w-3" />
              Tag for update
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
