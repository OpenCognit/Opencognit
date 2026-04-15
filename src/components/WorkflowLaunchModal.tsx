import { useState, useCallback } from 'react';
import { X, Rocket, Code2, Bug, FileText, Shield, TrendingUp, Search, Sparkles, ChevronRight, Check, Loader2 } from 'lucide-react';
import { authFetch } from '../utils/api';
import { useCompany } from '../hooks/useCompany';
import { useNavigate } from 'react-router-dom';

// ─── Template Definitions ─────────────────────────────────────────────────────

interface TaskTemplate { titel: string; beschreibung?: string; prioritaet: string; }

interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  tasks: TaskTemplate[];
  inputLabel: string;
  inputPlaceholder: string;
}

const TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'ship-feature',
    name: 'Ship a Feature',
    description: 'End-to-end feature delivery pipeline',
    icon: <Rocket size={20} />,
    color: '#23CDCB',
    inputLabel: 'Feature Name',
    inputPlaceholder: 'e.g. "User Authentication"',
    tasks: [
      { titel: 'Design: {{input}}', beschreibung: 'Create technical design document and define API contracts', prioritaet: 'high' },
      { titel: 'Implement: {{input}}', beschreibung: 'Build the feature according to the design document', prioritaet: 'high' },
      { titel: 'Write tests for: {{input}}', beschreibung: 'Unit tests, integration tests, and edge case coverage', prioritaet: 'medium' },
      { titel: 'Code Review: {{input}}', beschreibung: 'Peer review of the implementation', prioritaet: 'high' },
      { titel: 'Deploy: {{input}} to staging', beschreibung: 'Deploy and smoke-test on staging environment', prioritaet: 'medium' },
    ],
  },
  {
    id: 'bug-fix',
    name: 'Bug Fix Sprint',
    description: 'Systematic bug investigation and resolution',
    icon: <Bug size={20} />,
    color: '#ef4444',
    inputLabel: 'Bug Description',
    inputPlaceholder: 'e.g. "Login timeout on mobile"',
    tasks: [
      { titel: 'Reproduce: {{input}}', beschreibung: 'Create reliable reproduction steps and document environment', prioritaet: 'critical' },
      { titel: 'Root Cause Analysis: {{input}}', beschreibung: 'Investigate logs, trace the issue to its source', prioritaet: 'high' },
      { titel: 'Fix: {{input}}', beschreibung: 'Implement the fix with minimal side effects', prioritaet: 'critical' },
      { titel: 'Verify: {{input}} is resolved', beschreibung: 'Confirm the fix works in all affected environments', prioritaet: 'high' },
      { titel: 'Document: {{input}} post-mortem', beschreibung: 'Brief post-mortem and prevention notes', prioritaet: 'low' },
    ],
  },
  {
    id: 'content-pipeline',
    name: 'Content Pipeline',
    description: 'Research → Draft → Review → Publish',
    icon: <FileText size={20} />,
    color: '#a855f7',
    inputLabel: 'Content Topic',
    inputPlaceholder: 'e.g. "OpenCognit Product Update Q1"',
    tasks: [
      { titel: 'Research: {{input}}', beschreibung: 'Gather data, sources, and key points for the content', prioritaet: 'medium' },
      { titel: 'Draft: {{input}}', beschreibung: 'Write the first draft of the content', prioritaet: 'high' },
      { titel: 'Edit & Polish: {{input}}', beschreibung: 'Improve clarity, tone, and structure', prioritaet: 'medium' },
      { titel: 'SEO & Metadata: {{input}}', beschreibung: 'Optimize title, meta description, and keywords', prioritaet: 'low' },
      { titel: 'Publish: {{input}}', beschreibung: 'Schedule or publish the final content', prioritaet: 'high' },
    ],
  },
  {
    id: 'security-audit',
    name: 'Security Audit',
    description: 'Full security review of a system or feature',
    icon: <Shield size={20} />,
    color: '#f59e0b',
    inputLabel: 'System / Scope',
    inputPlaceholder: 'e.g. "Payment API"',
    tasks: [
      { titel: 'Threat Model: {{input}}', beschreibung: 'Identify attack surfaces and potential threat vectors', prioritaet: 'high' },
      { titel: 'Vulnerability Scan: {{input}}', beschreibung: 'Run automated security scans and dependency checks', prioritaet: 'high' },
      { titel: 'Manual Review: {{input}}', beschreibung: 'Review authentication, authorization, and data handling', prioritaet: 'critical' },
      { titel: 'Security Report: {{input}}', beschreibung: 'Document findings with severity ratings and remediation steps', prioritaet: 'high' },
      { titel: 'Remediate findings: {{input}}', beschreibung: 'Fix critical and high severity vulnerabilities', prioritaet: 'critical' },
    ],
  },
  {
    id: 'research-report',
    name: 'Research & Analysis',
    description: 'Deep research on any topic or technology',
    icon: <Search size={20} />,
    color: '#3b82f6',
    inputLabel: 'Research Topic',
    inputPlaceholder: 'e.g. "Competitor pricing analysis"',
    tasks: [
      { titel: 'Define scope: {{input}}', beschreibung: 'Set research questions, goals, and success criteria', prioritaet: 'medium' },
      { titel: 'Data Collection: {{input}}', beschreibung: 'Gather relevant data, papers, and sources', prioritaet: 'high' },
      { titel: 'Analysis: {{input}}', beschreibung: 'Synthesize findings and identify patterns', prioritaet: 'high' },
      { titel: 'Report: {{input}} findings', beschreibung: 'Write a structured summary with actionable recommendations', prioritaet: 'medium' },
    ],
  },
  {
    id: 'performance-optimization',
    name: 'Performance Sprint',
    description: 'Measure → Identify → Optimize → Verify',
    icon: <TrendingUp size={20} />,
    color: '#22c55e',
    inputLabel: 'System / Component',
    inputPlaceholder: 'e.g. "Dashboard load time"',
    tasks: [
      { titel: 'Baseline Metrics: {{input}}', beschreibung: 'Measure current performance with profiling tools', prioritaet: 'high' },
      { titel: 'Identify bottlenecks: {{input}}', beschreibung: 'Analyze where time/resources are being spent', prioritaet: 'high' },
      { titel: 'Optimize: {{input}}', beschreibung: 'Implement targeted performance improvements', prioritaet: 'high' },
      { titel: 'Verify improvements: {{input}}', beschreibung: 'Confirm improvements with before/after benchmarks', prioritaet: 'medium' },
    ],
  },
];

