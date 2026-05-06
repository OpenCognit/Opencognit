import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  Position,
  Handle,
  ConnectionLineType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import { Loader2, AlertTriangle, RefreshCw } from 'lucide-react';
import { authFetch } from '../utils/api';
import { useCompany } from '../hooks/useCompany';

interface GraphTask {
  id: string;
  title: string;
  status: string;
  priority: string | null;
  assignedTo: string | null;
  assignedToName: string | null;
  projectId: string | null;
}

interface GraphRelation {
  sourceId: string;
  targetId: string;
  type: string;
}

interface GraphResponse {
  tasks: GraphTask[];
  relations: GraphRelation[];
}

const STATUS_COLORS: Record<string, { bg: string; border: string; text: string; label: string }> = {
  backlog:     { bg: '#27272a', border: '#52525b', text: '#a1a1aa', label: 'Backlog' },
  todo:        { bg: '#1e3a8a33', border: '#3b82f6', text: '#93c5fd', label: 'Todo' },
  in_progress: { bg: '#78350f33', border: '#c5a059', text: '#fbbf24', label: 'In Progress' },
  in_review:   { bg: '#713f1233', border: '#eab308', text: '#fde047', label: 'Review' },
  blocked:     { bg: '#7f1d1d33', border: '#ef4444', text: '#fca5a5', label: 'Blocked' },
  done:        { bg: '#14532d33', border: '#22c55e', text: '#86efac', label: 'Done' },
  cancelled:   { bg: '#27272a',  border: '#3f3f46', text: '#71717a', label: 'Cancelled' },
};

const PRIORITY_BADGE: Record<string, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '',
  low: '',
};

// ── Custom node ──────────────────────────────────────────────────────────────
function TaskNode({ data }: { data: GraphTask }) {
  const colors = STATUS_COLORS[data.status] || STATUS_COLORS.backlog;
  return (
    <div
      style={{
        background: colors.bg,
        border: `1.5px solid ${colors.border}`,
        borderRadius: 8,
        padding: '8px 12px',
        minWidth: 180,
        maxWidth: 220,
        fontSize: 12,
        color: '#e4e4e7',
        backdropFilter: 'blur(8px)',
        boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: colors.border, width: 8, height: 8 }} />
      <div
        style={{
          fontSize: 9,
          color: colors.text,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          fontWeight: 600,
          marginBottom: 4,
        }}
      >
        {PRIORITY_BADGE[data.priority || 'medium'] || ''} {colors.label}
      </div>
      <div style={{ fontWeight: 500, lineHeight: 1.3, color: '#f4f4f5' }}>
        {data.title}
      </div>
      {data.assignedToName && (
        <div style={{ fontSize: 10, color: '#a1a1aa', marginTop: 4 }}>
          → {data.assignedToName}
        </div>
      )}
      <Handle type="source" position={Position.Right} style={{ background: colors.border, width: 8, height: 8 }} />
    </div>
  );
}

const nodeTypes = { task: TaskNode };

// ── Layout via dagre ─────────────────────────────────────────────────────────
const NODE_WIDTH = 220;
const NODE_HEIGHT = 80;

function layoutNodes(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', ranksep: 80, nodesep: 30 });

  nodes.forEach(n => g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT }));
  edges.forEach(e => g.setEdge(e.source, e.target));
  dagre.layout(g);

  return nodes.map(n => {
    const pos = g.node(n.id);
    return {
      ...n,
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    };
  });
}

