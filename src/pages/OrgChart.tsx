import React, { useState, useRef, useEffect } from 'react';
import { Loader2, Sparkles, Workflow, History, DollarSign, Brain, Code, Search, Shield, Cpu, Briefcase, Zap, Rocket, Settings, Crown, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { PageHelp } from '../components/PageHelp';
import { motion, AnimatePresence } from 'framer-motion';
import { useBreadcrumbs } from '../hooks/useBreadcrumbs';
import { StatusBadge } from '../components/StatusBadge';
import { useI18n } from '../i18n';
import { zeitRelativ } from '../utils/i18n';
import { useCompany } from '../hooks/useCompany';
import { useApi } from '../hooks/useApi';
import { apiExperten, type Experte } from '../api/client';
import { ExpertChatDrawer } from '../components/ExpertChatDrawer';

const ROLE_ICONS: Record<string, any> = {
  ceo: Brain,
  manager: Briefcase,
  frontend: Code,
  backend: Cpu,
  research: Search,
  security: Shield,
  devops: Rocket,
  default: Zap
};

function getRoleIcon(role: string) {
  const r = role.toLowerCase();
  if (r.includes('ceo')) return ROLE_ICONS.ceo;
  if (r.includes('manage')) return ROLE_ICONS.manager;
  if (r.includes('front')) return ROLE_ICONS.frontend;
  if (r.includes('back')) return ROLE_ICONS.backend;
  if (r.includes('research')) return ROLE_ICONS.research;
  if (r.includes('security')) return ROLE_ICONS.security;
  if (r.includes('infra') || r.includes('ops')) return ROLE_ICONS.devops;
  return ROLE_ICONS.default;
}

interface OrgNodeData {
  experte: Experte;
  kinder: OrgNodeData[];
  depth: number;
}

function buildTree(experts: Experte[]): OrgNodeData[] {
  const map = new Map<string | null, Experte[]>();
  for (const m of experts) {
    const key = m.reportsTo ?? null;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(m);
  }
  function buildNode(m: Experte, depth: number = 0): OrgNodeData {
    return {
      experte: m,
      kinder: (map.get(m.id) || []).map(k => buildNode(k, depth + 1)),
      depth
    };
  }

  const rootNodes = map.get(null) || [];
  // Sort: orchestrators first, then by name
  rootNodes.sort((a, b) => {
    if (a.isOrchestrator && !b.isOrchestrator) return -1;
    if (!a.isOrchestrator && b.isOrchestrator) return 1;
    return a.name.localeCompare(b.name);
  });

  return rootNodes.map(m => buildNode(m, 0));
}

function AnimatedPath({ fromX, fromY, toX, toY, isRunning, glowId, gradId }: { fromX: number, fromY: number, toX: number, toY: number, isRunning?: boolean, glowId?: string, gradId?: string }) {
  const pathData = `M ${fromX} ${fromY} C ${fromX} ${fromY + 25}, ${toX} ${fromY + 15}, ${toX} ${toY}`;

  return (
    <g>
      <motion.path
        d={pathData}
        stroke="rgba(255,255,255,0.08)"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1, ease: "easeOut" }}
      />
      <motion.path
        d={pathData}
        stroke={gradId ? `url(#${gradId})` : 'url(#pathGrad)'}
        strokeWidth={isRunning ? "3" : "1.5"}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={isRunning ? "10, 10" : "100, 0"}
        initial={{ strokeDashoffset: 0 }}
        animate={isRunning ? { strokeDashoffset: -20 } : {}}
        transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
        style={{
          filter: isRunning && glowId ? `url(#${glowId})` : 'none',
          opacity: isRunning ? 1 : 0.4,
        }}
      />
      <motion.circle
        r="2"
        fill="#23CDCB"
        style={{
          filter: 'drop-shadow(0 0 4px #23CDCB)',
        }}
        initial={{ offsetDistance: "0%", opacity: 0 }}
        animate={{ 
          offsetDistance: "100%", 
          opacity: [0, 1, 1, 0] 
        }}
        transition={{
          repeat: Infinity,
          duration: 3 + Math.random() * 2,
          delay: Math.random() * 3,
          ease: "easeInOut"
        }}
      >
        <animateMotion dur="3s" repeatCount="indefinite" path={pathData} />
      </motion.circle>
    </g>
  );
}

