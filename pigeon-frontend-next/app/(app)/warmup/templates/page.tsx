"use client";

import { useState, useRef, FormEvent } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Mail,
  Plus,
  Pencil,
  Trash2,
  FileText,
  RefreshCw,
  Lightbulb,
  Variable,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useConfirmDialog } from "@/components/ConfirmDialog";
import {
  useWarmupSendTemplates,
  useCreateWarmupSendTemplate,
  useUpdateWarmupSendTemplate,
  useDeleteWarmupSendTemplate,
  type WarmupSendTemplateItem,
} from "@/hooks/useWarmup";
import { usePlanGate } from "@/hooks/usePlanGate";
import { UpgradeModal } from "@/components/UpgradeModal";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RichTextEditor } from "@/components/RichTextEditor";
import { htmlToPlainText } from "@/lib/templateBody";

const WARMUP_MERGE_FIELDS: { key: string; label: string }[] = [
  { key: "receiver_email", label: "Receiver email" },
  { key: "receiver_name", label: "Receiver name" },
  { key: "receiverEmail", label: "Receiver email (alt)" },
  { key: "receiverName", label: "Receiver name (alt)" },
  { key: "sender_email", label: "Sender email" },
  { key: "sender_name", label: "Sender name" },
  { key: "senderEmail", label: "Sender email (alt)" },
  { key: "senderName", label: "Sender name (alt)" },
];

function warmupBodyHasContent(body: string, bodyType: "html" | "plain" | "rich"): boolean {
  const b = body.trim();
  if (!b) return false;
  if (bodyType === "plain") return true;
  return htmlToPlainText(b).trim().length > 0 || /<img\b/i.test(b);
}

