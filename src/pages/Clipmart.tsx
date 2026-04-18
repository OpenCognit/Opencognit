import { useState, useEffect } from 'react';
import {
  Package, Download, Users, Clock, Search, Zap, CheckCircle,
  AlertTriangle, X, Star, Sparkles, Bot, Building2, ChevronRight,
} from 'lucide-react';
import { useCompany } from '../hooks/useCompany';
import { useI18n } from '../i18n';
import { authFetch } from '../utils/api';
import { useBreadcrumbs } from '../hooks/useBreadcrumbs';

// ── Types ──────────────────────────────────────────────────────────────────────

interface AgentRole { name: string; isOrchestrator: boolean; }

interface TemplateInfo {
  id: string;
  name: string;
  beschreibung: string;
  version: string;
  kategorie: 'automation' | 'team' | 'content' | 'dev' | 'research' | 'ecommerce' | 'integrations' | 'company';
  icon: string;
  accentColor: string;
  tags: string[];
  agentCount: number;
  routinenCount: number;
  configFields: Array<{ key: string; label: string; placeholder?: string; required: boolean; isSecret?: boolean }>;
  agentRoles: AgentRole[];
}

interface ImportResult {
  success: boolean;
  templateName: string;
  agentsCreated: number;
  skillsCreated: number;
  routinenCreated: number;
  errors: string[];
}

// ── Agent-only Category Config (no 'company') ─────────────────────────────────

const AGENT_CATEGORIES: Record<string, { label: string; labelDe: string; color: string }> = {
  all:          { label: 'All',          labelDe: 'Alle',          color: '#94a3b8' },
  integrations: { label: 'Integrations', labelDe: 'Integrationen', color: '#23CDCB' },
  automation:   { label: 'Automation',   labelDe: 'Automation',    color: '#06b6d4' },
  team:         { label: 'Teams',        labelDe: 'Teams',         color: '#6366f1' },
  content:      { label: 'Content',      labelDe: 'Content',       color: '#a855f7' },
  dev:          { label: 'Dev',          labelDe: 'Entwicklung',   color: '#3b82f6' },
  research:     { label: 'Research',     labelDe: 'Research',      color: '#f97316' },
  ecommerce:    { label: 'E-Commerce',   labelDe: 'E-Commerce',    color: '#22c55e' },
};

// ── Install Modal ──────────────────────────────────────────────────────────────