// Node card width and horizontal gap between siblings — must match the CSS values below
const NODE_W = 240;
const H_GAP = 40;

/** Recursively calculate the pixel width a subtree occupies */
function subtreeWidth(node: OrgNodeData): number {
  if (node.kinder.length === 0) return NODE_W;
  const childrenW = node.kinder.reduce((sum, k) => sum + subtreeWidth(k), 0)
    + (node.kinder.length - 1) * H_GAP;
  return Math.max(NODE_W, childrenW);
}

let _connectorId = 0;
function ConnectorLines({ childWidths, isRunning }: { childWidths: number[], isRunning?: boolean }) {
  const uid = React.useRef(`cl-${_connectorId++}`).current;
  if (childWidths.length === 0) return null;

  const totalW = childWidths.reduce((s, w) => s + w, 0) + (childWidths.length - 1) * H_GAP;
  const height = 60;
  const fromX = totalW / 2;

  // Centre X of each child slot
  let x = 0;
  const childCenters = childWidths.map(w => {
    const cx = x + w / 2;
    x += w + H_GAP;
    return cx;
  });

  return (
    <svg width={totalW} height={height} style={{ marginBottom: -5, overflow: 'visible', display: 'block' }}>
      <defs>
        <filter id={`glow-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
        <linearGradient id={`pathGrad-${uid}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.1)" />
          <stop offset="100%" stopColor="#23CDCB" />
        </linearGradient>
      </defs>

      <line
        x1={fromX} y1="0" x2={fromX} y2="15"
        stroke="rgba(255,255,255,0.15)" strokeWidth="1.5"
      />

      {childCenters.map((toX, i) => (
        <AnimatedPath
          key={i}
          fromX={fromX}
          fromY={15}
          toX={toX}
          toY={height}
          isRunning={isRunning}
          glowId={`glow-${uid}`}
          gradId={`pathGrad-${uid}`}
        />
      ))}
    </svg>
  );
}

