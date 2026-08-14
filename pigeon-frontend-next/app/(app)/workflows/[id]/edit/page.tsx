'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  Workflow,
  WorkflowNode,
  WorkflowEdge,
  WorkflowRun,
  WorkflowRunStep,
  Campaign,
  Contact,
  ContactList,
} from '@/types/api';
import { WorkflowCanvas } from '@/components/workflows/WorkflowCanvas';
import { useTemplates } from '@/hooks/useTemplates';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

type CanvasNode = WorkflowNode;

function createDefaultTrigger(): Workflow['trigger'] {
  return { type: 'onCampaignStarted' };
}

const NODE_TYPES: { type: string; label: string; description: string; icon: string; color: string; defaultConfig?: any }[] = [
  {
    type: 'Start',
    label: 'Start',
    description: 'Entry point from the workflow trigger.',
    icon: '▶',
    color: '#22c55e',
    defaultConfig: {},
  },
  {
    type: 'SendEmail',
    label: 'Send Email',
    description: 'Send an email using a template.',
    icon: '✉',
    color: '#c2410c',
    defaultConfig: { template_id: '', campaign_id: undefined, contact_id: undefined },
  },
  {
    type: 'WaitFor',
    label: 'Wait',
    description: 'Delay before the next step.',
    icon: '⏱',
    color: '#ea580c',
    defaultConfig: { mode: 'duration', duration_days: 1, duration_hours: 0 },
  },
  {
    type: 'IfCondition',
    label: 'If Condition',
    description: 'Branch on contact status.',
    icon: '⑂',
    color: '#f59e0b',
    defaultConfig: { status_equals: 'replied' },
  },
  {
    type: 'AddToList',
    label: 'Add to List',
    description: 'Add contact to a list.',
    icon: '+',
    color: '#10b981',
    defaultConfig: { list_id: '' },
  },
  {
    type: 'RemoveFromList',
    label: 'Remove from List',
    description: 'Remove contact from a list.',
    icon: '−',
    color: '#ef4444',
    defaultConfig: { list_id: '', all_lists_for_campaign: false },
  },
  {
    type: 'UpdateContactStatus',
    label: 'Update Status',
    description: 'Set a new contact status.',
    icon: '↑',
    color: '#ea580c',
    defaultConfig: { status: 'opened' },
  },
  {
    type: 'SendWebhook',
    label: 'Send Webhook',
    description: 'POST contact + status + event to a URL.',
    icon: '⇪',
    color: '#ea580c',
    defaultConfig: { url: '' },
  },
  {
    type: 'End',
    label: 'End',
    description: 'Mark the workflow as completed.',
    icon: '■',
    color: '#6b7280',
    defaultConfig: {},
  },
];

