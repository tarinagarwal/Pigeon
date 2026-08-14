import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  Node,
  Edge,
  Connection,
  addEdge,
  useNodesState,
  useEdgesState,
  EdgeLabelRenderer,
  BaseEdge,
  getStraightPath,
  getBezierPath,
  MarkerType,
  Handle,
  Position,
} from 'reactflow';
import 'reactflow/dist/style.css';

import type { WorkflowNode, WorkflowEdge, WorkflowRunStep } from '@/types/api';

export interface WorkflowCanvasProps {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onChangeGraph: (nodes: WorkflowNode[], edges: WorkflowEdge[]) => void;
  runSteps?: WorkflowRunStep[];
  onNodeContextMenu?: (nodeId: string, position: { x: number; y: number }) => void;
  onDeleteNode?: (id: string) => void;
}

/* ─── Node type → visual config ──────────────────────────── */
const NODE_VISUAL: Record<string, { icon: string; color: string; bg: string; border: string }> = {
  Start:              { icon: '▶',  color: '#22c55e', bg: '#ecfdf3', border: '#bbf7d0' },
  SendEmail:           { icon: '✉',  color: '#3b82f6', bg: '#eff6ff', border: '#bfdbfe' },
  WaitFor:             { icon: '⏱',  color: '#8b5cf6', bg: '#f5f3ff', border: '#ddd6fe' },
  IfCondition:         { icon: '⑂',  color: '#f59e0b', bg: '#fffbeb', border: '#fde68a' },
  AddToList:           { icon: '+',  color: '#10b981', bg: '#ecfdf5', border: '#a7f3d0' },
  RemoveFromList:      { icon: '−',  color: '#ef4444', bg: '#fef2f2', border: '#fecaca' },
  UpdateContactStatus: { icon: '↑',  color: '#06b6d4', bg: '#ecfeff', border: '#a5f3fc' },
  SendWebhook:         { icon: '⇪',  color: '#0ea5e9', bg: '#f0f9ff', border: '#bae6fd' },
  End:                 { icon: '■',  color: '#6b7280', bg: '#f9fafb', border: '#e5e7eb' },
};

/* ─── Custom Node component ───────────────────────────────── */
function CustomNode({ data, selected }: { data: any; selected: boolean }) {
  const vis = NODE_VISUAL[data.type] ?? { icon: '·', color: '#6b7280', bg: '#f9fafb', border: '#e5e7eb' };
  const runStatus = data.runStatus as WorkflowRunStep['status'] | null;
  const isIfCondition = data.type === 'IfCondition';
  const isEnd = data.type === 'End';

  let ringColor = vis.border;
  let ringWidth = '1.5px';
  let statusDot = null;

  if (runStatus === 'completed') {
    ringColor = '#16a34a';
    ringWidth = '2px';
    statusDot = <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-emerald-500 border-2 border-white shadow-sm" />;
  } else if (runStatus === 'running') {
    ringColor = '#2563eb';
    ringWidth = '2px';
    statusDot = <span className="absolute -top-1 -right-1 h-3 w-3 animate-pulse rounded-full bg-primary border-2 border-white shadow-sm" />;
  } else if (runStatus === 'failed') {
    ringColor = '#dc2626';
    ringWidth = '2px';
    statusDot = <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-red-500 border-2 border-white shadow-sm" />;
  } else if (runStatus === 'skipped') {
    ringColor = '#9ca3af';
  }

  if (selected) {
    ringColor = vis.color;
    ringWidth = '2px';
  }

  return (
    <div className="relative">
      {/* Incoming handle (top) */}
      <Handle
        type="target"
        position={Position.Top}
        className="!h-5 !w-5 !bg-white !border-2 !border-slate-300 !rounded-full hover:!border-primary hover:!bg-primary/10"
        style={{
          top: -12,
          boxShadow: '0 0 0 6px rgba(148, 163, 184, 0.25)', // soft outer catch radius
        }}
      />

      {/* Outgoing handle(s) (bottom) */}
      {!isEnd && (
        isIfCondition ? (
          <>
            <Handle
              id="yes"
              type="source"
              position={Position.Bottom}
              className="!h-5 !w-5 !bg-white !border-2 !border-slate-300 !rounded-full hover:!border-emerald-500 hover:!bg-emerald-50"
              style={{
                bottom: -12,
                left: '24%',
                boxShadow: '0 0 0 6px rgba(16, 185, 129, 0.2)', // greenish outer radius
              }}
            />
            <Handle
              id="no"
              type="source"
              position={Position.Bottom}
              className="!h-5 !w-5 !bg-white !border-2 !border-slate-300 !rounded-full hover:!border-red-500 hover:!bg-red-50"
              style={{
                bottom: -12,
                left: '76%',
                boxShadow: '0 0 0 6px rgba(248, 113, 113, 0.2)', // reddish outer radius
              }}
            />
          </>
        ) : (
          <Handle
            type="source"
            position={Position.Bottom}
            className="!h-5 !w-5 !bg-white !border-2 !border-slate-300 !rounded-full hover:!border-primary hover:!bg-primary/10"
            style={{
              bottom: -12,
              boxShadow: '0 0 0 6px rgba(59, 130, 246, 0.2)', // blue outer radius
            }}
          />
        )
      )}

      <div
        className="relative flex min-w-[160px] items-center gap-2.5 rounded-xl bg-white px-3 py-2.5 transition-all"
        style={{
          border: `${ringWidth} solid ${ringColor}`,
          boxShadow: selected
            ? `0 0 0 3px ${vis.color}22, 0 4px 16px 0 rgba(0,0,0,0.10)`
            : '0 2px 8px 0 rgba(0,0,0,0.07)',
          opacity: runStatus === 'skipped' ? 0.55 : 1,
          background: runStatus ? (
            runStatus === 'completed' ? '#f0fdf4' :
            runStatus === 'running'   ? '#eff6ff' :
            runStatus === 'failed'    ? '#fef2f2' : 'white'
          ) : 'white',
        }}
      >
        {statusDot}
        <span
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white shadow-sm"
          style={{ backgroundColor: vis.color }}
        >
          {vis.icon}
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-slate-700">{data.label}</p>
          <p className="text-[10px] text-slate-400">{data.type}</p>
        </div>
      </div>
    </div>
  );
}