function OrgNodeCard({ node, onSelect, onEdit, onHover }: { node: OrgNodeData, onSelect: (m: Experte) => void, onEdit: (m: Experte) => void, onHover: (m: Experte | null) => void }) {
  const m = node.experte;
  const isRunning = m.status === 'running';
  const isCEO = m.isOrchestrator === true || m.id === 'company-hub';
  const Icon = getRoleIcon(m.rolle);

  return (
    <motion.div 
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: node.depth * 0.1 }}
    >
      <motion.div
        onClick={() => onSelect(m)}
        onMouseEnter={() => onHover(m)}
        onMouseLeave={() => onHover(null)}
        whileHover={{ scale: 1.02, y: -5 }}
        style={{
          minWidth: 240,
          padding: '16px 20px',
          backgroundColor: isCEO ? 'rgba(255, 215, 0, 0.05)' : 'rgba(255, 255, 255, 0.03)',
          backdropFilter: 'blur(30px)',
          borderRadius: '20px',
          border: isCEO ? '2px solid #FFD700' : isRunning ? '2px solid #23CDCB' : '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: isCEO 
            ? '0 0 40px rgba(255, 215, 0, 0.2), inset 0 0 20px rgba(255, 215, 0, 0.1)' 
            : isRunning 
              ? '0 0 30px rgba(35, 205, 202, 0.25), inset 0 0 10px rgba(35, 205, 202, 0.1)' 
              : '0 10px 30px rgba(0,0,0,0.2)',
          position: 'relative',
          zIndex: 2,
          cursor: 'pointer',
          transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
        }}
      >
        {(isRunning || isCEO) && (
          <div style={{
            position: 'absolute',
            inset: -4,
            border: `2px solid ${isCEO ? '#FFD700' : '#23CDCB'}`,
            borderRadius: '22px',
            animation: 'aura 3s ease-in-out infinite',
            opacity: isCEO ? 0.8 : 0.6
          }} />
        )}

        {isCEO && (
          <div style={{
            position: 'absolute',
            top: -12,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'linear-gradient(135deg, #FFD700, #FFA500)',
            padding: '4px 10px',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            boxShadow: '0 4px 12px rgba(255, 215, 0, 0.4)',
            zIndex: 10
          }}>
            <Crown size={12} color="#000" strokeWidth={3} />
            <span style={{ fontSize: '9px', fontWeight: 900, color: '#000', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Orchestrator</span>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
          <div style={{
            width: '44px',
            height: '44px',
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.25rem',
            fontWeight: 600,
            background: m.avatarFarbe + '22',
            color: m.avatarFarbe,
            boxShadow: `0 0 15px ${m.avatarFarbe}33`,
            flexShrink: 0
          }}>
            {m.avatar}
          </div>
          <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#ffffff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {m.name}
              </div>
              <button 
                onClick={(e) => { e.stopPropagation(); onEdit(m); }}
                style={{ background: 'none', border: 'none', color: '#71717a', cursor: 'pointer', padding: 4, display: 'flex' }}
                title="Settings"
              >
                <Settings size={14} />
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#23CDCB', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              <Icon size={10} strokeWidth={3} />
              {m.rolle}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
          <StatusBadge status={m.status} />
          <div style={{ fontSize: 10, color: '#475569', fontWeight: 500 }}>
            LVL {node.kinder.length > 0 ? 'MGR' : 'AGT'}
          </div>
        </div>
      </motion.div>

      {node.kinder.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ width: 2.5, height: 20, background: 'linear-gradient(to bottom, rgba(35,205,202,0.4), rgba(35,205,202,1))', borderRadius: '1.25px' }} />
          <ConnectorLines
            childWidths={node.kinder.map(k => subtreeWidth(k))}
            isRunning={isRunning || node.kinder.some(k => k.experte.status === 'running')}
          />
          <div style={{ display: 'flex', gap: `${H_GAP}px`, alignItems: 'flex-start' }}>
            {node.kinder.map((kind) => (
              <OrgNodeCard key={kind.experte.id} node={kind} onSelect={onSelect} onEdit={onEdit} onHover={onHover} />
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

function AuditCard({ expert, i18n }: { expert: Experte, i18n: any }) {
  const Icon = getRoleIcon(expert.rolle);
  const budget = expert.budgetMonatCent > 0 ? Math.round((expert.verbrauchtMonatCent / expert.budgetMonatCent) * 100) : 0;
  
  return (
    <motion.div
      initial={{ y: 50, opacity: 0, scale: 0.95 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={{ y: 50, opacity: 0, scale: 0.95 }}
      style={{
        position: 'fixed',
        bottom: '2rem',
        left: '50%',
        x: '-50%',
        zIndex: 1000,
        width: 'auto',
        minWidth: '460px',
        maxWidth: '90vw',
      }}
    >
      <div style={{
        padding: '24px',
        borderRadius: '24px',
        background: 'rgba(8, 8, 18, 0.9)',
        backdropFilter: 'blur(40px)',
        border: '1px solid rgba(35, 205, 202, 0.3)',
        boxShadow: '0 20px 50px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)',
      }}>
        <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
          <div style={{
            width: '64px',
            height: '64px',
            borderRadius: '16px',
            background: expert.avatarFarbe + '15',
            border: `1px solid ${expert.avatarFarbe}33`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '2rem',
            position: 'relative'
          }}>
            {expert.avatar}
            <div style={{ 
              position: 'absolute', bottom: -4, right: -4, 
              width: 24, height: 24, borderRadius: '50%', 
              background: '#0a0a0f', border: '1px solid rgba(255,255,255,0.1)', 
              display: 'flex', alignItems: 'center', justifyContent: 'center' 
            }}>
              <Icon size={12} color="#23CDCB" />
            </div>
          </div>

          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff' }}>{expert.name}</h3>
              <span style={{ 
                padding: '2px 8px', borderRadius: '6px', 
                background: 'rgba(35, 205, 202, 0.1)', border: '1px solid rgba(35, 205, 202, 0.2)',
                fontSize: '10px', color: '#23CDCB', fontWeight: 700, textTransform: 'uppercase'
              }}>{expert.rolle}</span>
            </div>
            <p style={{ fontSize: '0.85rem', color: '#94a3b8', lineHeight: 1.5, marginBottom: '16px' }}>
              {expert.faehigkeiten || "Autonomer Agent zur Unterstützung der Unternehmensziele."}
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <Workflow size={14} color="#64748b" />
                <div style={{ fontSize: '11px' }}>
                  <div style={{ color: '#64748b' }}>Letzte Aktivität</div>
                  <div style={{ color: '#e2e8f0', fontWeight: 600 }}>{zeitRelativ(expert.letzterZyklus, i18n.t)}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <DollarSign size={14} color="#64748b" />
                <div style={{ fontSize: '11px' }}>
                  <div style={{ color: '#64748b' }}>Budget-Auslastung</div>
                  <div style={{ color: budget > 80 ? '#ef4444' : '#22c55e', fontWeight: 600 }}>{budget}% verbraucht</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ 
          marginTop: '20px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '10px', color: '#64748b', fontFamily: 'monospace' }}>
            <History size={12} />
            <span>ID: {expert.id.slice(0, 18)}...</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', fontWeight: 700, color: '#23CDCB' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: expert.status === 'running' ? '#22c55e' : '#64748b' }} />
            {expert.status.toUpperCase()}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 2.0;
const ZOOM_STEP = 0.15;

export function OrgChart() {
  const i18n = useI18n();
  const { aktivesUnternehmen } = useCompany();
  useBreadcrumbs([aktivesUnternehmen?.name ?? '', 'Intelligence Map']);
  const [activeChatExpert, setActiveChatExpert] = useState<Experte | null>(null);
  const [editingExpert, setEditingExpert] = useState<Experte | null>(null);
  const [hoveredExpert, setHoveredExpert] = useState<Experte | null>(null);
  const [zoom, setZoom] = useState(0.8);
  const [pan, setPan] = useState({ x: 60, y: 60 });
  // Callback ref: fires when the canvas div actually mounts (not just on component mount)
  const [canvasEl, setCanvasEl] = useState<HTMLDivElement | null>(null);
  const canvasRef = React.useCallback((el: HTMLDivElement | null) => setCanvasEl(el), []);
  const contentRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  const isDragging = useRef(false);
  const hasDragged = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  zoomRef.current = zoom;
  panRef.current = pan;

  const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

  // Center tree when canvas first appears
  useEffect(() => {
    if (!canvasEl || !contentRef.current) return;
    const cw = canvasEl.clientWidth;
    const ch = canvasEl.clientHeight;
    const tw = contentRef.current.scrollWidth * zoomRef.current;
    const th = contentRef.current.scrollHeight * zoomRef.current;
    setPan({ x: Math.max(40, (cw - tw) / 2), y: Math.max(40, (ch - th) / 2) });
  }, [canvasEl]);

  // Wheel: zoom toward cursor
  useEffect(() => {
    if (!canvasEl) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvasEl.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 0.9;
      const newZoom = clampZoom(zoomRef.current * factor);
      const ratio = newZoom / zoomRef.current;
      setPan(p => ({ x: mx - (mx - p.x) * ratio, y: my - (my - p.y) * ratio }));
      setZoom(newZoom);
    };
    canvasEl.addEventListener('wheel', onWheel, { passive: false });
    return () => canvasEl.removeEventListener('wheel', onWheel);
  }, [canvasEl]);

  // Mouse drag: pan — swallow click after drag so cards don't open
  useEffect(() => {
    if (!canvasEl) return;
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      isDragging.current = true;
      hasDragged.current = false;
      lastMouse.current = { x: e.clientX, y: e.clientY };
      canvasEl.style.cursor = 'grabbing';
    };
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const dx = e.clientX - lastMouse.current.x;
      const dy = e.clientY - lastMouse.current.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasDragged.current = true;
      lastMouse.current = { x: e.clientX, y: e.clientY };
      setPan(p => ({ x: p.x + dx, y: p.y + dy }));
    };
    const onUp = () => {
      isDragging.current = false;
      canvasEl.style.cursor = 'grab';
      if (hasDragged.current) {
        // Capture and swallow the next click so card onClick doesn't fire after drag
        const swallow = (ev: Event) => { ev.stopPropagation(); canvasEl.removeEventListener('click', swallow, true); };
        canvasEl.addEventListener('click', swallow, true);
      }
    };
    canvasEl.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      canvasEl.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [canvasEl]);

  const { data: experts, loading, reload } = useApi<Experte[]>(
    () => apiExperten.liste(aktivesUnternehmen!.id), [aktivesUnternehmen?.id]
  );

  if (!aktivesUnternehmen) return null;

  if (loading || !experts) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh' }}>
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: '#23CDCB' }} />
      </div>
    );
  }

  const baum = buildTree(experts);

  const virtualHub: Experte = {
    id: 'company-hub',
    unternehmenId: aktivesUnternehmen.id,
    name: aktivesUnternehmen.name,
    rolle: 'Enterprise Headquarters',
    titel: 'Enterprise Headquarters',
    avatar: '🏢',
    avatarFarbe: '#23CDCB',
    status: 'active',
    verbindungsTyp: 'ceo',
    verbindungsConfig: null,
    letzterZyklus: new Date().toISOString(),
    zyklusIntervallSek: 0,
    zyklusAktiv: false,
    verbrauchtMonatCent: 0,
    budgetMonatCent: 0,
    faehigkeiten: 'Central orchestration hub for all autonomous agents.',
    reportsTo: null,
    erstelltAm: new Date().toISOString(),
    aktualisiertAm: new Date().toISOString(),
  };

  // If an orchestrator agent exists as a root node, it *is* the CEO — no virtual
  // hub needed. Any other root-level agents (no reportsTo set) are shown as its
  // direct reports in the chart, so nothing is hidden.
  const orchestratorRoot = baum.find(n => n.experte.isOrchestrator);
  const finalTree: OrgNodeData[] = orchestratorRoot
    ? [{
        ...orchestratorRoot,
        kinder: [
          ...orchestratorRoot.kinder,
          ...baum.filter(n => !n.experte.isOrchestrator),
        ],
      }]
    : baum.length > 1
      ? [{ experte: virtualHub, kinder: baum, depth: -1 }]
      : baum;

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - var(--topbar-height))' }}>
          {/* Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '1.5rem',
            flexWrap: 'wrap',
            gap: '1rem',
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                <Sparkles size={20} style={{ color: '#23CDCB' }} />
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#23CDCB', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                  {aktivesUnternehmen.name}
                </span>
              </div>
              <h1 style={{
                fontSize: '2rem',
                fontWeight: 700,
                background: 'linear-gradient(to bottom right, #23CDCB 0%, #ffffff 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}>Company Intelligence Map</h1>
              <p style={{ fontSize: '0.875rem', color: '#71717a', marginTop: '0.25rem' }}>Visualisierung der Entscheidungswege und Hierarchien</p>
            </div>
            <PageHelp id="orgchart" lang={i18n.language} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {/* Zoom controls */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 4,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 10, padding: '4px 8px',
              }}>
                <button
                  onClick={() => { const nz = clampZoom(zoom - ZOOM_STEP); const r = nz/zoom; const cx = (canvasEl?.clientWidth||600)/2; const cy = (canvasEl?.clientHeight||400)/2; setPan(p => ({x: cx-(cx-p.x)*r, y: cy-(cy-p.y)*r})); setZoom(nz); }}
                  title="Rauszoomen (–)"
                  style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', display: 'flex', padding: 4, borderRadius: 6 }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
                  onMouseLeave={e => (e.currentTarget.style.color = '#94a3b8')}
                >
                  <ZoomOut size={16} />
                </button>
                <button
                  onClick={() => { setZoom(1); setPan({ x: 60, y: 60 }); }}
                  title={i18n.t.tooltips.resetZoom}
                  style={{ background: 'none', border: 'none', color: '#23CDCB', cursor: 'pointer', fontSize: '11px', fontWeight: 700, padding: '0 6px', fontFamily: 'monospace', minWidth: 36, textAlign: 'center' }}
                >
                  {Math.round(zoom * 100)}%
                </button>
                <button
                  onClick={() => { const nz = clampZoom(zoom + ZOOM_STEP); const r = nz/zoom; const cx = (canvasEl?.clientWidth||600)/2; const cy = (canvasEl?.clientHeight||400)/2; setPan(p => ({x: cx-(cx-p.x)*r, y: cy-(cy-p.y)*r})); setZoom(nz); }}
                  title="Reinzoomen (+)"
                  style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', display: 'flex', padding: 4, borderRadius: 6 }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
                  onMouseLeave={e => (e.currentTarget.style.color = '#94a3b8')}
                >
                  <ZoomIn size={16} />
                </button>
                <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)', margin: '0 2px' }} />
                <button
                  onClick={() => { setZoom(ZOOM_MIN + 0.1); setPan({ x: 40, y: 40 }); }}
                  title="Alles anzeigen"
                  style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', display: 'flex', padding: 4, borderRadius: 6 }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
                  onMouseLeave={e => (e.currentTarget.style.color = '#94a3b8')}
                >
                  <Maximize2 size={14} />
                </button>
              </div>
              <div style={{
                padding: '0.5rem 0.875rem',
                backgroundColor: 'rgba(34, 197, 94, 0.1)',
                border: '1px solid rgba(34, 197, 94, 0.2)',
                borderRadius: '9999px',
                fontSize: '0.75rem',
                color: '#22c55e',
                fontWeight: 500,
              }}>
                Live Monitor aktiv
              </div>
            </div>
          </div>

          {/* The Map Arena */}
          <div
            ref={canvasRef as any}
            style={{
              flex: 1,
              overflow: 'hidden',
              backgroundColor: 'rgba(255, 255, 255, 0.01)',
              backdropFilter: 'blur(20px)',
              borderRadius: '20px',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              animation: 'fadeInUp 0.5s ease-out',
              position: 'relative',
              cursor: 'grab',
              userSelect: 'none',
            }}
          >
            {/* Zoom hint */}
            <div style={{
              position: 'absolute', bottom: 12, right: 16, zIndex: 10,
              fontSize: '10px', color: '#334155', pointerEvents: 'none',
            }}>
              Scroll = Zoom · Ziehen = Pan
            </div>
            {/* Infinite canvas content */}
            <div
              ref={contentRef}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                transformOrigin: '0 0',
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                display: 'inline-flex',
                flexDirection: 'row',
                gap: '60px',
                alignItems: 'flex-start',
                padding: '2rem',
              }}
            >
              {finalTree.map((root) => (
                <OrgNodeCard key={root.experte.id} node={root} onSelect={setActiveChatExpert} onEdit={setEditingExpert} onHover={setHoveredExpert} />
              ))}
            </div>
          </div>


          {/* Feature Pills */}
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: '0.5rem',
            paddingTop: '1.5rem',
            borderTop: '1px solid rgba(255, 255, 255, 0.06)',
          }}>
            {['Org Chart', 'Hierarchie', 'Team Struktur', 'Live Status'].map((feature, i) => (
              <div key={i} style={{
                padding: '0.4rem 0.8rem',
                backgroundColor: 'rgba(35, 205, 202, 0.08)',
                border: '1px solid rgba(35, 205, 202, 0.2)',
                borderRadius: '9999px',
                fontSize: '0.7rem',
                color: '#23CDCB',
                fontWeight: 500,
              }}>{feature}</div>
            ))}
          </div>
      </div>

      <AnimatePresence>
        {hoveredExpert && (
          <AuditCard expert={hoveredExpert} i18n={i18n} />
        )}
      </AnimatePresence>

      {(activeChatExpert || editingExpert) && (
        <ExpertChatDrawer
          expert={(activeChatExpert || editingExpert)!}
          initialTab={editingExpert ? 'einstellungen' : 'überblick'}
          onClose={() => {
            setActiveChatExpert(null);
            setEditingExpert(null);
          }}
          onUpdated={() => reload()}
        />
      )}

    </>
  );
}