export default function EditWorkflowPage() {
  const params = useParams();
  const workflowId = (params?.id as string) ?? '';
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['workflow', workflowId],
    enabled: !!workflowId,
    queryFn: async () => api.workflows.get(workflowId),
  });

  const { data: runsData } = useQuery({
    queryKey: ['workflow-runs', workflowId],
    enabled: !!workflowId,
    queryFn: async () => api.workflows.listRuns(workflowId),
    refetchInterval: 15000,
  });

  const [draft, setDraft] = useState<Workflow | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [sidebarTab, setSidebarTab] = useState<'nodes' | 'runs'>('nodes');
  const [showTestDialog, setShowTestDialog] = useState(false);
  const [testCampaignId, setTestCampaignId] = useState<string>('');
  const [testContactId, setTestContactId] = useState<string>('');
  const [testListId, setTestListId] = useState<string>('');

  useEffect(() => {
    if (data) {
      setDraft(data);
      if (!data.trigger) {
        setDraft({ ...data, trigger: createDefaultTrigger() });
      }
    }
  }, [data]);

  const workflowUserId = draft?.user_id ?? '';

  const { data: testCampaigns = [] } = useQuery<Campaign[]>({
    queryKey: ['workflow-test-campaigns', workflowUserId],
    enabled: !!workflowUserId,
    queryFn: async () => api.campaigns.list(workflowUserId, { archived: false }),
  });

  const { data: testContactsPage } = useQuery<{ contacts: Contact[]; total: number }>({
    queryKey: ['workflow-test-contacts', workflowUserId],
    enabled: !!workflowUserId,
    queryFn: async () => api.contacts.list(workflowUserId, 0, 200),
  });
  const testContacts = testContactsPage?.contacts ?? [];

  const { data: testLists = [] } = useQuery<ContactList[]>({
    queryKey: ['workflow-test-contact-lists', workflowUserId],
    enabled: !!workflowUserId,
    queryFn: async () => api.contactLists.list(workflowUserId),
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: Partial<Workflow>) => api.workflows.update(workflowId, payload),
    onSuccess: (updated) => {
      setDraft(updated);
      queryClient.invalidateQueries({ queryKey: ['workflow', workflowId] });
    },
  });

  const activateMutation = useMutation({
    mutationFn: async () => api.workflows.activate(workflowId),
    onSuccess: (updated) => {
      setDraft(updated);
      queryClient.invalidateQueries({ queryKey: ['workflow', workflowId] });
    },
  });

  const pauseMutation = useMutation({
    mutationFn: async () => api.workflows.pause(workflowId),
    onSuccess: (updated) => {
      setDraft(updated);
      queryClient.invalidateQueries({ queryKey: ['workflow', workflowId] });
    },
  });

  const testRunMutation = useMutation({
    mutationFn: async (triggerContext: Record<string, unknown>) =>
      api.workflows.test(workflowId, triggerContext),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['workflow-runs', workflowId] });
      if (result?.run?.id) {
        setSelectedRunId(result.run.id);
      }
      if (result?.steps && result.steps.length > 0 && result.run?.id) {
        const orderedSteps = [...result.steps].sort(
          (a, b) =>
            new Date(a.started_at as any).getTime() -
            new Date(b.started_at as any).getTime(),
        );
        setLiveRunId(result.run.id);
        setLiveSteps([]);
        let index = 0;

        const playNext = () => {
          setLiveSteps((prev) => [...prev, orderedSteps[index]]);
          index += 1;
          if (index < orderedSteps.length) {
            setTimeout(playNext, 400);
          } else {
            // After playback, clear live state so we fall back to API data.
            setTimeout(() => {
              setLiveRunId(null);
              setLiveSteps([]);
              queryClient.invalidateQueries({ queryKey: ['workflow-run-steps', result.run.id] });
            }, 400);
          }
        };

        playNext();
      }
      setShowTestDialog(false);
    },
  });

  const stopRunMutation = useMutation({
    mutationFn: async (runId: string) => api.workflows.stopRun(runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-runs', workflowId] });
      if (activeRunId) {
        queryClient.invalidateQueries({ queryKey: ['workflow-run-steps', activeRunId] });
      }
    },
  });

  const nodes: CanvasNode[] = draft?.nodes ?? [];
  const edges: WorkflowEdge[] = draft?.edges ?? [];
  const selectedNode: CanvasNode | undefined = nodes.find((n) => n.id === selectedNodeId);
  const runs: WorkflowRun[] = runsData?.runs ?? [];
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [nodeMenu, setNodeMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);

  const activeRunId = selectedRunId ?? runs[0]?.id ?? null;

  const { data: activeRunWithSteps } = useQuery({
    queryKey: ['workflow-run-steps', activeRunId],
    enabled: !!activeRunId,
    queryFn: async () => api.workflows.getRunWithSteps(activeRunId as string),
  });

  const activeRunSteps: WorkflowRunStep[] = activeRunWithSteps?.steps ?? [];
  const activeRun = activeRunWithSteps?.run;
  const firstErrorStep = activeRunSteps.find((step) => step.status === 'failed' && (step as any).error);

  const [liveSteps, setLiveSteps] = useState<WorkflowRunStep[]>([]);
  const [liveRunId, setLiveRunId] = useState<string | null>(null);

  // When a different run is selected, stop any live playback.
  useEffect(() => {
    if (activeRunId && liveRunId && activeRunId !== liveRunId) {
      setLiveRunId(null);
      setLiveSteps([]);
    }
  }, [activeRunId, liveRunId]);

  useEffect(() => {
    if (!selectedNodeId) setNodeMenu(null);
  }, [selectedNodeId]);

  function handleUpdate(partial: Partial<Workflow>) {
    if (!draft) return;
    const next: Workflow = { ...draft, ...partial } as Workflow;
    setDraft(next);
    updateMutation.mutate({
      name: next.name,
      description: next.description,
      status: next.status,
      scope: next.scope,
      trigger: next.trigger ?? createDefaultTrigger(),
      nodes: next.nodes ?? [],
      edges: next.edges ?? [],
    } as any);
  }

  function handleAddNode(type: string) {
    if (!draft) return;
    if (type === 'Start') {
      const existingStart = (draft.nodes ?? []).find((n) => n.type === 'Start');
      if (existingStart) {
        setSelectedNodeId(existingStart.id);
        return;
      }
    }
    const def = NODE_TYPES.find((n) => n.type === type);
    const id = crypto.randomUUID();
    const baseX = 80 + (draft.nodes?.length ?? 0) * 40;
    const baseY = 80 + (draft.nodes?.length ?? 0) * 20;
    const newNode: CanvasNode = {
      id,
      type,
      config: def?.defaultConfig ?? {},
      label: def?.label ?? type,
      position_x: baseX,
      position_y: baseY,
    };
    const newNodes = [...(draft.nodes ?? []), newNode];
    // Do not auto-connect to any existing node; let the user draw connections manually.
    const newEdges = [...(draft.edges ?? [])];
    handleUpdate({ nodes: newNodes, edges: newEdges });
    setSelectedNodeId(newNode.id);
  }

  function handleNodeConfigChange(nodeId: string, config: Record<string, any>) {
    if (!draft) return;
    handleUpdate({ nodes: (draft.nodes ?? []).map((n) => n.id === nodeId ? { ...n, config } : n) });
  }

  function handleNodeLabelChange(nodeId: string, label: string) {
    if (!draft) return;
    handleUpdate({ nodes: (draft.nodes ?? []).map((n) => n.id === nodeId ? { ...n, label } : n) });
  }

  function handleDeleteNode(nodeId: string) {
    if (!draft) return;
    const newNodes = (draft.nodes ?? []).filter((n) => n.id !== nodeId);
    const newEdges = (draft.edges ?? []).filter((e) => e.source_node_id !== nodeId && e.target_node_id !== nodeId);
    handleUpdate({ nodes: newNodes, edges: newEdges });
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
  }

  function handleDuplicateNode(nodeId: string) {
    if (!draft) return;
    const existing = (draft.nodes ?? []).find((n) => n.id === nodeId);
    if (!existing) return;
    const id = crypto.randomUUID();
    const newNode: CanvasNode = { ...existing, id, position_x: (existing.position_x ?? 80) + 40, position_y: (existing.position_y ?? 80) + 40 };
    handleUpdate({ nodes: [...(draft.nodes ?? []), newNode], edges: draft.edges ?? [] });
    setSelectedNodeId(id);
  }

  function handleDetachNode(nodeId: string) {
    if (!draft) return;
    handleUpdate({ nodes: draft.nodes ?? [], edges: (draft.edges ?? []).filter((e) => e.source_node_id !== nodeId && e.target_node_id !== nodeId) });
  }

  function handleGraphChange(nextNodes: WorkflowNode[], nextEdges: WorkflowEdge[]) {
    if (!draft) return;
    handleUpdate({ nodes: nextNodes, edges: nextEdges });
  }

  const lastRun = runs[0];
  const runStatusLabel = useMemo(() => {
    if (!lastRun) return 'No runs yet';
    return `Last run ${new Date(lastRun.started_at).toLocaleString()}`;
  }, [lastRun]);

  const statusConfig = {
    active: { label: 'Active', bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500', ring: 'ring-emerald-200' },
    paused: { label: 'Paused', bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500', ring: 'ring-amber-200' },
    draft: { label: 'Draft', bg: 'bg-slate-50', text: 'text-slate-600', dot: 'bg-slate-400', ring: 'ring-slate-200' },
  };
  const currentStatus = statusConfig[draft?.status as keyof typeof statusConfig] ?? statusConfig.draft;

  const runStatusColor = (status: string) => {
    if (status === 'completed') return 'text-emerald-600 bg-emerald-50';
    if (status === 'running') return 'text-primary bg-primary/10';
    if (status === 'failed') return 'text-red-600 bg-red-50';
    if (status === 'cancelled') return 'text-slate-600 bg-slate-100';
    return 'text-slate-600 bg-slate-50';
  };

  if (!workflowId) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="rounded-xl border border-red-100 bg-red-50 px-6 py-4 text-sm text-red-600">Missing workflow ID.</div>
      </div>
    );
  }

  if (isLoading || !draft) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-blue-500" />
        <p className="text-sm text-slate-400">Loading workflow…</p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col bg-[#f8f9fb] font-sans" style={{ fontFamily: "'DM Sans', 'Inter', system-ui, sans-serif" }}>

      {/* ── Top Bar ─────────────────────────────────────────────── */}
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3 shadow-sm">
        <div className="flex items-center gap-4">
          {/* Editable title */}
          <div className="flex flex-col gap-0.5">
            <input
              className="w-72 border-none bg-transparent text-lg font-semibold text-slate-800 outline-none placeholder:text-slate-300 focus:ring-0"
              value={draft.name}
              placeholder="Untitled Workflow"
              onChange={(e) => handleUpdate({ name: e.target.value })}
            />
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span>{runStatusLabel}</span>
              <span>·</span>
              <span>{nodes.length} node{nodes.length !== 1 ? 's' : ''}</span>
            </div>
          </div>

          {/* Status badge */}
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${currentStatus.bg} ${currentStatus.text} ${currentStatus.ring}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${currentStatus.dot} ${draft.status === 'active' ? 'animate-pulse' : ''}`} />
            {currentStatus.label}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {updateMutation.isPending && (
            <span className="flex items-center gap-1.5 text-xs text-slate-400">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border border-slate-200 border-t-slate-400" />
              Saving…
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowTestDialog(true)}
            disabled={testRunMutation.isPending}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:bg-slate-50 hover:border-slate-300 disabled:opacity-60 active:scale-[0.98]"
          >
            {testRunMutation.isPending ? 'Testing…' : 'Test run'}
          </button>
          {draft.status !== 'active' ? (
            <button
              type="button"
              onClick={() => activateMutation.mutate()}
              disabled={activateMutation.isPending}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-primary disabled:opacity-60 active:scale-[0.98]"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-white/80" />
              Activate
            </button>
          ) : (
            <button
              type="button"
              onClick={() => pauseMutation.mutate()}
              disabled={pauseMutation.isPending}
              className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-1.5 text-xs font-semibold text-amber-700 shadow-sm transition hover:bg-amber-100 disabled:opacity-60 active:scale-[0.98]"
            >
              ⏸ Pause
            </button>
          )}
        </div>
      </header>

      {/* ── Body ────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left Sidebar ──────────────────────────────────────── */}
        <aside className="flex w-64 flex-shrink-0 flex-col border-r border-slate-200 bg-white">
          {/* Tabs */}
          <div className="flex border-b border-slate-100">
            {(['nodes', 'runs'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setSidebarTab(tab)}
                className={`flex-1 py-2.5 text-xs font-semibold capitalize transition ${
                  sidebarTab === tab
                    ? 'border-b-2 border-primary text-primary'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {sidebarTab === 'nodes' && (
            <div className="flex-1 overflow-y-auto p-3">
              <p className="mb-2.5 px-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Drag to add
              </p>
              <div className="flex flex-col gap-1.5">
                {NODE_TYPES.map((n) => (
                  <button
                    key={n.type}
                    type="button"
                    onClick={() => handleAddNode(n.type)}
                    className="group flex items-start gap-3 rounded-xl border border-slate-100 bg-white px-3 py-2.5 text-left transition hover:border-slate-200 hover:bg-slate-50 hover:shadow-sm active:scale-[0.98]"
                  >
                    <span
                      className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white shadow-sm"
                      style={{ backgroundColor: n.color }}
                    >
                      {n.icon}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-700">{n.label}</p>
                      <p className="mt-0.5 text-[10px] leading-relaxed text-slate-400">{n.description}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {sidebarTab === 'runs' && (
            <div className="flex-1 overflow-y-auto p-3">
              <p className="mb-2.5 px-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Recent runs
              </p>
              {activeRun && (
                <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">Selected run</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${runStatusColor(activeRun.status)}`}>
                      {activeRun.status}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] text-slate-400">
                    Started {new Date(activeRun.started_at).toLocaleString()}
                    {activeRun.completed_at && ` · Ended ${new Date(activeRun.completed_at).toLocaleString()}`}
                  </p>
                  {firstErrorStep && (firstErrorStep as any).error && (
                    <p className="mt-1 rounded-md bg-red-50 px-2 py-1 text-[10px] font-medium text-red-600">
                      Error at node {firstErrorStep.node_id}: {(firstErrorStep as any).error}
                    </p>
                  )}
                </div>
              )}
              {runs.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                  <div className="text-2xl">▷</div>
                  <p className="text-xs text-slate-400">No runs yet.</p>
                  <p className="text-[10px] text-slate-300">Activate the workflow to start.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {runs.map((run) => {
                    const isActive = activeRunId === run.id;
                    return (
                      <div
                        key={run.id}
                        className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${
                          isActive
                            ? 'border-primary/20 bg-primary/10'
                            : 'border-slate-100 bg-white hover:bg-slate-50'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedRunId(run.id)}
                          className="w-full text-left"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${runStatusColor(run.status)}`}>
                              {run.status}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {new Date(run.started_at).toLocaleTimeString()}
                            </span>
                          </div>
                          <p className="mt-1 text-[10px] text-slate-400">
                            {new Date(run.started_at).toLocaleDateString()}
                          </p>
                        </button>
                        {run.status === 'running' && (
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <span className="text-[10px] text-slate-400">Running…</span>
                            <button
                              type="button"
                              className="rounded-lg border border-red-100 bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-600 transition hover:bg-red-100 active:scale-[0.98]"
                              onClick={() => stopRunMutation.mutate(run.id)}
                              disabled={stopRunMutation.isPending}
                            >
                              {stopRunMutation.isPending ? 'Stopping…' : 'Stop run'}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </aside>

        {/* ── Canvas ────────────────────────────────────────────── */}
        <div className="relative flex-1 overflow-hidden">
          {/* Subtle dot grid background */}
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: 'radial-gradient(circle, #cbd5e1 1px, transparent 1px)',
              backgroundSize: '24px 24px',
              backgroundPosition: '12px 12px',
            }}
          />

          <WorkflowCanvas
            nodes={nodes}
            edges={edges}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            onChangeGraph={handleGraphChange}
            runSteps={
              liveRunId && activeRun?.id === liveRunId ? liveSteps : activeRunSteps
            }
            onDeleteNode={handleDeleteNode}
            onNodeContextMenu={(nodeId, position) => {
              setSelectedNodeId(nodeId);
              setNodeMenu({ nodeId, x: position.x, y: position.y });
            }}
          />

          {/* Empty state */}
          {nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3">
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white/80 px-10 py-8 text-center shadow-sm backdrop-blur">
                <div className="mb-2 text-3xl">⬡</div>
                <p className="text-sm font-semibold text-slate-600">No nodes yet</p>
                <p className="mt-1 text-xs text-slate-400">Click a node type on the left to add it.</p>
              </div>
            </div>
          )}

          {/* Context menu */}
          {nodeMenu && selectedNode?.id === nodeMenu.nodeId && (
            <div
              className="fixed z-50 min-w-[160px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
              style={{ left: nodeMenu.x, top: nodeMenu.y }}
            >
              <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 border-b border-slate-100">
                Node actions
              </div>
              {[
                { label: 'Detach connections', icon: '⊝', action: () => { handleDetachNode(nodeMenu.nodeId); setNodeMenu(null); }, className: '' },
                { label: 'Duplicate', icon: '⊕', action: () => { handleDuplicateNode(nodeMenu.nodeId); setNodeMenu(null); }, className: '' },
                { label: 'Delete node', icon: '⊗', action: () => { handleDeleteNode(nodeMenu.nodeId); setNodeMenu(null); }, className: 'text-red-500 hover:bg-red-50' },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-medium transition hover:bg-slate-50 ${item.className}`}
                  onClick={item.action}
                >
                  <span className="text-base leading-none">{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </div>
          )}

          {/* ── Node Config Panel ──────────────────────────────── */}
          {selectedNode && (
            <div
              className="absolute bottom-6 right-6 z-40 w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
              style={{ boxShadow: '0 8px 40px 0 rgba(15,23,42,0.12)' }}
            >
              {/* Panel header */}
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <span
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-sm font-bold text-white shadow-sm"
                    style={{ backgroundColor: NODE_TYPES.find((n) => n.type === selectedNode.type)?.color ?? '#6b7280' }}
                  >
                    {NODE_TYPES.find((n) => n.type === selectedNode.type)?.icon ?? '·'}
                  </span>
                  <div>
                    <p className="text-xs font-semibold text-slate-700">Configure Node</p>
                    <p className="text-[10px] text-slate-400">{selectedNode.type}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedNodeId(null)}
                  className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-200 hover:text-slate-600"
                >
                  ✕
                </button>
              </div>

              <div className="p-4 space-y-4">
                {/* Display name */}
                <div>
                  <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    Display Name
                  </label>
                  <input
                    className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700 outline-none transition focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary"
                    value={selectedNode.label ?? selectedNode.type}
                    onChange={(e) => handleNodeLabelChange(selectedNode.id, e.target.value)}
                  />
                </div>

                {/* Config */}
                <NodeConfigPanel
                  node={selectedNode}
                  workflowUserId={draft.user_id}
                  onChange={(cfg) => handleNodeConfigChange(selectedNode.id, cfg)}
                />

                {/* Actions */}
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleDuplicateNode(selectedNode.id)}
                    className="flex-1 rounded-lg border border-slate-200 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50 active:scale-[0.98]"
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteNode(selectedNode.id)}
                    className="flex-1 rounded-lg border border-red-100 bg-red-50 py-1.5 text-[11px] font-semibold text-red-600 transition hover:bg-red-100 active:scale-[0.98]"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Active run indicator */}
          {activeRun && (
            <div className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-xl border border-primary/20 bg-white/90 px-3 py-2 text-xs shadow-sm backdrop-blur">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  activeRun.status === 'completed'
                    ? 'bg-emerald-500'
                    : activeRun.status === 'failed'
                      ? 'bg-red-500'
                      : activeRun.status === 'cancelled'
                        ? 'bg-slate-400'
                        : 'bg-primary animate-pulse'
                }`}
              />
              <span className="font-medium text-primary">Run</span>
              <span className="font-mono text-slate-400">{activeRun.id.slice(0, 8)}…</span>
              <span className="text-[10px] text-slate-400 capitalize">{activeRun.status}</span>
            </div>
          )}
        </div>
      </div>
      
      {/* ── Test run dialog ─────────────────────────────────────── */}
      <Dialog open={showTestDialog} onOpenChange={(open) => !testRunMutation.isPending && setShowTestDialog(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Test this workflow</DialogTitle>
            <DialogDescription>
              Choose which event context to use for the test run. The workflow will start from the <span className="font-semibold">Start</span> node and run
              using these IDs, just like a real trigger.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Trigger type</p>
              <p className="rounded-md bg-slate-50 px-3 py-2 text-xs font-mono text-slate-600">
                {draft.trigger?.type ?? 'onCampaignStarted'}
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-600">Campaign (optional)</label>
              <select
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
                value={testCampaignId}
                onChange={(e) => setTestCampaignId(e.target.value)}
              >
                <option value="">Use campaign from nodes / none</option>
                {testCampaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-600">Contact (for status, lists, etc.)</label>
              <select
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
                value={testContactId}
                onChange={(e) => setTestContactId(e.target.value)}
              >
                <option value="">Select a contact (recommended)</option>
                {testContacts.map((ct) => (
                  <option key={ct.id} value={ct.id}>
                    {ct.email}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-600">Contact list (optional)</label>
              <select
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
                value={testListId}
                onChange={(e) => setTestListId(e.target.value)}
              >
                <option value="">No specific list</option>
                {testLists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-[11px] text-slate-400">
              These IDs become the workflow&apos;s <code className="rounded bg-slate-100 px-1">trigger_context</code>, so nodes like <span className="font-semibold">Send Email</span>,{' '}
              <span className="font-semibold">If Condition</span>, <span className="font-semibold">Add to List</span>, and <span className="font-semibold">Send Webhook</span> can resolve the
              correct contact and campaign.
            </p>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              onClick={() => !testRunMutation.isPending && setShowTestDialog(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-primary disabled:cursor-not-allowed disabled:opacity-60"
              disabled={testRunMutation.isPending || !testContactId}
              onClick={() =>
                testRunMutation.mutate({
                  source: 'manual_test',
                  workflow_id: workflowId,
                  event_type: draft.trigger?.type ?? 'onCampaignStarted',
                  campaign_id: testCampaignId || undefined,
                  list_id: testListId || undefined,
                  contact_id: testContactId || undefined,
                })
              }
            >
              {testRunMutation.isPending ? 'Running…' : 'Run test'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/*  Node Config Panel                                         */
/* ────────────────────────────────────────────────────────── */

interface NodeConfigPanelProps {
  node: CanvasNode;
  workflowUserId?: string;
  onChange: (config: Record<string, any>) => void;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-slate-400">
      {children}
    </label>
  );
}

function FieldSelect({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <select
      className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700 outline-none transition focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {children}
    </select>
  );
}

function FieldInput({ value, onChange, placeholder, type = 'text', min, max }: { value: string | number; onChange: (v: string) => void; placeholder?: string; type?: string; min?: number; max?: number }) {
  return (
    <input
      type={type}
      min={min}
      max={max}
      className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700 outline-none transition focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function HintText({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] leading-relaxed text-slate-400">{children}</p>;
}

function NodeConfigPanel({ node, workflowUserId, onChange }: NodeConfigPanelProps) {
  const cfg = node.config ?? {};
  const userId = workflowUserId ?? '';
  const [showWebhookSample, setShowWebhookSample] = useState(false);
  const [webhookTestStatus, setWebhookTestStatus] = useState<string | null>(null);
  const { data: templates = [] } = useTemplates(userId);

  const { data: campaigns = [] } = useQuery<Campaign[]>({
    queryKey: ['workflow-campaigns', userId],
    enabled: !!userId,
    queryFn: async () => api.campaigns.list(userId, { archived: false }),
  });

  const { data: contactsPage } = useQuery<{ contacts: Contact[]; total: number }>({
    queryKey: ['workflow-contacts', userId],
    enabled: !!userId,
    queryFn: async () => api.contacts.list(userId, 0, 200),
  });
  const contacts = contactsPage?.contacts ?? [];

  const { data: contactLists = [] } = useQuery<ContactList[]>({
    queryKey: ['workflow-contact-lists', userId],
    enabled: !!userId,
    queryFn: async () => api.contactLists.list(userId),
  });

  const statusOptions = ['pending', 'sent', 'opened', 'clicked', 'replied', 'unsubscribed', 'blocked', 'verified'];

  if (node.type === 'SendEmail') {
    return (
      <div className="space-y-3">
        <div>
          <FieldLabel>Template</FieldLabel>
          <FieldSelect value={cfg.template_id ?? ''} onChange={(v) => onChange({ ...cfg, template_id: v || undefined })}>
            <option value="">Select a template…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name || t.subject || t.id}</option>
            ))}
          </FieldSelect>
          {userId && templates.length === 0 && (
            <HintText>No templates found. Create one in Templates first.</HintText>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <FieldLabel>Campaign</FieldLabel>
            <FieldSelect value={cfg.campaign_id ?? ''} onChange={(v) => onChange({ ...cfg, campaign_id: v || undefined })}>
              <option value="">Use workflow trigger campaign</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </FieldSelect>
          </div>
          <div>
            <FieldLabel>Contact</FieldLabel>
            <FieldSelect value={cfg.contact_id ?? ''} onChange={(v) => onChange({ ...cfg, contact_id: v || undefined })}>
              <option value="">Use contact from trigger</option>
              {contacts.map((ct) => (
                <option key={ct.id} value={ct.id}>{ct.email}</option>
              ))}
            </FieldSelect>
          </div>
        </div>
        <HintText>Campaign and contact default to the values from the workflow trigger event.</HintText>
      </div>
    );
  }

  if (node.type === 'SendWebhook') {
    return (
      <div className="space-y-3">
        <HintText>
          This node will POST the workflow event, contact details, status, and IDs (campaign, list, contact, email_log)
          to your URL when it runs. Use this to push updates into your own backend or CRM.
        </HintText>
        <button
          type="button"
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50 active:scale-[0.98]"
          onClick={() => setShowWebhookSample(true)}
        >
          Configure webhook & test
        </button>
        {webhookTestStatus && (
          <p className="text-[10px] text-slate-500">{webhookTestStatus}</p>
        )}

        <Dialog open={showWebhookSample} onOpenChange={setShowWebhookSample}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Configure webhook</DialogTitle>
              <DialogDescription>
                Enter the URL to receive workflow webhooks and see an example payload. You can also send a test request.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <FieldLabel>Webhook URL</FieldLabel>
                <FieldInput
                  value={cfg.url ?? ''}
                  onChange={(v) => onChange({ ...cfg, url: v })}
                  placeholder="https://your-app.com/api/pigeon-workflow-webhook"
                />
              </div>
              <div>
                <FieldLabel>Sample payload</FieldLabel>
                <pre className="max-h-64 overflow-auto rounded-md bg-slate-900/95 px-3 py-2 text-[10px] font-mono text-slate-100">
{`{
  "event": "email.sent",
  "workflow": {
    "id": "wf_123",
    "name": "Welcome sequence"
  },
  "workflow_run_id": "run_123",
  "node": {
    "id": "node_123",
    "type": "SendWebhook",
    "label": "Notify CRM"
  },
  "user_id": "user_123",
  "campaign": {
    "id": "camp_123",
    "name": "Outreach to warm leads"
  },
  "list": {
    "id": "list_123",
    "name": "Warm leads"
  },
  "contact_id": "contact_123",
  "email_log_id": "log_123",
  "status": "replied",
  "contact": {
    "id": "contact_123",
    "email": "lead@example.com",
    "first_name": "Jane",
    "last_name": "Doe",
    "company": "Acme Inc",
    "status": "replied"
  },
  "trigger_context": { /* original workflow trigger context */ }
}`}
                </pre>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-medium text-slate-600 transition hover:bg-slate-50 active:scale-[0.98]"
                  onClick={() => setShowWebhookSample(false)}
                >
                  Close & Save
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-primary px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-primary active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!cfg.url}
                  onClick={async () => {
                    if (!cfg.url || typeof window === 'undefined') return;
                    try {
                      setWebhookTestStatus('Sending test…');
                      const resp = await fetch(cfg.url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          event: 'email.sent',
                          workflow: {
                          id: 'wf_test',
                          name: 'Test workflow',
                          },
                          workflow_run_id: 'run_test',
                          node: {
                            id: node.id,
                            type: node.type,
                            label: node.label,
                          },
                          user_id: userId,
                          campaign: {
                            id: 'camp_test',
                            name: 'Example campaign',
                          },
                          list: {
                            id: 'list_test',
                            name: 'Example list',
                          },
                          contact_id: 'contact_test',
                          email_log_id: 'log_test',
                          status: 'sent',
                          contact: {
                            id: 'contact_test',
                            email: 'lead@example.com',
                            first_name: 'Jane',
                            last_name: 'Doe',
                            company: 'Acme Inc',
                            status: 'sent',
                          },
                          trigger_context: { source: 'workflow_test' },
                        }),
                      });
                      setWebhookTestStatus(`Test sent (HTTP ${resp.status})`);
                    } catch (err) {
                      setWebhookTestStatus('Test failed – see console for details');
                    }
                  }}
                >
                  Send test
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  if (node.type === 'WaitFor') {
    return (
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>Days</FieldLabel>
          <FieldInput
            type="number"
            min={0}
            value={cfg.duration_days ?? 1}
            onChange={(v) => onChange({ ...cfg, mode: 'duration', duration_days: Number(v) })}
          />
        </div>
        <div>
          <FieldLabel>Hours</FieldLabel>
          <FieldInput
            type="number"
            min={0}
            max={23}
            value={cfg.duration_hours ?? 0}
            onChange={(v) => onChange({ ...cfg, mode: 'duration', duration_hours: Number(v) })}
          />
        </div>
      </div>
    );
  }

  if (node.type === 'IfCondition') {
    return (
      <div className="space-y-2">
        <div>
          <FieldLabel>Contact status equals</FieldLabel>
          <FieldSelect value={cfg.status_equals ?? 'replied'} onChange={(v) => onChange({ ...cfg, status_equals: v })}>
            {['pending', 'sent', 'opened', 'clicked', 'replied', 'unsubscribed'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </FieldSelect>
        </div>
        <HintText>The "Yes" branch fires when this condition is met; "No" branch otherwise.</HintText>
      </div>
    );
  }

  if (node.type === 'AddToList') {
    return (
      <div className="space-y-2">
        <div>
          <FieldLabel>List</FieldLabel>
          <FieldSelect
            value={cfg.list_id ?? ''}
            onChange={(v) => onChange({ ...cfg, list_id: v })}
          >
            <option value="">Select a list…</option>
            {contactLists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name}
              </option>
            ))}
          </FieldSelect>
        </div>
        {userId && contactLists.length === 0 && (
          <HintText>No contact lists found. Create a list first in Contacts.</HintText>
        )}
        {userId && contactLists.length > 0 && (
          <HintText>
            Choose which contact list this step should add the contact to.
          </HintText>
        )}
      </div>
    );
  }

  if (node.type === 'RemoveFromList') {
    return (
      <div className="space-y-3">
        <div>
          <FieldLabel>List</FieldLabel>
          <FieldSelect
            value={cfg.list_id ?? ''}
            onChange={(v) => onChange({ ...cfg, list_id: v })}
          >
            <option value="">Select a list…</option>
            {contactLists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name}
              </option>
            ))}
          </FieldSelect>
        </div>
        {userId && contactLists.length === 0 && (
          <HintText>No contact lists found. Create a list first in Contacts.</HintText>
        )}
        <label className="flex cursor-pointer items-center gap-2.5">
          <div className={`relative h-4.5 w-8 rounded-full transition ${cfg.all_lists_for_campaign ? 'bg-primary' : 'bg-slate-200'}`}>
            <input
              type="checkbox"
              className="sr-only"
              checked={Boolean(cfg.all_lists_for_campaign)}
              onChange={(e) => onChange({ ...cfg, all_lists_for_campaign: e.target.checked })}
            />
            <span
              className={`absolute top-0.5 left-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${cfg.all_lists_for_campaign ? 'translate-x-3.5' : ''}`}
            />
          </div>
          <span className="text-[11px] text-slate-600">Remove from all campaign lists</span>
        </label>
      </div>
    );
  }

  if (node.type === 'UpdateContactStatus') {
    return (
      <div className="space-y-2">
        <div>
          <FieldLabel>New status</FieldLabel>
          <FieldSelect value={cfg.status ?? 'opened'} onChange={(v) => onChange({ ...cfg, status: v })}>
            {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </FieldSelect>
        </div>
        <HintText>Also updates the matching campaign contact when a campaign is in context.</HintText>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-center">
      <p className="text-[11px] text-slate-400">No additional configuration for this node.</p>
    </div>
  );
}