const nodeTypes = { custom: CustomNode };

/* ─── Custom Edge component ───────────────────────────────── */
function CustomEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, label, selected, data,
}: any) {
  const [edgePath, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: selected ? '#3b82f6' : '#cbd5e1',
          strokeWidth: selected ? 2 : 1.5,
          strokeDasharray: selected ? undefined : undefined,
        }}
        markerEnd={`url(#arrow-${selected ? 'selected' : 'default'})`}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan"
          >
            <span
              className="rounded-full border px-2 py-0.5 text-[10px] font-semibold shadow-sm"
              style={{
                background: label === 'Yes' ? '#ecfdf5' : label === 'No' ? '#fef2f2' : 'white',
                borderColor: label === 'Yes' ? '#a7f3d0' : label === 'No' ? '#fecaca' : '#e2e8f0',
                color: label === 'Yes' ? '#16a34a' : label === 'No' ? '#dc2626' : '#64748b',
              }}
            >
              {label as string}
            </span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const edgeTypes = { custom: CustomEdge };

/* ─── Helpers ─────────────────────────────────────────────── */
function buildStatusByNodeId(steps: WorkflowRunStep[] | undefined): Map<string, WorkflowRunStep['status']> {
  const map = new Map<string, WorkflowRunStep['status']>();
  if (!steps) return map;
  for (const step of steps) map.set(step.node_id, step.status);
  return map;
}

function workflowNodesToReactFlowNodes(nodes: WorkflowNode[], statusByNodeId?: Map<string, WorkflowRunStep['status']>): Node[] {
  return nodes.map((n) => ({
    id: n.id,
    type: 'custom',
    position: { x: n.position_x ?? 80, y: n.position_y ?? 80 },
    data: {
      label: n.label ?? n.type,
      type: n.type,
      config: n.config ?? {},
      runStatus: statusByNodeId?.get(n.id) ?? null,
    },
  }));
}

function workflowEdgesToReactFlowEdges(edges: WorkflowEdge[]): Edge[] {
  const usedIds = new Set<string>();

  return edges.map((e, index) => {
    let edgeId = e.id || `edge-${index}`;
    if (usedIds.has(edgeId)) {
      edgeId = `${edgeId}__${index}`;
    }
    usedIds.add(edgeId);

    const label = e.label ?? undefined;

    return {
      id: edgeId,
      source: e.source_node_id,
      target: e.target_node_id,
      label,
      // Make IfCondition branches visually come from separate handles
      sourceHandle: label === 'Yes' ? 'yes' : label === 'No' ? 'no' : undefined,
      type: 'custom',
      markerEnd: { type: MarkerType.ArrowClosed, color: '#cbd5e1' },
    };
  });
}