// ─── Template Card ────────────────────────────────────────────────────────────

function TemplateCard({ tpl, selected, onClick }: { tpl: WorkflowTemplate; selected: boolean; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '1rem',
        borderRadius: 14,
        border: `1px solid ${selected ? tpl.color : (hovered ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.06)')}`,
        background: selected ? `${tpl.color}10` : (hovered ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.01)'),
        cursor: 'pointer',
        transition: 'all 0.15s',
        position: 'relative',
      }}
    >
      {selected && (
        <div style={{
          position: 'absolute', top: 8, right: 8,
          width: 18, height: 18, borderRadius: '50%',
          background: tpl.color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Check size={10} color="#fff" />
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.375rem' }}>
        <div style={{ color: tpl.color }}>{tpl.icon}</div>
        <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#f4f4f5' }}>{tpl.name}</span>
      </div>
      <p style={{ margin: 0, fontSize: '0.75rem', color: '#71717a', lineHeight: 1.5 }}>{tpl.description}</p>
      <div style={{ marginTop: '0.5rem', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {tpl.tasks.slice(0, 3).map((t, i) => (
          <span key={i} style={{
            fontSize: '0.625rem', padding: '0.1rem 0.375rem', borderRadius: 4,
            background: `${tpl.color}18`, color: tpl.color,
          }}>
            {t.titel.replace('{{input}}', '…').split(':')[0]}
          </span>
        ))}
        {tpl.tasks.length > 3 && (
          <span style={{ fontSize: '0.625rem', color: '#52525b' }}>+{tpl.tasks.length - 3} more</span>
        )}
      </div>
    </div>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

interface WorkflowLaunchModalProps {
  open: boolean;
  onClose: () => void;
  onLaunched?: () => void;
}

export function WorkflowLaunchModal({ open, onClose, onLaunched }: WorkflowLaunchModalProps) {
  const { aktivesUnternehmen } = useCompany();
  const navigate = useNavigate();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [launching, setLaunching] = useState(false);
  const [launched, setLaunched] = useState(false);
  const [createdCount, setCreatedCount] = useState(0);

  const selectedTpl = TEMPLATES.find(t => t.id === selectedId) ?? null;

  const reset = () => {
    setSelectedId(null);
    setInput('');
    setLaunching(false);
    setLaunched(false);
    setCreatedCount(0);
  };

  const handleClose = () => { reset(); onClose(); };

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setInput('');
  };

  const handleLaunch = useCallback(async () => {
    if (!selectedTpl || !input.trim() || !aktivesUnternehmen) return;
    setLaunching(true);

    const tasks = selectedTpl.tasks.map(t => ({
      titel: t.titel.replace(/\{\{input\}\}/g, input.trim()),
      beschreibung: t.beschreibung?.replace(/\{\{input\}\}/g, input.trim()),
      prioritaet: t.prioritaet,
    }));

    try {
      let count = 0;
      for (const task of tasks) {
        const res = await authFetch(`/api/aufgaben`, {
          method: 'POST',
          body: JSON.stringify({
            unternehmenId: aktivesUnternehmen.id,
            titel: task.titel,
            beschreibung: task.beschreibung,
            prioritaet: task.prioritaet,
            status: 'todo',
          }),
        });
        if (res.ok) count++;
      }
      setCreatedCount(count);
      setLaunched(true);
      onLaunched?.();
    } catch {
      setLaunching(false);
    }
  }, [selectedTpl, input, aktivesUnternehmen]);

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 600,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
      onClick={handleClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '90vw', maxWidth: 720, maxHeight: '90vh',
          background: 'rgba(10,10,18,0.98)',
          backdropFilter: 'blur(40px)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 20,
          boxShadow: '0 25px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)',
          display: 'flex', flexDirection: 'column',
          animation: 'modalSlideUp 0.25s cubic-bezier(0.34,1.56,0.64,1)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
            <div style={{
              width: 32, height: 32, borderRadius: 9,
              background: 'rgba(35,205,202,0.12)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#23CDCB',
            }}>
              <Sparkles size={16} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.0625rem', fontWeight: 800, color: '#f4f4f5' }}>Launch Workflow</h2>
              <p style={{ margin: 0, fontSize: '0.75rem', color: '#52525b' }}>Pick a template and create tasks in one click</p>
            </div>
          </div>
          <button onClick={handleClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#52525b', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        {/* Success State */}
        {launched ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem', gap: '1rem' }}>
            <div style={{
              width: 64, height: 64, borderRadius: '50%',
              background: 'rgba(34,197,94,0.12)',
              border: '1px solid rgba(34,197,94,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#22c55e',
              fontSize: '1.75rem',
            }}>
              🚀
            </div>
            <div style={{ textAlign: 'center' }}>
              <h3 style={{ margin: '0 0 0.375rem', color: '#22c55e', fontSize: '1.125rem', fontWeight: 800 }}>Workflow Launched!</h3>
              <p style={{ color: '#71717a', margin: 0, fontSize: '0.875rem' }}>
                {createdCount} tasks created for <strong style={{ color: '#f4f4f5' }}>"{input}"</strong>
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.625rem', marginTop: '0.5rem' }}>
              <button
                onClick={() => { navigate('/tasks'); handleClose(); }}
                style={{
                  padding: '0.625rem 1.25rem', borderRadius: 10,
                  background: 'rgba(35,205,202,0.1)', border: '1px solid rgba(35,205,202,0.25)',
                  color: '#23CDCB', cursor: 'pointer', fontWeight: 700, fontSize: '0.875rem',
                  display: 'flex', alignItems: 'center', gap: '0.375rem',
                }}
              >
                View Tasks <ChevronRight size={14} />
              </button>
              <button
                onClick={() => { reset(); }}
                style={{
                  padding: '0.625rem 1.25rem', borderRadius: 10,
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                  color: '#a1a1aa', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem',
                }}
              >
                Launch Another
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Body: Template Grid */}
            <div style={{ flex: 1, overflow: 'auto', padding: '1.25rem 1.5rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
                {TEMPLATES.map(tpl => (
                  <TemplateCard key={tpl.id} tpl={tpl} selected={selectedId === tpl.id} onClick={() => handleSelect(tpl.id)} />
                ))}
              </div>

              {/* Input for selected template */}
              {selectedTpl && (
                <div style={{
                  padding: '1.25rem',
                  background: `${selectedTpl.color}08`,
                  border: `1px solid ${selectedTpl.color}25`,
                  borderRadius: 14,
                  animation: 'fadeIn 0.2s ease',
                }}>
                  <div style={{ marginBottom: '0.75rem' }}>
                    <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 700, color: '#f4f4f5', marginBottom: '0.375rem' }}>
                      {selectedTpl.inputLabel}
                    </label>
                    <input
                      autoFocus
                      value={input}
                      onChange={e => setInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && input.trim() && handleLaunch()}
                      placeholder={selectedTpl.inputPlaceholder}
                      style={{
                        width: '100%', padding: '0.625rem 0.875rem',
                        borderRadius: 10, fontSize: '0.9375rem',
                        background: 'rgba(255,255,255,0.04)',
                        border: `1px solid ${selectedTpl.color}30`,
                        color: '#f4f4f5', outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                    <p style={{ margin: '0.375rem 0 0', fontSize: '0.6875rem', color: '#52525b' }}>
                      This will create {selectedTpl.tasks.length} tasks in your board
                    </p>
                  </div>

                  {/* Task Preview */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                    {selectedTpl.tasks.map((t, i) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                        fontSize: '0.75rem', color: '#71717a',
                      }}>
                        <span style={{
                          width: 16, height: 16, borderRadius: '50%',
                          background: `${selectedTpl.color}20`, color: selectedTpl.color,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '0.5625rem', fontWeight: 800, flexShrink: 0,
                        }}>{i + 1}</span>
                        {t.titel.replace(/\{\{input\}\}/g, input.trim() || '…')}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{
              padding: '1rem 1.5rem',
              borderTop: '1px solid rgba(255,255,255,0.06)',
              display: 'flex', justifyContent: 'flex-end', gap: '0.625rem',
            }}>
              <button onClick={handleClose} style={{
                padding: '0.5rem 1rem', borderRadius: 8,
                background: 'none', border: '1px solid rgba(255,255,255,0.08)',
                color: '#71717a', cursor: 'pointer', fontSize: '0.875rem',
              }}>
                Cancel
              </button>
              <button
                onClick={handleLaunch}
                disabled={!selectedTpl || !input.trim() || launching}
                style={{
                  padding: '0.5rem 1.25rem', borderRadius: 8,
                  background: selectedTpl && input.trim() ? `${selectedTpl.color}20` : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${selectedTpl && input.trim() ? selectedTpl.color + '40' : 'rgba(255,255,255,0.08)'}`,
                  color: selectedTpl && input.trim() ? (selectedTpl.color) : '#52525b',
                  cursor: (!selectedTpl || !input.trim() || launching) ? 'not-allowed' : 'pointer',
                  fontSize: '0.875rem', fontWeight: 700,
                  display: 'flex', alignItems: 'center', gap: '0.375rem',
                  transition: 'all 0.2s',
                }}
              >
                {launching ? (
                  <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Launching…</>
                ) : (
                  <><Rocket size={14} /> Launch Workflow</>
                )}
              </button>
            </div>
          </>
        )}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes modalSlideUp {
          from { opacity: 0; transform: scale(0.95) translateY(20px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      ` }} />
    </div>
  );
}
