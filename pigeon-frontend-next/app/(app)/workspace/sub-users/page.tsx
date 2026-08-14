"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  UserCog,
  Plus,
  Trash2,
  Pencil,
  X,
  Check,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type SubUserEntry, type SubUserPermissionsPayload } from "@/lib/api";

// ─── Permission metadata ────────────────────────────────────────────────────

const PERMISSION_LABELS: {
  key: keyof SubUserPermissionsPayload;
  label: string;
  description: string;
}[] = [
  { key: "dashboard", label: "Dashboard", description: "Home overview and metrics" },
  { key: "inbox", label: "Inbox", description: "Email inbox and replies" },
  { key: "campaigns", label: "Campaigns & AI Studio", description: "Create and manage campaigns" },
  { key: "contacts", label: "Contacts", description: "Contact lists and smart leads" },
  { key: "templates", label: "Templates", description: "Email template builder" },
  { key: "workflows", label: "Workflows", description: "Automation workflows" },
  { key: "analytics", label: "Analytics", description: "Campaign performance data" },
  { key: "tracking", label: "Tracking", description: "Open and click tracking" },
  { key: "domains", label: "Domains", description: "Domain setup and DNS" },
  { key: "inboxes", label: "Inbox Accounts", description: "SMTP and Gmail accounts" },
  { key: "warmup", label: "Warmup", description: "Email warmup dashboard" },
  { key: "settings", label: "Settings", description: "Account settings and billing" },
];

const DEFAULT_PERMISSIONS: SubUserPermissionsPayload = {
  dashboard: true,
  inbox: true,
  campaigns: true,
  contacts: true,
  templates: true,
  workflows: true,
  analytics: true,
  tracking: true,
  domains: true,
  inboxes: true,
  warmup: true,
  settings: false,
};

// ─── PermissionGrid ─────────────────────────────────────────────────────────

function PermissionGrid({
  permissions,
  onChange,
}: {
  permissions: SubUserPermissionsPayload;
  onChange: (updated: SubUserPermissionsPayload) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {PERMISSION_LABELS.map(({ key, label, description }) => (
        <div
          key={key}
          className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/30 px-3 py-2"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium leading-none">{label}</p>
            <p className="mt-0.5 text-xs text-muted-foreground truncate">{description}</p>
          </div>
          <Switch
            checked={permissions[key]}
            onCheckedChange={(val) => onChange({ ...permissions, [key]: val })}
            className="ml-3 shrink-0"
          />
        </div>
      ))}
    </div>
  );
}

// ─── AddSubUserDialog ────────────────────────────────────────────────────────