function InstallModal({
  template,
  unternehmenId,
  onClose,
  onSuccess,
}: {
  template: TemplateInfo;
  unternehmenId: string;
  onClose: () => void;
  onSuccess: (result: ImportResult) => void;
}) {
  const [config, setConfig] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleInstall = async () => {
    setImporting(true);
    setError(null);
    try {
      const res = await authFetch(`/api/unternehmen/${unternehmenId}/clipmart/import`, {
        method: 'POST',
        body: JSON.stringify({ templateId: template.id, config }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult(data);
        onSuccess(data);
      } else {
        setError(data.error || 'Import fehlgeschlagen');
      }
    } catch {
      setError('Verbindungsfehler');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: 520, maxHeight: '85vh', overflow: 'auto',
        background: 'rgba(18,18,24,0.98)',
        border: `1px solid ${template.accentColor}40`,
        borderRadius: 20, padding: '2rem',
        boxShadow: `0 0 60px ${template.accentColor}20`,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16, fontSize: 28,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: template.accentColor + '18', border: `1px solid ${template.accentColor}30`,
          }}>
            {template.icon}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#f1f5f9' }}>{template.name}</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{template.agentCount} Agents · {template.routinenCount} Routinen · v{template.version}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        {!result ? (
          <>
            <p style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.6, marginBottom: 24 }}>
              {template.beschreibung}
            </p>

            {/* Was wird installiert */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
              <div style={{ flex: 1, padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', textAlign: 'center' }}>
                <Bot size={18} style={{ color: template.accentColor, margin: '0 auto 6px' }} />
                <div style={{ fontSize: 20, fontWeight: 800, color: '#f1f5f9' }}>{template.agentCount}</div>
                <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Agents</div>
              </div>
              <div style={{ flex: 1, padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', textAlign: 'center' }}>
                <Clock size={18} style={{ color: '#f59e0b', margin: '0 auto 6px' }} />
                <div style={{ fontSize: 20, fontWeight: 800, color: '#f1f5f9' }}>{template.routinenCount}</div>
                <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Routinen</div>
              </div>
              <div style={{ flex: 1, padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', textAlign: 'center' }}>
                <Zap size={18} style={{ color: '#22c55e', margin: '0 auto 6px' }} />
                <div style={{ fontSize: 20, fontWeight: 800, color: '#f1f5f9' }}>1-Click</div>
                <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Install</div>
              </div>
            </div>

            {/* Team preview (company only) */}
            {template.kategorie === 'company' && template.agentRoles.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                  Team-Struktur
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {template.agentRoles.map(role => (
                    <span key={role.name} style={{
                      fontSize: 11, padding: '3px 10px', borderRadius: 20,
                      background: role.isOrchestrator ? template.accentColor + '22' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${role.isOrchestrator ? template.accentColor + '50' : 'rgba(255,255,255,0.08)'}`,
                      color: role.isOrchestrator ? template.accentColor : '#64748b',
                      fontWeight: role.isOrchestrator ? 700 : 400,
                    }}>
                      {role.isOrchestrator ? '★ ' : ''}{role.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Config fields */}
            {template.configFields.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
                  Konfiguration
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {template.configFields.map(field => (
                    <div key={field.key}>
                      <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 5 }}>
                        {field.label} {field.required && <span style={{ color: '#ef4444' }}>*</span>}
                      </label>
                      <input
                        type={field.isSecret ? 'password' : 'text'}
                        value={config[field.key] || ''}
                        onChange={e => setConfig(c => ({ ...c, [field.key]: e.target.value }))}
                        placeholder={field.placeholder || ''}
                        style={{
                          width: '100%', padding: '8px 12px',
                          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: 8, color: '#f1f5f9', fontSize: 13, outline: 'none',
                          fontFamily: field.isSecret ? 'monospace' : 'inherit',
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <div style={{ marginBottom: 16, padding: '10px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', fontSize: 13 }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={{ padding: '9px 18px', borderRadius: 10, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', cursor: 'pointer', fontSize: 13 }}>
                Abbrechen
              </button>
              <button
                onClick={handleInstall}
                disabled={importing || template.configFields.some(f => f.required && !config[f.key]?.trim())}
                style={{
                  padding: '9px 20px', borderRadius: 10, fontWeight: 700, fontSize: 13,
                  background: `linear-gradient(135deg, ${template.accentColor}, ${template.accentColor}99)`,
                  border: 'none', color: '#000', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 8,
                  opacity: importing ? 0.7 : 1,
                }}
              >
                <Download size={15} />
                {importing ? 'Installiere...' : 'Installieren'}
              </button>
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            {result.success ? (
              <CheckCircle size={48} style={{ color: '#22c55e', margin: '0 auto 16px' }} />
            ) : (
              <AlertTriangle size={48} style={{ color: '#ef4444', margin: '0 auto 16px' }} />
            )}
            <div style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9', marginBottom: 8 }}>
              {result.success ? '✅ Erfolgreich installiert!' : 'Installation mit Problemen'}
            </div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 20 }}>
              {result.agentsCreated} Agents · {result.skillsCreated} Skills · {result.routinenCreated} Routinen erstellt
            </div>
            {result.errors.length > 0 && (
              <div style={{ fontSize: 12, color: '#fca5a5', textAlign: 'left', marginBottom: 16 }}>
                {result.errors.map((e, i) => <div key={i}>• {e}</div>)}
              </div>
            )}
            <button onClick={onClose} style={{ padding: '9px 24px', borderRadius: 10, background: `${template.accentColor}22`, border: `1px solid ${template.accentColor}40`, color: template.accentColor, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
              Schließen
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Company Blueprint Card ─────────────────────────────────────────────────────

function BlueprintCard({ template, onInstall, de }: { template: TemplateInfo; onInstall: () => void; de: boolean }) {
  return (
    <div
      style={{
        borderRadius: 20, padding: '24px',
        background: `linear-gradient(135deg, ${template.accentColor}08 0%, rgba(255,255,255,0.02) 100%)`,
        border: `1px solid ${template.accentColor}25`,
        display: 'flex', flexDirection: 'column', gap: 16,
        transition: 'all 0.2s ease', cursor: 'default',
        position: 'relative', overflow: 'hidden',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.border = `1px solid ${template.accentColor}55`;
        (e.currentTarget as HTMLElement).style.background = `linear-gradient(135deg, ${template.accentColor}12 0%, rgba(255,255,255,0.03) 100%)`;
        (e.currentTarget as HTMLElement).style.boxShadow = `0 8px 32px ${template.accentColor}15`;
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.border = `1px solid ${template.accentColor}25`;
        (e.currentTarget as HTMLElement).style.background = `linear-gradient(135deg, ${template.accentColor}08 0%, rgba(255,255,255,0.02) 100%)`;
        (e.currentTarget as HTMLElement).style.boxShadow = 'none';
      }}
    >
      {/* Glow orb */}
      <div style={{
        position: 'absolute', top: -40, right: -40, width: 140, height: 140,
        borderRadius: '50%', background: `radial-gradient(circle, ${template.accentColor}18 0%, transparent 70%)`,
        pointerEvents: 'none',
      }} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <div style={{
          width: 56, height: 56, borderRadius: 16, fontSize: 28, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: template.accentColor + '20', border: `1px solid ${template.accentColor}40`,
        }}>
          {template.icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#f1f5f9', marginBottom: 4 }}>{template.name}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, color: template.accentColor, fontWeight: 700 }}>
              <Users size={11} /> {template.agentCount} Agents
            </span>
            {template.routinenCount > 0 && (
              <span style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, color: '#f59e0b', fontWeight: 600 }}>
                <Clock size={11} /> {template.routinenCount} Routinen
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Description */}
      <p style={{ fontSize: 12, color: '#64748b', lineHeight: 1.65, margin: 0 }}>
        {template.beschreibung}
      </p>

      {/* Team chips */}
      {template.agentRoles.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {template.agentRoles.map(role => (
            <span key={role.name} style={{
              fontSize: 10, padding: '2px 9px', borderRadius: 20,
              background: role.isOrchestrator ? template.accentColor + '20' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${role.isOrchestrator ? template.accentColor + '45' : 'rgba(255,255,255,0.08)'}`,
              color: role.isOrchestrator ? template.accentColor : '#475569',
              fontWeight: role.isOrchestrator ? 700 : 400,
            }}>
              {role.isOrchestrator ? '★ ' : ''}{role.name}
            </span>
          ))}
        </div>
      )}

      {/* Tags */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {template.tags.slice(0, 5).map(tag => (
          <span key={tag} style={{
            fontSize: 10, padding: '2px 7px', borderRadius: 5,
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
            color: '#334155',
          }}>
            {tag}
          </span>
        ))}
      </div>

      {/* Install button */}
      <div style={{ marginTop: 'auto' }}>
        <button
          onClick={onInstall}
          style={{
            width: '100%', padding: '10px', borderRadius: 12, fontWeight: 700, fontSize: 13,
            background: `linear-gradient(135deg, ${template.accentColor}22, ${template.accentColor}10)`,
            border: `1px solid ${template.accentColor}45`,
            color: template.accentColor, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.background = template.accentColor;
            (e.currentTarget as HTMLElement).style.color = '#000';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.background = `linear-gradient(135deg, ${template.accentColor}22, ${template.accentColor}10)`;
            (e.currentTarget as HTMLElement).style.color = template.accentColor;
          }}
        >
          <Download size={13} />
          {de ? 'Blueprint installieren' : 'Install Blueprint'}
        </button>
      </div>
    </div>
  );
}

// ── Agent Template Card ────────────────────────────────────────────────────────

function AgentCard({ template, onInstall, de }: { template: TemplateInfo; onInstall: () => void; de: boolean }) {
  const cat = AGENT_CATEGORIES[template.kategorie] || AGENT_CATEGORIES.all;

  return (
    <div
      style={{
        borderRadius: 16, padding: '18px',
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.07)',
        display: 'flex', flexDirection: 'column', gap: 12,
        transition: 'all 0.2s ease', cursor: 'default',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.border = `1px solid ${template.accentColor}50`;
        (e.currentTarget as HTMLElement).style.background = `${template.accentColor}06`;
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.border = '1px solid rgba(255,255,255,0.07)';
        (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.02)';
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{
          width: 42, height: 42, borderRadius: 12, fontSize: 20, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: template.accentColor + '18', border: `1px solid ${template.accentColor}30`,
        }}>
          {template.icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9', marginBottom: 3 }}>{template.name}</div>
          <span style={{
            fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 20,
            background: cat.color + '18', color: cat.color, border: `1px solid ${cat.color}30`,
            textTransform: 'uppercase', letterSpacing: '0.08em',
          }}>
            {de ? cat.labelDe : cat.label}
          </span>
        </div>
      </div>

      {/* Description */}
      <p style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6, margin: 0 }}>
        {template.beschreibung}
      </p>

      {/* Tags */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {template.tags.slice(0, 4).map(tag => (
          <span key={tag} style={{
            fontSize: 10, padding: '2px 7px', borderRadius: 5,
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
            color: '#475569',
          }}>
            {tag}
          </span>
        ))}
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 'auto' }}>
        <span style={{ fontSize: 11, color: '#475569', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Users size={10} /> {template.agentCount}
        </span>
        {template.routinenCount > 0 && (
          <span style={{ fontSize: 11, color: '#475569', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Clock size={10} /> {template.routinenCount}
          </span>
        )}
        <button
          onClick={onInstall}
          style={{
            marginLeft: 'auto', padding: '6px 14px', borderRadius: 9, fontWeight: 700, fontSize: 11,
            background: `${template.accentColor}18`, border: `1px solid ${template.accentColor}40`,
            color: template.accentColor, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 5,
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.background = template.accentColor;
            (e.currentTarget as HTMLElement).style.color = '#000';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.background = `${template.accentColor}18`;
            (e.currentTarget as HTMLElement).style.color = template.accentColor;
          }}
        >
          <Download size={11} />
          {de ? 'Installieren' : 'Install'}
        </button>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export function Clipmart() {
  const { aktivesUnternehmen } = useCompany();
  const { language } = useI18n();
  const de = language === 'de';
  useBreadcrumbs([de ? 'CognitHub' : 'CognitHub']);

  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeKat, setActiveKat] = useState('all');
  const [installing, setInstalling] = useState<TemplateInfo | null>(null);
  const [lastResult, setLastResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    authFetch('/api/clipmart/templates')
      .then(r => r.json())
      .then(data => { setTemplates(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const companyTemplates = templates.filter(t => t.kategorie === 'company');
  const agentTemplates = templates.filter(t => t.kategorie !== 'company');

  const filteredAgents = agentTemplates.filter(t => {
    const matchKat = activeKat === 'all' || t.kategorie === activeKat;
    const q = search.toLowerCase();
    const matchSearch = !q || t.name.toLowerCase().includes(q) || t.beschreibung.toLowerCase().includes(q) || t.tags.some(tag => tag.includes(q));
    return matchKat && matchSearch;
  });

  // company search filter (search bar affects both sections)
  const filteredCompany = companyTemplates.filter(t => {
    const q = search.toLowerCase();
    return !q || t.name.toLowerCase().includes(q) || t.beschreibung.toLowerCase().includes(q) || t.tags.some(tag => tag.includes(q));
  });

  return (
    <div style={{ padding: '2rem', maxWidth: 1200, margin: '0 auto' }}>

      {/* ── Hero ── */}
      <div style={{
        borderRadius: 24, padding: '2.5rem', marginBottom: '2rem',
        background: 'linear-gradient(135deg, rgba(35,205,203,0.08) 0%, rgba(168,85,247,0.06) 100%)',
        border: '1px solid rgba(35,205,203,0.15)',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -60, right: -60, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle, rgba(35,205,203,0.12) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(35,205,203,0.15)', border: '1px solid rgba(35,205,203,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Package size={22} style={{ color: '#23CDCB' }} />
          </div>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 900, margin: 0, background: 'linear-gradient(135deg, #23CDCB, #a855f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              CognitHub
            </h1>
            <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
              {de ? 'Company Blueprints & Agent Templates — One-Click installieren' : 'Company Blueprints & Agent Templates — install in one click'}
            </p>
          </div>
        </div>

        <p style={{ fontSize: 14, color: '#94a3b8', lineHeight: 1.7, maxWidth: 600, margin: '0 0 20px' }}>
          {de
            ? `${companyTemplates.length} fertige Unternehmensstrukturen + ${agentTemplates.length} spezialisierte Agents — vorkonfiguriert, sofort einsatzbereit.`
            : `${companyTemplates.length} ready-made company structures + ${agentTemplates.length} specialized agents — pre-configured, ready to run.`}
        </p>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {[
            { icon: <Building2 size={13} />, label: de ? 'Komplette Teams' : 'Full teams', color: '#f59e0b' },
            { icon: <Zap size={13} />, label: de ? 'Sofort einsatzbereit' : 'Ready to run', color: '#22c55e' },
            { icon: <Bot size={13} />, label: de ? 'Agents vorkonfiguriert' : 'Agents pre-configured', color: '#23CDCB' },
            { icon: <Sparkles size={13} />, label: de ? 'Skills & Prompts optimiert' : 'Skills & prompts optimized', color: '#a855f7' },
          ].map((badge, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 20, background: badge.color + '12', border: `1px solid ${badge.color}30`, color: badge.color, fontSize: 12, fontWeight: 600 }}>
              {badge.icon} {badge.label}
            </div>
          ))}
        </div>
      </div>

      {/* ── Last Install Toast ── */}
      {lastResult && lastResult.success && (
        <div style={{
          marginBottom: '1.5rem', padding: '12px 16px', borderRadius: 12,
          background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <CheckCircle size={16} style={{ color: '#22c55e', flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: '#86efac', flex: 1 }}>
            <strong>{lastResult.templateName}</strong> installiert — {lastResult.agentsCreated} Agents, {lastResult.routinenCreated} Routinen angelegt.
            {lastResult.routinenCreated > 0 && ' Routinen sind aktiv und starten automatisch.'}
          </span>
          <button onClick={() => setLastResult(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569' }}>
            <X size={14} />
          </button>
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4rem', gap: 12 }}>
          <div style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid rgba(35,205,202,0.2)', borderTopColor: '#23CDCB', animation: 'spin 0.8s linear infinite' }} />
          <span style={{ fontSize: 13, color: '#475569' }}>{de ? 'Lade Templates...' : 'Loading templates...'}</span>
        </div>
      ) : (
        <>
          {/* ── Company Blueprints Section ── */}
          {(filteredCompany.length > 0 || !search) && (
            <div style={{ marginBottom: '2.5rem' }}>
              {/* Section header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Building2 size={18} style={{ color: '#f59e0b' }} />
                  <span style={{ fontSize: 16, fontWeight: 800, color: '#f1f5f9' }}>
                    {de ? 'Company Blueprints' : 'Company Blueprints'}
                  </span>
                  <span style={{
                    fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 20,
                    background: '#f59e0b18', color: '#f59e0b', border: '1px solid #f59e0b30',
                  }}>
                    {filteredCompany.length}
                  </span>
                </div>
                <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.05)' }} />
                <span style={{ fontSize: 11, color: '#475569' }}>
                  {de ? 'Komplette Team-Strukturen, sofort einsatzbereit' : 'Complete team structures, ready to deploy'}
                </span>
              </div>

              {filteredCompany.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: '#475569', fontSize: 13 }}>
                  {de ? 'Keine Blueprints gefunden' : 'No blueprints found'}
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 16 }}>
                  {filteredCompany.map(t => (
                    <BlueprintCard key={t.id} template={t} de={de} onInstall={() => setInstalling(t)} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Agent Templates Section ── */}
          <div>
            {/* Section header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Bot size={18} style={{ color: '#23CDCB' }} />
                <span style={{ fontSize: 16, fontWeight: 800, color: '#f1f5f9' }}>
                  {de ? 'Agent Templates' : 'Agent Templates'}
                </span>
                <span style={{
                  fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 20,
                  background: '#23CDCB18', color: '#23CDCB', border: '1px solid #23CDCB30',
                }}>
                  {filteredAgents.length}
                </span>
              </div>
              <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.05)' }} />
            </div>

            {/* Filter + Search */}
            <div style={{ display: 'flex', gap: 12, marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {Object.entries(AGENT_CATEGORIES).map(([key, cat]) => (
                  <button
                    key={key}
                    onClick={() => setActiveKat(key)}
                    style={{
                      padding: '5px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      background: activeKat === key ? cat.color + '22' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${activeKat === key ? cat.color + '60' : 'rgba(255,255,255,0.07)'}`,
                      color: activeKat === key ? cat.color : '#64748b',
                      transition: 'all 0.15s',
                    }}
                  >
                    {de ? cat.labelDe : cat.label}
                  </button>
                ))}
              </div>

              <div style={{ marginLeft: 'auto', position: 'relative' }}>
                <Search size={12} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#475569' }} />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={de ? 'Suchen...' : 'Search...'}
                  style={{
                    padding: '6px 12px 6px 28px', borderRadius: 9, fontSize: 12,
                    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                    color: '#f1f5f9', outline: 'none', width: 180,
                  }}
                />
              </div>
            </div>

            {filteredAgents.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem', color: '#475569' }}>
                <Package size={36} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
                <div style={{ fontSize: 13 }}>{de ? 'Keine Templates gefunden' : 'No templates found'}</div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
                {filteredAgents.map(t => (
                  <AgentCard key={t.id} template={t} de={de} onInstall={() => setInstalling(t)} />
                ))}
              </div>
            )}
          </div>

          {/* ── Coming Soon ── */}
          <div style={{
            marginTop: '2.5rem', padding: '1.5rem', borderRadius: 16,
            background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.08)',
            textAlign: 'center',
          }}>
            <Star size={18} style={{ color: '#475569', margin: '0 auto 8px' }} />
            <div style={{ fontSize: 13, color: '#475569', marginBottom: 4 }}>
              Community Marketplace — coming soon
            </div>
            <div style={{ fontSize: 12, color: '#334155' }}>
              {de
                ? 'Bald kannst du eigene Templates erstellen und mit anderen teilen'
                : "Soon you'll be able to create and share your own templates"}
            </div>
          </div>
        </>
      )}

      {/* ── Install Modal ── */}
      {installing && aktivesUnternehmen && (
        <InstallModal
          template={installing}
          unternehmenId={aktivesUnternehmen.id}
          onClose={() => setInstalling(null)}
          onSuccess={result => {
            setLastResult(result);
            setInstalling(null);
          }}
        />
      )}
    </div>
  );
}
