'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import type { Workflow } from '@/types/api';

type CreateWorkflowInput = {
  name: string;
  description: string;
  scope: Workflow['scope'];
  triggerType: string;
};

const STATUS_STYLES: Record<string, string> = {
  active:
    'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 ',
  draft:
    'bg-slate-100 text-slate-600 ring-1 ring-slate-200 ',
  paused:
    'bg-amber-50 text-amber-700 ring-1 ring-amber-200 ',
};

const SCOPE_ICON: Record<string, string> = {
  campaign: '📣',
  list: '📋',
  contact: '👤',
  global: '🌐',
};

const TRIGGER_LABELS: Record<string, string> = {
  onCampaignStarted: 'Campaign started',
  onEmailSent: 'Email sent',
  onEmailOpened: 'Email opened',
  onEmailReplied: 'Email replied',
};

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return 'Today ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function WorkflowsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null);
  const [newName, setNewName] = useState('New workflow');
  const [newDescription, setNewDescription] = useState('');
  const [newScope, setNewScope] = useState<Workflow['scope']>('campaign');
  const [newTriggerType, setNewTriggerType] = useState('onCampaignStarted');
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editScope, setEditScope] = useState<Workflow['scope']>('campaign');
  const [editTriggerType, setEditTriggerType] = useState('onCampaignStarted');

  const { data, isLoading } = useQuery({
    queryKey: ['workflows'],
    queryFn: async () => {
      const me = await api.auth.getMe();
      const userId = me?.id as string;
      if (!userId) return { workflows: [] as Workflow[] };
      return api.workflows.list(userId);
    },
  });

  useEffect(() => {
    if (showCreateForm) {
      setNewName('New workflow');
      setNewDescription('');
      setNewScope('campaign');
      setNewTriggerType('onCampaignStarted');
    }
  }, [showCreateForm]);

  const createMutation = useMutation({
    mutationFn: async (input: CreateWorkflowInput) => {
      const me = await api.auth.getMe();
      const userId = me?.id as string;
      if (!userId) throw new Error('User not authenticated');
      return api.workflows.create({
        name: input.name || 'New workflow',
        description: input.description || null,
        status: 'draft',
        scope: input.scope,
        trigger: { type: input.triggerType },
        nodes: [],
        edges: [],
      } as any);
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
      setShowCreateForm(false);
      if (created?.id) router.push(`/workflows/${created.id}/edit`);
    },
  });

  const updateBasicMutation = useMutation({
    mutationFn: async (payload: { id: string; name: string; description: string; scope: Workflow['scope']; triggerType: string }) => {
      return api.workflows.update(payload.id, {
        name: payload.name || 'New workflow',
        description: payload.description || null,
        scope: payload.scope,
        trigger: { type: payload.triggerType },
      } as any);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
      setEditingWorkflow(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (workflowId: string) => {
      await api.workflows.delete(workflowId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
      setDeleteConfirmId(null);
    },
  });

  const workflows = data?.workflows ?? [];

  return (
    <div className="min-h-screen bg-slate-50 ">
      <div className="max-w-6xl mx-auto px-6 py-10 space-y-8">

        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              {/* Geometric flow/nodes icon */}
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary shadow-sm">
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="10" cy="3.5" r="2" fill="white" />
                  <circle cx="4" cy="15.5" r="2" fill="white" fillOpacity="0.75" />
                  <circle cx="16" cy="15.5" r="2" fill="white" fillOpacity="0.75" />
                  <line x1="8.9" y1="5.3" x2="5.1" y2="13.7" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeOpacity="0.9" />
                  <line x1="11.1" y1="5.3" x2="14.9" y2="13.7" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeOpacity="0.9" />
                </svg>
              </div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-900 ">
                Workflows
              </h1>
            </div>
            <p className="text-sm text-slate-500 pl-[42px]">
              Automate follow-up sequences triggered by campaign activity.
            </p>
          </div>

          <Button
            type="button"
            onClick={() => setShowCreateForm(true)}
            disabled={createMutation.isPending}
            className="shrink-0 h-9 gap-1.5 bg-primary hover:bg-primary text-white shadow-sm text-sm font-medium"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New workflow
          </Button>
        </div>

        {/* ── Stats strip (optional ambient context) ── */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Total workflows', value: isLoading ? '—' : workflows.length },
            { label: 'Active', value: isLoading ? '—' : workflows.filter((w: Workflow) => w.status === 'active').length },
            { label: 'Drafts', value: isLoading ? '—' : workflows.filter((w: Workflow) => w.status === 'draft').length },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm"
            >
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{stat.label}</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900 ">{stat.value}</p>
            </div>
          ))}
        </div>

        {/* ── Table card ── */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 ">
                {['Name', 'Status', 'Scope', 'Trigger', 'Last updated', ''].map((h) => (
                  <th
                    key={h}
                    className={`px-5 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400 ${h === '' || h === 'Last updated' ? 'text-right' : 'text-left'}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 ">

              {isLoading && (
                [...Array(4)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {[...Array(6)].map((_, j) => (
                      <td key={j} className="px-5 py-4">
                        <div className="h-3.5 rounded bg-slate-100 " style={{ width: j === 0 ? '60%' : j === 5 ? '48px' : '40%' }} />
                      </td>
                    ))}
                  </tr>
                ))
              )}

              {!isLoading && workflows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-16 text-center">
                    <div className="mx-auto flex flex-col items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
                        <svg className="h-6 w-6" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <circle cx="10" cy="3.5" r="2" fill="#94a3b8" />
                          <circle cx="4" cy="15.5" r="2" fill="#94a3b8" fillOpacity="0.6" />
                          <circle cx="16" cy="15.5" r="2" fill="#94a3b8" fillOpacity="0.6" />
                          <line x1="8.9" y1="5.3" x2="5.1" y2="13.7" stroke="#94a3b8" strokeWidth="1.4" strokeLinecap="round" strokeOpacity="0.8" />
                          <line x1="11.1" y1="5.3" x2="14.9" y2="13.7" stroke="#94a3b8" strokeWidth="1.4" strokeLinecap="round" strokeOpacity="0.8" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-700 ">No workflows yet</p>
                        <p className="mt-0.5 text-xs text-slate-400">Create your first workflow to start automating follow-ups.</p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => setShowCreateForm(true)}
                        className="mt-1 h-8 text-xs bg-primary hover:bg-primary text-white"
                      >
                        New workflow
                      </Button>
                    </div>
                  </td>
                </tr>
              )}

              {workflows.map((wf: Workflow) => (
                <tr
                  key={wf.id}
                  className="group hover:bg-slate-50 transition-colors duration-100"
                >
                  {/* Name + description */}
                  <td className="px-5 py-3.5 max-w-xs">
                    <Link
                      href={`/workflows/${wf.id}/edit`}
                      className="font-medium text-slate-800 hover:text-primary transition-colors"
                    >
                      {wf.name}
                    </Link>
                    {wf.description && (
                      <p className="mt-0.5 text-xs text-slate-400 truncate max-w-[220px]">
                        {wf.description}
                      </p>
                    )}
                  </td>

                  {/* Status badge */}
                  <td className="px-5 py-3.5">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[wf.status] ?? STATUS_STYLES.draft}`}>
                      {wf.status === 'active' && (
                        <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />
                      )}
                      {wf.status}
                    </span>
                  </td>

                  {/* Scope */}
                  <td className="px-5 py-3.5">
                    <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 capitalize">
                      <span>{SCOPE_ICON[wf.scope] ?? '📌'}</span>
                      {wf.scope}
                    </span>
                  </td>

                  {/* Trigger */}
                  <td className="px-5 py-3.5">
                    <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-mono text-slate-500 ">
                      {TRIGGER_LABELS[wf.trigger?.type ?? ''] ?? wf.trigger?.type ?? '—'}
                    </span>
                  </td>

                  {/* Updated */}
                  <td className="px-5 py-3.5 text-right text-xs text-slate-400 whitespace-nowrap">
                    {formatDate(wf.updated_at ?? wf.created_at)}
                  </td>

                  {/* Actions */}
                  <td className="px-5 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingWorkflow(wf);
                          setEditName(wf.name || '');
                          setEditDescription(wf.description || '');
                          setEditScope(wf.scope);
                          setEditTriggerType(wf.trigger?.type || 'onCampaignStarted');
                        }}
                        className="inline-flex items-center rounded-md px-2.5 py-1 text-[11px] font-medium text-slate-600 border border-slate-200 hover:border-primary/30 hover:text-primary transition-colors bg-white "
                      >
                        Edit details
                      </button>
                      <Link
                        href={`/workflows/${wf.id}/edit`}
                        className="inline-flex items-center rounded-md px-2 py-1 text-[11px] font-medium text-slate-500 border border-transparent hover:border-slate-200 hover:bg-slate-50 transition-colors"
                      >
                        Open flow
                      </Link>
                      <button
                        type="button"
                        onClick={() => setDeleteConfirmId(wf.id)}
                        className="inline-flex items-center rounded-md px-2.5 py-1 text-[11px] font-medium text-red-500 border border-transparent hover:border-red-200 hover:bg-red-50 transition-colors"
                        disabled={deleteMutation.isPending}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Create Dialog ── */}
      <Dialog open={showCreateForm} onOpenChange={setShowCreateForm}>
        <DialogContent className="sm:max-w-[480px] p-0 gap-0 overflow-hidden rounded-2xl border-slate-200 shadow-xl">
          <div className="px-6 pt-6 pb-5 border-b border-slate-100 ">
            <div className="flex items-center gap-3 mb-1">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary shadow-sm shrink-0">
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="10" cy="3.5" r="2" fill="white" />
                  <circle cx="4" cy="15.5" r="2" fill="white" fillOpacity="0.75" />
                  <circle cx="16" cy="15.5" r="2" fill="white" fillOpacity="0.75" />
                  <line x1="8.9" y1="5.3" x2="5.1" y2="13.7" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeOpacity="0.9" />
                  <line x1="11.1" y1="5.3" x2="14.9" y2="13.7" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeOpacity="0.9" />
                </svg>
              </div>
              <div>
                <DialogTitle className="text-base font-semibold text-slate-900 leading-tight">
                  Create workflow
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500 mt-0">
                  You can edit the flow after creating it.
                </DialogDescription>
              </div>
            </div>
          </div>

          <div className="px-6 py-5 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="workflow-name" className="text-xs font-medium text-slate-700 ">
                Name
              </Label>
              <Input
                id="workflow-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Welcome sequence for Campaign X"
                className="h-9 text-sm border-slate-200 focus-visible:ring-primary"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="workflow-description" className="text-xs font-medium text-slate-700 ">
                Description
                <span className="ml-1 font-normal text-slate-400">(optional)</span>
              </Label>
              <Input
                id="workflow-description"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Short note about what this workflow does"
                className="h-9 text-sm border-slate-200 focus-visible:ring-primary"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="workflow-scope" className="text-xs font-medium text-slate-700 ">
                  Scope
                </Label>
                <select
                  id="workflow-scope"
                  className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm text-slate-800 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  value={newScope}
                  onChange={(e) => setNewScope(e.target.value as Workflow['scope'])}
                >
                  <option value="campaign">Campaign</option>
                  <option value="list">List</option>
                  <option value="contact">Contact</option>
                  <option value="global">Global</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="workflow-trigger" className="text-xs font-medium text-slate-700 ">
                  Trigger
                </Label>
                <select
                  id="workflow-trigger"
                  className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm text-slate-800 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  value={newTriggerType}
                  onChange={(e) => setNewTriggerType(e.target.value)}
                >
                  <option value="onCampaignStarted">Campaign started</option>
                  <option value="onEmailSent">Email sent</option>
                  <option value="onEmailOpened">Email opened</option>
                  <option value="onEmailReplied">Email replied</option>
                </select>
              </div>
            </div>
          </div>

          <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowCreateForm(false)}
              disabled={createMutation.isPending}
              className="h-9 text-sm border-slate-200 "
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={createMutation.isPending}
              onClick={() =>
                createMutation.mutate({
                  name: newName.trim() || 'New workflow',
                  description: newDescription.trim(),
                  scope: newScope,
                  triggerType: newTriggerType,
                })
              }
              className="h-9 text-sm bg-primary hover:bg-primary text-white gap-1.5"
            >
              {createMutation.isPending ? (
                <>
                  <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Creating…
                </>
              ) : (
                <>
                  Create &amp; edit
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Edit basic details dialog ── */}
      <Dialog open={!!editingWorkflow} onOpenChange={(open) => !updateBasicMutation.isPending && setEditingWorkflow(open ? editingWorkflow : null)}>
        <DialogContent className="sm:max-w-[480px] p-0 gap-0 overflow-hidden rounded-2xl border-slate-200 shadow-xl">
          <div className="px-6 pt-6 pb-5 border-b border-slate-100 ">
            <div className="flex items-center gap-3 mb-1">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary shadow-sm shrink-0">
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="10" cy="3.5" r="2" fill="white" />
                  <circle cx="4" cy="15.5" r="2" fill="white" fillOpacity="0.75" />
                  <circle cx="16" cy="15.5" r="2" fill="white" fillOpacity="0.75" />
                  <line x1="8.9" y1="5.3" x2="5.1" y2="13.7" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeOpacity="0.9" />
                  <line x1="11.1" y1="5.3" x2="14.9" y2="13.7" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeOpacity="0.9" />
                </svg>
              </div>
              <div>
                <DialogTitle className="text-base font-semibold text-slate-900 leading-tight">
                  Edit workflow details
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500 mt-0">
                  Update the name, description, scope, or trigger. This does not change the existing flow graph.
                </DialogDescription>
              </div>
            </div>
          </div>

          <div className="px-6 py-5 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-workflow-name" className="text-xs font-medium text-slate-700 ">
                Name
              </Label>
              <Input
                id="edit-workflow-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Welcome sequence for Campaign X"
                className="h-9 text-sm border-slate-200 focus-visible:ring-primary"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-workflow-description" className="text-xs font-medium text-slate-700 ">
                Description
                <span className="ml-1 font-normal text-slate-400">(optional)</span>
              </Label>
              <Input
                id="edit-workflow-description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Short note about what this workflow does"
                className="h-9 text-sm border-slate-200 focus-visible:ring-primary"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-workflow-scope" className="text-xs font-medium text-slate-700 ">
                  Scope
                </Label>
                <select
                  id="edit-workflow-scope"
                  className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm text-slate-800 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  value={editScope}
                  onChange={(e) => setEditScope(e.target.value as Workflow['scope'])}
                >
                  <option value="campaign">Campaign</option>
                  <option value="list">List</option>
                  <option value="contact">Contact</option>
                  <option value="global">Global</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-workflow-trigger" className="text-xs font-medium text-slate-700 ">
                  Trigger
                </Label>
                <select
                  id="edit-workflow-trigger"
                  className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm text-slate-800 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  value={editTriggerType}
                  onChange={(e) => setEditTriggerType(e.target.value)}
                >
                  <option value="onCampaignStarted">Campaign started</option>
                  <option value="onEmailSent">Email sent</option>
                  <option value="onEmailOpened">Email opened</option>
                  <option value="onEmailReplied">Email replied</option>
                </select>
              </div>
            </div>
          </div>

          <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => !updateBasicMutation.isPending && setEditingWorkflow(null)}
              disabled={updateBasicMutation.isPending}
              className="h-9 text-sm border-slate-200 "
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={updateBasicMutation.isPending || !editingWorkflow}
              onClick={() =>
                editingWorkflow &&
                updateBasicMutation.mutate({
                  id: editingWorkflow.id,
                  name: editName.trim() || 'New workflow',
                  description: editDescription.trim(),
                  scope: editScope,
                  triggerType: editTriggerType,
                })
              }
              className="h-9 text-sm bg-primary hover:bg-primary text-white gap-1.5"
            >
              {updateBasicMutation.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation dialog ── */}
      <Dialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent className="sm:max-w-sm rounded-2xl border-slate-200 shadow-xl">
          <DialogHeader>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 mb-1">
              <svg className="h-5 w-5 text-red-600 " fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            <DialogTitle className="text-base font-semibold text-slate-900 ">
              Delete workflow?
            </DialogTitle>
            <DialogDescription className="text-sm text-slate-500">
              This action is permanent and cannot be undone. All nodes and edges will be removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteConfirmId(null)}
              className="h-9 text-sm border-slate-200 "
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={deleteMutation.isPending}
              onClick={() => deleteConfirmId && deleteMutation.mutate(deleteConfirmId)}
              className="h-9 text-sm bg-red-600 hover:bg-red-700 text-white"
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete workflow'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}