// ── Main component ───────────────────────────────────────────────────────────
export function TaskDependencyGraph({ onTaskClick }: { onTaskClick?: (taskId: string) => void }) {
  const { aktivesUnternehmen } = useCompany();
  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showOrphans, setShowOrphans] = useState(false);

  const reload = useCallback(async () => {
    if (!aktivesUnternehmen) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await authFetch(`/api/companies/${aktivesUnternehmen.id}/tasks/graph`, {
        headers: { 'x-unternehmen-id': aktivesUnternehmen.id },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: GraphResponse = await res.json();
      setGraph(data);
    } catch (e: any) {
      setErr(e?.message || 'Failed to load graph');
    } finally {
      setLoading(false);
    }
  }, [aktivesUnternehmen]);

  useEffect(() => { reload(); }, [reload]);

  const { nodes, edges, stats } = useMemo<{ nodes: Node[]; edges: Edge[]; stats: { total: number; connected: number; orphans: number; relations: number } | null }>(() => {
    if (!graph) return { nodes: [], edges: [], stats: null };

    const involvedIds = new Set<string>();
    graph.relations.forEach(r => { involvedIds.add(r.sourceId); involvedIds.add(r.targetId); });

    const visibleTasks = showOrphans
      ? graph.tasks
      : graph.tasks.filter(t => involvedIds.has(t.id));

    const rawNodes: Node[] = visibleTasks.map(t => ({
      id: t.id,
      type: 'task',
      position: { x: 0, y: 0 },
      data: t as unknown as Record<string, unknown>,
    }));

    const rawEdges: Edge[] = graph.relations
      .filter(r => visibleTasks.some(t => t.id === r.sourceId) && visibleTasks.some(t => t.id === r.targetId))
      .map(r => ({
        id: `${r.sourceId}-${r.targetId}`,
        source: r.sourceId,
        target: r.targetId,
        type: 'smoothstep',
        animated: r.type === 'blocks',
        style: { stroke: '#c5a059', strokeWidth: 1.5 },
        markerEnd: { type: 'arrowclosed', color: '#c5a059' } as any,
      }));

    return {
      nodes: layoutNodes(rawNodes, rawEdges),
      edges: rawEdges,
      stats: {
        total: graph.tasks.length,
        connected: involvedIds.size,
        orphans: graph.tasks.length - involvedIds.size,
        relations: graph.relations.length,
      },
    };
  }, [graph, showOrphans]);

  if (loading && !graph) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400, color: '#71717a' }}>
        <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', marginRight: 10 }} />
        Lade Abhängigkeits-Graph...
      </div>
    );
  }

  if (err) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400, color: '#ef4444', flexDirection: 'column', gap: 12 }}>
        <AlertTriangle size={28} />
        <div>Konnte Graph nicht laden: {err}</div>
        <button onClick={reload} style={{ marginTop: 8, padding: '6px 14px', background: 'transparent', border: '1px solid #52525b', borderRadius: 6, color: '#a1a1aa', cursor: 'pointer' }}>
          <RefreshCw size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} /> Erneut versuchen
        </button>
      </div>
    );
  }

  if (!graph || graph.tasks.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400, color: '#71717a' }}>
        Keine Tasks in diesem Unternehmen.
      </div>
    );
  }

  if (graph.relations.length === 0 && !showOrphans) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400, color: '#a1a1aa', flexDirection: 'column', gap: 12, padding: 20, textAlign: 'center' }}>
        <div style={{ fontSize: 13 }}>
          Noch keine Abhängigkeiten zwischen Tasks definiert.
          <br />
          <span style={{ color: '#71717a', fontSize: 12 }}>
            In der Task-Detail-View kannst du Blocker setzen.
          </span>
        </div>
        <button
          onClick={() => setShowOrphans(true)}
          style={{ padding: '6px 14px', background: 'transparent', border: '1px solid #52525b', borderRadius: 6, color: '#c5a059', cursor: 'pointer', fontSize: 12 }}
        >
          Trotzdem alle {graph.tasks.length} Tasks anzeigen
        </button>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: 'calc(100vh - 240px)', minHeight: 500, position: 'relative', borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(82, 82, 91, 0.4)', background: 'rgba(15, 15, 20, 0.6)' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        connectionLineType={ConnectionLineType.SmoothStep}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_e, node) => onTaskClick?.(node.id)}
      >
        <Background color="#3f3f46" gap={24} size={1} />
        <Controls style={{ background: 'rgba(24, 24, 27, 0.9)', border: '1px solid #3f3f46', borderRadius: 6 }} />
        <MiniMap
          style={{ background: 'rgba(24, 24, 27, 0.9)', border: '1px solid #3f3f46', borderRadius: 6 }}
          nodeColor={(n) => {
            const data = n.data as unknown as GraphTask;
            return STATUS_COLORS[data?.status]?.border || '#52525b';
          }}
          maskColor="rgba(0, 0, 0, 0.5)"
        />
      </ReactFlow>
      {stats && (
        <div style={{ position: 'absolute', top: 12, left: 12, padding: '6px 12px', background: 'rgba(15, 15, 20, 0.85)', border: '1px solid rgba(82, 82, 91, 0.4)', borderRadius: 6, fontSize: 11, color: '#a1a1aa', backdropFilter: 'blur(8px)' }}>
          <span style={{ color: '#c5a059', fontWeight: 600 }}>{stats.connected}</span> verbunden
          {stats.orphans > 0 && <> · <span>{stats.orphans} ohne Abh.</span></>}
          {' · '}<span>{stats.relations} Kanten</span>
          {!showOrphans && stats.orphans > 0 && (
            <button
              onClick={() => setShowOrphans(true)}
              style={{ marginLeft: 10, padding: '2px 8px', background: 'transparent', border: '1px solid #52525b', borderRadius: 4, color: '#a1a1aa', cursor: 'pointer', fontSize: 10 }}
            >
              + alle zeigen
            </button>
          )}
          {showOrphans && (
            <button
              onClick={() => setShowOrphans(false)}
              style={{ marginLeft: 10, padding: '2px 8px', background: 'transparent', border: '1px solid #52525b', borderRadius: 4, color: '#a1a1aa', cursor: 'pointer', fontSize: 10 }}
            >
              − nur verbundene
            </button>
          )}
        </div>
      )}
    </div>
  );
}
