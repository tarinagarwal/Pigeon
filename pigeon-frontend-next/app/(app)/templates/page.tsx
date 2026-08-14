"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Plus,
  Search,
  MoreHorizontal,
  Copy,
  Pencil,
  Trash2,
  Eye,
  FileText,
  Mail,
  TestTube,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmDialog } from "@/components/ConfirmDialog";
import {
  useTemplates,
  useDeleteTemplate,
  useDeleteTemplates,
  useCreateTemplate,
} from "@/hooks/useTemplates";
import { useCampaigns } from "@/hooks/useCampaigns";
import { useInboxes } from "@/hooks/useInboxes";
import { useSettings } from "@/hooks/useSettings";
import type { EmailTemplate } from "@/types/api";
import { htmlToPlainText, replacePlaceholdersWithSample } from "@/lib/templateBody";
import { IsolatedPreview } from "@/components/IsolatedPreview";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { toast } from "sonner";
import { HelpLinks } from "@/components/HelpLinks";
import { AppPageShell } from "@/components/AppPageShell";
import { EmptyState } from "@/components/EmptyState";
import { RetryBlock } from "@/components/feedback/RetryBlock";

export default function TemplatesPage() {
  const { user, effectiveUserId } = useAuth();
  const userId = effectiveUserId;
  const confirmDialog = useConfirmDialog();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTemplates, setSelectedTemplates] = useState<string[]>([]);
  const [previewTemplate, setPreviewTemplate] = useState<EmailTemplate | null>(null);

  const {
    data: templates = [],
    isLoading: templatesLoading,
    isError: templatesError,
    error: templatesErrorMsg,
    refetch: refetchTemplates,
  } = useTemplates(userId);
  const { data: campaigns = [], isLoading: campaignsLoading } = useCampaigns(userId, { archived: false });
  const { isLoading: settingsLoading } = useSettings();
  const deleteTemplate = useDeleteTemplate();
  const deleteTemplates = useDeleteTemplates();
  const createTemplate = useCreateTemplate();

  const pageDataLoading = templatesLoading || campaignsLoading || settingsLoading;

  const filteredTemplates = useMemo(() => {
    if (!searchQuery) return templates;
    const query = searchQuery.toLowerCase();
    return templates.filter(
      (t) =>
        t.name.toLowerCase().includes(query) ||
        t.subject.toLowerCase().includes(query) ||
        (t.body || "").toLowerCase().includes(query)
    );
  }, [templates, searchQuery]);

  const templateIdsInCampaignsSet = useMemo(
    () => new Set(campaigns.flatMap((c) => c.template_ids || [])),
    [campaigns]
  );

  const stats = useMemo(() => {
    const totalTemplates = templates.length;
    const templateIdsInCampaigns = new Set(campaigns.flatMap((c) => c.template_ids || []));
    const activeInCampaigns = templates.filter((t) => templateIdsInCampaigns.has(t.id)).length;
    const abTestsRunning = campaigns.filter((c) => {
      const n = (c.template_ids || []).length;
      return n >= 2 && (c.status === "active" || c.status === "draft");
    }).length;
    return [
      { title: "Total Templates", value: totalTemplates.toString(), icon: FileText },
      { title: "Active in Campaigns", value: activeInCampaigns.toString(), icon: Mail },
      { title: "A/B Tests Running", value: abTestsRunning.toString(), icon: TestTube },
    ];
  }, [templates, campaigns]);

  const toggleTemplate = (id: string) => {
    setSelectedTemplates((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleAllTemplates = () => {
    if (selectedTemplates.length === filteredTemplates.length) setSelectedTemplates([]);
    else setSelectedTemplates(filteredTemplates.map((t) => t.id));
  };

  const handleDeleteSelected = async () => {
    const canDelete = selectedTemplates.filter((id) => !templateIdsInCampaignsSet.has(id));
    const inUse = selectedTemplates.length - canDelete.length;
    if (canDelete.length === 0) {
      toast.error("Selected template(s) are used by campaigns and cannot be deleted.");
      return;
    }
    if (inUse > 0) {
      toast.warning(
        `${inUse} template(s) are used by campaigns and will be skipped. ${canDelete.length} template(s) will be deleted.`
      );
    }
    const confirmed = await confirmDialog({
      title: "Delete templates",
      description: `Are you sure you want to delete ${canDelete.length} template(s)?${inUse > 0 ? ` (${inUse} skipped — used in campaigns)` : ""}`,
      variant: "destructive",
    });
    if (confirmed) {
      deleteTemplates.mutate(canDelete, {
        onSuccess: () => setSelectedTemplates([]),
      });
    }
  };

  const handleDuplicate = (template: EmailTemplate) => {
    const newTemplate: EmailTemplate = {
      ...template,
      id: crypto.randomUUID(),
      name: `${template.name} (Copy)`,
      body_type: template.body_type ?? "rich",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    createTemplate.mutate(newTemplate, {
      onSuccess: () => toast.success("Template duplicated successfully"),
      onError: (error: unknown) => toast.error(error instanceof Error ? error.message : "Failed to duplicate template"),
    });
  };

  return (
    <AppPageShell
      title="Templates"
      description="Create and manage email templates for your campaigns."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button className="gradient-primary gap-2" asChild data-tour="templates-add">
            <Link href="/templates/new">
              <Plus className="w-4 h-4" />
              New template
            </Link>
          </Button>
          <Button variant="outline" asChild data-tour="templates-guide">
            <Link href="/templates/guide">Guide</Link>
          </Button>
          <Button variant="outline" asChild data-tour="templates-examples">
            <Link href="/templates/examples">Examples</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/templates/library">Library</Link>
          </Button>
        </div>
      }
    >
    <div className="space-y-6">

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {stats.map((stat, index) => (
          <motion.div
            key={stat.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
          >
            <Card>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg gradient-primary flex items-center justify-center">
                  <stat.icon className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stat.value}</p>
                  <p className="text-sm text-muted-foreground">{stat.title}</p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search templates..."
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        {filteredTemplates.length > 0 && (
          <div className="flex items-center gap-2">
            <Checkbox
              id="select-all-templates"
              checked={selectedTemplates.length === filteredTemplates.length && filteredTemplates.length > 0}
              onCheckedChange={toggleAllTemplates}
            />
            <Label htmlFor="select-all-templates" className="text-sm cursor-pointer">
              Select all
            </Label>
          </div>
        )}
      </div>

      {selectedTemplates.length > 0 && (
        <div className="flex items-center gap-4 p-3 rounded-lg bg-primary/5 border border-primary/20">
          <span className="text-sm font-medium">{selectedTemplates.length} selected</span>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive border-border hover:bg-muted"
            onClick={handleDeleteSelected}
            disabled={
              deleteTemplates.isPending ||
              selectedTemplates.length === 0 ||
              selectedTemplates.every((id) => templateIdsInCampaignsSet.has(id))
            }
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Delete selected
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelectedTemplates([])}>
            Clear selection
          </Button>
        </div>
      )}

      {pageDataLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-1/2 mt-2" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-full mb-2" />
                <Skeleton className="h-4 w-2/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : templatesError ? (
        <div className="text-center py-8">
          <RetryBlock
            title="Failed to load templates"
            description={templatesErrorMsg?.message || "Please try again."}
            onRetry={() => void refetchTemplates()}
          />
        </div>
      ) : filteredTemplates.length === 0 ? (
        <EmptyState
          icon={FileText}
          headline={searchQuery ? "No templates match your search" : "No templates yet"}
          description={
            searchQuery
              ? "Try a different search or clear the search box."
              : "Create your first template to get started."
          }
          primaryAction={
            searchQuery ? (
              <Button variant="outline" onClick={() => setSearchQuery("")}>
                Clear search
              </Button>
            ) : (
              <Button asChild className="gradient-primary">
                <Link href="/templates/new">
                  <Plus className="mr-2 h-4 w-4" />
                  New template
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTemplates.map((template, index) => {
            const usedIn = campaigns.filter((c) => (c.template_ids || []).includes(template.id)).length;
            const updatedAtStr = template.updated_at;
            const isUtc = updatedAtStr && (updatedAtStr.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(updatedAtStr));
            const parsed = updatedAtStr ? new Date(isUtc ? updatedAtStr : updatedAtStr + "Z") : null;
            const lastEdited = parsed ? format(parsed, "MMM d, yyyy 'at' h:mm a") : "Unknown";
            const previewRaw = htmlToPlainText(template.body || "").trim();
            const previewWithSample = replacePlaceholdersWithSample(previewRaw);
            const previewText = previewWithSample.length > 100 ? previewWithSample.substring(0, 100) + "…" : previewWithSample || "—";

            return (
              <motion.div
                key={template.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <Card className="hover:shadow-md transition-shadow group">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2 flex-1 min-w-0">
                        <Checkbox
                          checked={selectedTemplates.includes(template.id)}
                          onCheckedChange={() => toggleTemplate(template.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="mt-0.5 shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <CardTitle className="text-base truncate">{template.name}</CardTitle>
                          <p className="text-sm text-muted-foreground mt-1">Sequence #{template.sequence_number}</p>
                        </div>
                      </div>
                      <div>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 shrink-0">
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={(e) => { e.preventDefault(); setPreviewTemplate(template); }}>
                                <Eye className="w-4 h-4 mr-2" />
                                Preview
                              </DropdownMenuItem>
                              <DropdownMenuItem asChild>
                                <Link href={`/templates/${template.id}/edit`}>
                                  <Pencil className="w-4 h-4 mr-2" />
                                  Edit
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.preventDefault();
                                  handleDuplicate(template);
                                }}
                              >
                                <Copy className="w-4 h-4 mr-2" />
                                Duplicate
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {usedIn > 0 ? (
                                <DropdownMenuItem disabled className="opacity-80">
                                  <Trash2 className="w-4 h-4 mr-2" />
                                  Cannot delete — used in {usedIn} campaign{usedIn !== 1 ? "s" : ""}
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onClick={async (e) => {
                                    e.preventDefault();
                                    const confirmed = await confirmDialog({
                                      title: "Delete template",
                                      description: "Are you sure you want to delete this template?",
                                      variant: "destructive",
                                    });
                                    if (confirmed) deleteTemplate.mutate(template.id);
                                  }}
                                >
                                  <Trash2 className="w-4 h-4 mr-2" />
                                  Delete
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                      <div>
                        <p className="text-sm font-medium mb-1">Subject:</p>
                        <p className="text-sm text-muted-foreground truncate">{template.subject}</p>
                      </div>
                      <div>
                        <p className="text-sm font-medium mb-1">Preview:</p>
                        <p className="text-sm text-muted-foreground line-clamp-2">{previewText}</p>
                      </div>
                      <div className="flex items-center justify-between pt-2 border-t">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            Sequence #{template.sequence_number}
                          </Badge>
                          {usedIn > 0 && (
                            <Badge variant="outline" className="text-xs">
                              Used in {usedIn} campaign{usedIn !== 1 ? "s" : ""}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">Edited {lastEdited}</p>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      <Dialog open={!!previewTemplate} onOpenChange={() => setPreviewTemplate(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{previewTemplate?.name}</DialogTitle>
            <DialogDescription>Template preview</DialogDescription>
          </DialogHeader>
          {previewTemplate && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground rounded-md bg-muted/50 px-3 py-2 border border-border/50">
                <strong>Sample values used for preview:</strong>{" "}
                {"{{first_name}} → John, {{last_name}} → Doe, {{company}} → Acme Inc, {{industry}} → Technology, {{title}} → CEO"}
                . Other placeholders appear as-is.
              </p>
              <div className="p-4 rounded-lg bg-secondary">
                <p className="text-sm text-muted-foreground mb-1">Subject</p>
                <p className="font-medium">{replacePlaceholdersWithSample(previewTemplate.subject ?? "")}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-2">Body</p>
                <IsolatedPreview
                  mode={previewTemplate.body_type === "plain" ? "plain" : "html"}
                  html={replacePlaceholdersWithSample(previewTemplate.body ?? "")}
                  plainText={replacePlaceholdersWithSample(previewTemplate.body ?? "")}
                  title="Template body preview"
                  className="min-h-[200px] max-h-[50vh] w-full rounded-lg border bg-white overflow-hidden"
                />
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPreviewTemplate(null)}>
              Close
            </Button>
            {previewTemplate && (
              <Button className="gradient-primary" asChild>
                <Link href={`/templates/${previewTemplate.id}/edit`} onClick={() => setPreviewTemplate(null)}>
                  <Pencil className="w-4 h-4 mr-2" />
                  Edit Template
                </Link>
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <HelpLinks
        slugs={[
          "create-first-email-template",
          "use-merge-variables-first-name-company",
          "use-template-guide-and-examples",
          "add-unsubscribe-link-compliance",
        ]}
        className="mt-6"
      />
    </div>
    </AppPageShell>
  );
}