function reactFlowNodesToWorkflowNodes(nodes: Node[], previous: WorkflowNode[]): WorkflowNode[] {
  const prevById = new Map(previous.map((n) => [n.id, n]));
  return nodes.map((n) => {
    const prev = prevById.get(n.id);
    return {
      id: n.id,
      type: (n.data as any)?.type ?? prev?.type ?? 'Unknown',
      config: (n.data as any)?.config ?? prev?.config ?? {},
      label: (n.data as any)?.label ?? prev?.label ?? undefined,
      position_x: n.position.x,
      position_y: n.position.y,
    };
  });
}

function reactFlowEdgesToWorkflowEdges(edges: Edge[]): WorkflowEdge[] {
  return edges.map((e) => ({
    id: e.id,
    source_node_id: e.source,
    target_node_id: e.target,
    label: (e.data as any)?.label ?? (typeof e.label === 'string' ? e.label : undefined),
  }));
}

/* ─── Main Canvas ─────────────────────────────────────────── */
export function WorkflowCanvas(props: WorkflowCanvasProps) {
  const { nodes, edges, selectedNodeId, onSelectNode, onChangeGraph, runSteps, onNodeContextMenu, onDeleteNode } = props;

  const statusByNodeId = useMemo(() => buildStatusByNodeId(runSteps), [runSteps]);
  const initialNodes = useMemo(() => workflowNodesToReactFlowNodes(nodes, statusByNodeId), [nodes, statusByNodeId]);
  const initialEdges = useMemo(() => workflowEdgesToReactFlowEdges(edges), [edges]);

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState(initialNodes);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [edgeMenu, setEdgeMenu] = useState<{ edgeId: string; x: number; y: number } | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  useEffect(() => { setRfNodes(workflowNodesToReactFlowNodes(nodes, statusByNodeId)); }, [nodes, statusByNodeId, setRfNodes]);
  useEffect(() => { setRfEdges(workflowEdgesToReactFlowEdges(edges)); }, [edges, setRfEdges]);

  const handleConnect = useCallback((connection: Connection) => {
    let label: string | undefined;
    const sourceNode = rfNodes.find((n) => n.id === connection.source);
    const sourceType = (sourceNode?.data as any)?.type;

    if (sourceType === 'IfCondition') {
      const existing = rfEdges.filter((e) => e.source === connection.source);
      const hasYes = existing.some((e) => e.label === 'Yes');
      const hasNo = existing.some((e) => e.label === 'No');

      // Prefer explicit handle (left = Yes, right = No)
      if (connection.sourceHandle === 'yes') {
        label = 'Yes';
      } else if (connection.sourceHandle === 'no') {
        label = 'No';
      } else {
        // Fallback: assign first unused branch
        if (!hasYes) label = 'Yes';
        else if (!hasNo) label = 'No';
      }
    }

    // If we inferred a Yes/No label but the connection did not originate
    // from a specific handle, pin the new edge to the matching handle so
    // the visual branch comes from the correct side immediately.
    const inferredSourceHandle =
      connection.sourceHandle ??
      (label === 'Yes' ? 'yes' : label === 'No' ? 'no' : undefined);

    const explicitId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `edge-${connection.source}-${inferredSourceHandle ?? 's'}-${connection.target}-${connection.targetHandle ?? 't'}-${Date.now()}`;

    const newEdges = addEdge(
      {
        id: explicitId,
        source: connection.source ?? '',
        target: connection.target ?? '',
        sourceHandle: inferredSourceHandle ?? null,
        targetHandle: connection.targetHandle ?? null,
        label,
        type: 'custom',
        markerEnd: { type: MarkerType.ArrowClosed, color: '#cbd5e1' },
      },
      rfEdges,
    );

    setRfEdges(newEdges);
    onChangeGraph(
      reactFlowNodesToWorkflowNodes(rfNodes, nodes),
      reactFlowEdgesToWorkflowEdges(newEdges),
    );
  }, [rfNodes, rfEdges, nodes, onChangeGraph]);

  const handleSelectionChange = useCallback((params: { nodes?: Node[] }) => {
    const first = params.nodes?.[0];
    onSelectNode(first ? first.id : null);
  }, [onSelectNode]);

  const handleNodesEdgesCommit = useCallback(() => {
    onChangeGraph(reactFlowNodesToWorkflowNodes(rfNodes, nodes), reactFlowEdgesToWorkflowEdges(rfEdges));
  }, [rfNodes, rfEdges, nodes, onChangeGraph]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      if (selectedEdgeId) {
        const newEdges = rfEdges.filter((e) => e.id !== selectedEdgeId);
        setRfEdges(newEdges);
        onChangeGraph(reactFlowNodesToWorkflowNodes(rfNodes, nodes), reactFlowEdgesToWorkflowEdges(newEdges));
        setSelectedEdgeId(null);
        setEdgeMenu((m) => m?.edgeId === selectedEdgeId ? null : m);
        return;
      }
      if (onDeleteNode && selectedNodeId) onDeleteNode(selectedNodeId);
    }
  }, [selectedEdgeId, rfEdges, rfNodes, nodes, onChangeGraph, onDeleteNode, selectedNodeId]);

  function deleteEdge(edgeId: string) {
    const newEdges = rfEdges.filter((e) => e.id !== edgeId);
    setRfEdges(newEdges);
    onChangeGraph(reactFlowNodesToWorkflowNodes(rfNodes, nodes), reactFlowEdgesToWorkflowEdges(newEdges));
    if (selectedEdgeId === edgeId) setSelectedEdgeId(null);
    setEdgeMenu(null);
  }

  return (
    <div className="relative h-full w-full outline-none" tabIndex={0} onKeyDown={handleKeyDown}>
      {/* SVG defs for arrow markers */}
      <svg style={{ position: 'absolute', width: 0, height: 0 }}>
        <defs>
          <marker id="arrow-default" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
            <path d="M0,0 L0,6 L9,3 z" fill="#cbd5e1" />
          </marker>
          <marker id="arrow-selected" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
            <path d="M0,0 L0,6 L9,3 z" fill="#3b82f6" />
          </marker>
        </defs>
      </svg>

      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectOnClick
        proOptions={{ hideAttribution: true }}
        connectionMode={ConnectionMode.Loose}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onSelectionChange={handleSelectionChange}
        onEdgeClick={(_, edge) => setSelectedEdgeId(edge.id)}
        onPaneClick={() => { setSelectedEdgeId(null); setEdgeMenu(null); }}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onNodeContextMenu={(event, node) => {
          event.preventDefault();
          onSelectNode(node.id);
          onNodeContextMenu?.(node.id, { x: event.clientX, y: event.clientY });
        }}
        onEdgeContextMenu={(event, edge) => {
          event.preventDefault();
          setEdgeMenu({ edgeId: edge.id, x: event.clientX, y: event.clientY });
        }}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.2}
        maxZoom={2}
        snapToGrid
        snapGrid={[24, 24]}
        onNodeDragStop={handleNodesEdgesCommit}
        onEdgesDelete={handleNodesEdgesCommit}
        onNodesDelete={handleNodesEdgesCommit}
        style={{ background: 'transparent' }}
      >
        <MiniMap
          position="bottom-right"
          nodeColor={(n) => NODE_VISUAL[(n.data as any)?.type]?.color ?? '#94a3b8'}
          maskColor="rgba(248,249,251,0.85)"
          ariaLabel=""
          style={{
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            overflow: 'hidden',
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          }}
        />
        <Controls
          position="bottom-left"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            bottom: 24,
            left: 24,
          }}
          showInteractive={false}
        />
      </ReactFlow>

      {/* Edge context menu */}
      {edgeMenu && (
        <div
          className="fixed z-50 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
          style={{ left: edgeMenu.x, top: edgeMenu.y, minWidth: 140 }}
        >
          <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 border-b border-slate-100">
            Connection
          </div>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-red-500 transition hover:bg-red-50"
            onClick={() => deleteEdge(edgeMenu.edgeId)}
          >
            <span className="text-base leading-none">⊗</span>
            Delete link
          </button>
        </div>
      )}

      {/* Selected edge action bar */}
      {selectedEdgeId && !edgeMenu && (
        <div
          className="absolute bottom-24 left-1/2 z-40 -translate-x-1/2 flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2 shadow-lg"
        >
          <span className="text-xs text-slate-500">Connection selected</span>
          <button
            type="button"
            className="rounded-lg border border-red-100 bg-red-50 px-3 py-1 text-[11px] font-semibold text-red-600 transition hover:bg-red-100 active:scale-[0.98]"
            onClick={() => deleteEdge(selectedEdgeId)}
          >
            Delete link
          </button>
          <button
            type="button"
            className="rounded-lg border border-slate-200 px-3 py-1 text-[11px] font-medium text-slate-500 transition hover:bg-slate-50"
            onClick={() => setSelectedEdgeId(null)}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}