function AddSubUserDialog({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (email: string, name: string, permissions: SubUserPermissionsPayload) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [permissions, setPermissions] = useState<SubUserPermissionsPayload>({ ...DEFAULT_PERMISSIONS });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!email.trim()) {
      setError("Email is required");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await onAdd(email.trim(), name.trim(), permissions);
      setEmail("");
      setName("");
      setPermissions({ ...DEFAULT_PERMISSIONS });
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to add sub-user");
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setEmail("");
    setName("");
    setPermissions({ ...DEFAULT_PERMISSIONS });
    setError(null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Team Member</DialogTitle>
          <DialogDescription>
            Invite a user to your workspace and configure which pages they can access.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-2">
            <Label htmlFor="sub-email">Email address</Label>
            <Input
              id="sub-email"
              type="email"
              placeholder="colleague@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="sub-name">Display name (optional)</Label>
            <Input
              id="sub-name"
              placeholder="e.g. Jane Smith"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Page access</Label>
            <p className="text-xs text-muted-foreground">
              Pages toggled off will be hidden from this team member.
            </p>
            <PermissionGrid permissions={permissions} onChange={setPermissions} />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? "Adding…" : "Add member"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── EditPermissionsDialog ───────────────────────────────────────────────────

function EditPermissionsDialog({
  subUser,
  onClose,
  onSave,
}: {
  subUser: SubUserEntry | null;
  onClose: () => void;
  onSave: (id: string, name: string, permissions: SubUserPermissionsPayload) => Promise<void>;
}) {
  const [permissions, setPermissions] = useState<SubUserPermissionsPayload>(
    subUser?.permissions ?? { ...DEFAULT_PERMISSIONS }
  );
  const [name, setName] = useState(subUser?.name ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync when subUser changes
  if (subUser && subUser.permissions !== permissions && !loading) {
    // only on first open
  }

  const handleSave = async () => {
    if (!subUser) return;
    setError(null);
    setLoading(true);
    try {
      await onSave(subUser.id, name, permissions);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update permissions");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={!!subUser} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Access — {subUser?.name || subUser?.sub_user_email}</DialogTitle>
          <DialogDescription>
            Adjust which pages this team member can see.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-2">
            <Label htmlFor="edit-name">Display name</Label>
            <Input
              id="edit-name"
              placeholder="e.g. Jane Smith"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Page access</Label>
            <PermissionGrid permissions={permissions} onChange={setPermissions} />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── SubUserRow ──────────────────────────────────────────────────────────────

function SubUserRow({
  subUser,
  onEdit,
  onRemove,
}: {
  subUser: SubUserEntry;
  onEdit: (s: SubUserEntry) => void;
  onRemove: (s: SubUserEntry) => void;
}) {
  const allowedCount = Object.values(subUser.permissions).filter(Boolean).length;
  const totalCount = PERMISSION_LABELS.length;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-card px-4 py-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <UserCog className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">
            {subUser.name || subUser.sub_user_email}
          </p>
          {subUser.sub_user_id ? (
            <Badge variant="outline" className="shrink-0 bg-green-500/10 text-green-600 border-green-500/20 text-[10px]">
              <Check className="mr-1 h-2.5 w-2.5" />
              Account linked
            </Badge>
          ) : (
            <Badge variant="outline" className="shrink-0 bg-amber-500/10 text-amber-600 border-amber-500/20 text-[10px]">
              No account yet
            </Badge>
          )}
        </div>
        {subUser.name && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{subUser.sub_user_email}</p>
        )}
        <p className="mt-0.5 text-xs text-muted-foreground">
          {allowedCount === totalCount ? (
            <span className="flex items-center gap-1 text-green-600">
              <ShieldCheck className="h-3 w-3" /> Full access
            </span>
          ) : allowedCount === 0 ? (
            <span className="flex items-center gap-1 text-destructive">
              <ShieldOff className="h-3 w-3" /> No access
            </span>
          ) : (
            `${allowedCount} of ${totalCount} pages`
          )}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:bg-primary hover:text-white"
          onClick={() => onEdit(subUser)}
          title="Edit access"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:bg-primary hover:text-white"
          onClick={() => onRemove(subUser)}
          title="Remove member"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SubUsersPage() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["workspace-sub-users"],
    queryFn: () => api.workspace.listSubUsers(),
  });

  const subUsers = data?.sub_users ?? [];

  const addMutation = useMutation({
    mutationFn: (payload: {
      email: string;
      name?: string;
      permissions: SubUserPermissionsPayload;
    }) => api.workspace.addSubUser(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workspace-sub-users"] }),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      name,
      permissions,
    }: {
      id: string;
      name: string;
      permissions: SubUserPermissionsPayload;
    }) => api.workspace.updateSubUser(id, { permissions, name: name || undefined }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workspace-sub-users"] }),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.workspace.removeSubUser(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workspace-sub-users"] }),
  });

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SubUserEntry | null>(null);
  const [removeTarget, setRemoveTarget] = useState<SubUserEntry | null>(null);

  const handleAdd = async (
    email: string,
    name: string,
    permissions: SubUserPermissionsPayload
  ) => {
    await addMutation.mutateAsync({ email, name: name || undefined, permissions });
  };

  const handleSaveEdit = async (
    id: string,
    name: string,
    permissions: SubUserPermissionsPayload
  ) => {
    await updateMutation.mutateAsync({ id, name, permissions });
  };

  const handleConfirmRemove = async () => {
    if (!removeTarget) return;
    await removeMutation.mutateAsync(removeTarget.id);
    setRemoveTarget(null);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Team Members</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Add team members and control which pages they can access in your workspace.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)} size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          Add member
        </Button>
      </div>

      {/* List */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Members</CardTitle>
          <CardDescription>
            {subUsers.length === 0
              ? "No team members yet."
              : `${subUsers.length} team member${subUsers.length === 1 ? "" : "s"}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <>
              <Skeleton className="h-16 w-full rounded-lg" />
              <Skeleton className="h-16 w-full rounded-lg" />
            </>
          ) : subUsers.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <UserCog className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">No team members yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Add a team member to let them access your workspace with controlled permissions.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setAddOpen(true)} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                Add first member
              </Button>
            </div>
          ) : (
            subUsers.map((s) => (
              <SubUserRow
                key={s.id}
                subUser={s}
                onEdit={(target) => {
                  setEditTarget({ ...target });
                }}
                onRemove={setRemoveTarget}
              />
            ))
          )}
        </CardContent>
      </Card>

      {/* How it works */}
      <Card className="border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">How it works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 text-xs text-muted-foreground">
          <p>• Enter the email address of the person you want to add as a team member.</p>
          <p>• Toggle which pages they can see in the sidebar — pages they cannot access will be hidden.</p>
          <p>• If the email belongs to an existing Pigeon account, their access is linked immediately.</p>
          <p>• You can update or remove a member's access at any time.</p>
        </CardContent>
      </Card>

      {/* Dialogs */}
      <AddSubUserDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdd={handleAdd}
      />

      {editTarget && (
        <EditPermissionsDialog
          subUser={editTarget}
          onClose={() => setEditTarget(null)}
          onSave={handleSaveEdit}
        />
      )}

      <AlertDialog open={!!removeTarget} onOpenChange={(v) => !v && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove team member?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{removeTarget?.name || removeTarget?.sub_user_email}</strong> will lose access
              to your workspace immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmRemove}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