export default function WarmupEmailTemplatesPage() {
  const warmupGate = usePlanGate("warmup");
  const confirmDialog = useConfirmDialog();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<WarmupSendTemplateItem | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editBodyType, setEditBodyType] = useState<"html" | "plain" | "rich">("rich");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkLines, setBulkLines] = useState("");
  const editRichRef = useRef<import("@/components/RichTextEditor").RichTextEditorRef>(null);
  const editBodyTextareaRef = useRef<HTMLTextAreaElement>(null);

  const { data, isLoading, refetch } = useWarmupSendTemplates(!warmupGate.atLimit);
  const templates = data?.templates ?? [];
  const createTemplate = useCreateWarmupSendTemplate();
  const updateTemplate = useUpdateWarmupSendTemplate();
  const deleteTemplate = useDeleteWarmupSendTemplate();

  const openEdit = (item: WarmupSendTemplateItem) => {
    setEditing(item);
    setEditSubject(item.subject);
    setEditBody(item.body);
    setEditBodyType((item.body_type as "html" | "plain" | "rich") ?? "rich");
    setEditOpen(true);
  };

  const handleSaveEdit = (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const subject = editSubject.trim();
    const body = editBody.trim();
    if (!subject || !warmupBodyHasContent(body, editBodyType)) return;
    updateTemplate.mutate(
      { templateId: editing.id, subject, body, body_type: editBodyType },
      { onSuccess: () => { setEditOpen(false); setEditing(null); } }
    );
  };

  const handleBulkImport = async (e: FormEvent) => {
    e.preventDefault();
    const lines = bulkLines.split("\n").map((s) => s.trim()).filter(Boolean);
    const pairs: { subject: string; body: string }[] = [];
    for (const line of lines) {
      const idx = line.indexOf("\t");
      if (idx >= 0) {
        pairs.push({ subject: line.slice(0, idx).trim(), body: line.slice(idx + 1).trim() });
      } else {
        pairs.push({ subject: line, body: "" });
      }
    }
    const valid = pairs.filter((p) => p.subject || p.body);
    if (valid.length === 0) {
      toast.error("Use one line per template. Separate subject and body with a tab (or use Add template).");
      return;
    }
    try {
      let count = 0;
      for (const { subject, body } of valid) {
        await createTemplate.mutateAsync({
          subject: subject || "No subject",
          body: body || "No body",
          body_type: "plain",
        });
        count++;
      }
      setBulkOpen(false);
      setBulkLines("");
      toast.success(`${count} template(s) added.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bulk import failed");
    }
  };

  const handleDelete = async (id: string) => {
    const ok = await confirmDialog({
      title: "Delete template",
      description: "Remove this warmup template?",
      variant: "destructive",
    });
    if (ok) deleteTemplate.mutate(id);
  };

  if (warmupGate.atLimit) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/warmup">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <h1 className="text-2xl font-bold">Email Templates</h1>
        </div>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground mb-4">
              Email Templates are available on plans that include inbox warmup.
            </p>
            <Button onClick={() => setUpgradeOpen(true)}>Upgrade plan</Button>
          </CardContent>
        </Card>
        <UpgradeModal featureKey="warmup" gate={warmupGate} open={upgradeOpen} onOpenChange={setUpgradeOpen} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <UpgradeModal featureKey="warmup" gate={warmupGate} open={upgradeOpen} onOpenChange={setUpgradeOpen} />

      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/warmup">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Mail className="h-6 w-6" />
              Email Templates
            </h1>
            <p className="text-muted-foreground mt-1">
              Each template is one subject + one body. When sending warmup emails, the system picks one random template (subject and body together) per send.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setBulkLines(""); setBulkOpen(true); }}>
            <FileText className="h-4 w-4 mr-2" />
            Bulk import
          </Button>
          <Button size="sm" asChild className="gradient-primary">
            <Link href="/warmup/templates/new">
              <Plus className="h-4 w-4 mr-2" />
              Add template
            </Link>
          </Button>
        </div>
      </div>

      <Card className="border-amber-500/20 bg-amber-500/5">
        <CardContent className="py-3 px-4">
            <p className="text-sm text-muted-foreground">
            Each template can be <strong className="font-medium text-foreground">plain text</strong>,{" "}
            <strong className="font-medium text-foreground">HTML</strong>, or{" "}
            <strong className="font-medium text-foreground">Rich text</strong> (same as campaign templates). When a
            template is chosen for a send, the message uses that format—<code className="text-xs bg-muted px-1 rounded">text/plain</code> or{" "}
            <code className="text-xs bg-muted px-1 rounded">text/html</code>. Merge fields{" "}
            <code className="text-xs bg-muted px-1 rounded">{"{{receiver_email}}"}</code>,{" "}
            <code className="text-xs bg-muted px-1 rounded">{"{{receiver_name}}"}</code>,{" "}
            <code className="text-xs bg-muted px-1 rounded">{"{{sender_email}}"}</code>,{" "}
            <code className="text-xs bg-muted px-1 rounded">{"{{sender_name}}"}</code> are filled from the pool receiver and your sending inbox at send time.{" "}
            <strong className="font-medium text-foreground">Spintax</strong>{" "}
            <code className="text-xs bg-muted px-1 rounded">{"{Hi|Hello}"}</code> is supported too (random option each send), same as campaign templates.
          </p>
        </CardContent>
      </Card>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="py-4 px-4 flex items-start gap-3">
          <Lightbulb className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-sm">Recommendation</p>
            <p className="text-sm text-muted-foreground mt-1">
              Add at least <strong>10 warmup send templates</strong> for best results. More variety makes warmup traffic look more natural to email providers and can improve deliverability.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Email Templates ({templates.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead className="w-24">Format</TableHead>
                    <TableHead>Body</TableHead>
                    <TableHead className="w-32 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {templates.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                        No templates yet. Add one (subject + body) or use Bulk import: one line per template, subject and body separated by a tab.
                      </TableCell>
                    </TableRow>
                  ) : (
                    templates.map((item, i) => (
                      <TableRow key={item.id}>
                        <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                        <TableCell className="max-w-xs" title={item.subject}>
                          {item.subject.length > 50 ? item.subject.slice(0, 50) + "…" : item.subject}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {item.body_type === "rich"
                            ? "Rich text"
                            : item.body_type === "html"
                              ? "HTML"
                              : "Plain"}
                        </TableCell>
                        <TableCell className="max-w-md" title={item.body}>
                          {item.body.length > 60 ? item.body.slice(0, 60) + "…" : item.body}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-0.5">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted"
                              onClick={() => openEdit(item)}
                              title="Edit"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                              onClick={() => handleDelete(item.id)}
                              title="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={(open) => { setEditOpen(open); if (!open) setEditing(null); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit template</DialogTitle>
            <DialogDescription>
              One subject and one body per template. Choose plain text, HTML, or Rich text like campaign templates.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveEdit} className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="edit-body-type">Body format</Label>
                <Select value={editBodyType} onValueChange={(v: "html" | "plain" | "rich") => setEditBodyType(v)}>
                  <SelectTrigger id="edit-body-type" className="w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="html">HTML</SelectItem>
                    <SelectItem value="plain">Plain Text</SelectItem>
                    <SelectItem value="rich">Rich Text</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {editBodyType !== "rich" && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 flex items-start gap-2 text-xs text-muted-foreground">
                  <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <p>
                    Use <strong className="text-foreground">Rich text</strong> for the visual editor;{" "}
                    <strong className="text-foreground">HTML</strong> to paste raw markup.
                  </p>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-subject">Subject</Label>
              <Input
                id="edit-subject"
                value={editSubject}
                onChange={(e) => setEditSubject(e.target.value)}
                placeholder="e.g. Quick check-in"
                required
              />
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor="edit-body">Body</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" size="sm" className="gap-1">
                      <Variable className="h-3.5 w-3.5" />
                      Insert merge field
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    {WARMUP_MERGE_FIELDS.map(({ key, label }) => (
                      <DropdownMenuItem
                        key={key}
                        onClick={() => {
                          const token = `{{${key}}}`;
                          if (editBodyType === "rich") {
                            editRichRef.current?.editor?.chain().focus().insertContent(token).run();
                          } else {
                            const el = editBodyTextareaRef.current;
                            const v = editBody;
                            const start = el?.selectionStart ?? v.length;
                            const end = el?.selectionEnd ?? v.length;
                            setEditBody(v.slice(0, start) + token + v.slice(end));
                            requestAnimationFrame(() => {
                              el?.focus();
                              el?.setSelectionRange(start + token.length, start + token.length);
                            });
                          }
                        }}
                      >
                        {`{{${key}}}`}
                        <span className="ml-1 text-muted-foreground text-xs">({label})</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {editBodyType === "rich" ? (
                <RichTextEditor
                  key={editing?.id ?? "edit-rich"}
                  ref={editRichRef}
                  value={editBody}
                  onChange={setEditBody}
                  placeholder="Warmup body…"
                  className="min-h-[240px]"
                />
              ) : (
                <Textarea
                  ref={editBodyTextareaRef}
                  id="edit-body"
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  placeholder="e.g. Hope you're having a good week. Just wanted to say hi."
                  rows={6}
                  required
                  className="font-mono text-sm min-h-[160px]"
                />
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  !editSubject.trim() || !warmupBodyHasContent(editBody, editBodyType) || updateTemplate.isPending
                }
              >
                Update
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Bulk import templates</DialogTitle>
            <DialogDescription>
              One template per line. Separate subject and body with a tab character. Imports always use{" "}
              <strong>plain text</strong> format; add HTML templates individually from Add template.
              Example: <code className="text-xs bg-muted px-1 rounded">Quick check-in	Hope you&apos;re having a good week.</code>
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleBulkImport} className="space-y-4">
            <div className="space-y-2">
              <Label>Lines (subject [tab] body, one per line)</Label>
              <Textarea
                value={bulkLines}
                onChange={(e) => setBulkLines(e.target.value)}
                rows={12}
                className="font-mono text-sm"
                placeholder={"Quick check-in\tHope you're having a good week. Just wanted to say hi.\nFollowing up\tNo rush—just following up when you have a moment."}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setBulkOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createTemplate.isPending}>Import</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
