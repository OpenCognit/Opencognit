import React, { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { LoginPage } from './components/ui/login-page';
import { ToastProvider } from './components/ToastProvider';
import { CompanyProvider } from './hooks/useCompany';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { useSystemStatus } from './hooks/useSystemStatus';
import { OnboardingWizard } from './components/OnboardingWizard';
import { BreadcrumbProvider } from './hooks/useBreadcrumbs';
import { ErrorBoundary } from './components/ErrorBoundary';

// Apply saved theme before first render
const savedTheme = localStorage.getItem('opencognit_theme');
if (savedTheme === 'light') document.documentElement.setAttribute('data-theme', 'light');

// Lazy-load all secondary pages to reduce initial bundle
const Companies   = lazy(() => import('./pages/Companies').then(m => ({ default: m.Companies })));
const Experts     = lazy(() => import('./pages/Experts').then(m => ({ default: m.Experts })));
const Tasks       = lazy(() => import('./pages/Tasks').then(m => ({ default: m.Tasks })));
const OrgChart    = lazy(() => import('./pages/OrgChart').then(m => ({ default: m.OrgChart })));
const Costs       = lazy(() => import('./pages/Costs').then(m => ({ default: m.Costs })));
const Approvals   = lazy(() => import('./pages/Approvals').then(m => ({ default: m.Approvals })));
const Activity    = lazy(() => import('./pages/Activity').then(m => ({ default: m.Activity })));
const Settings    = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })));
const Routines    = lazy(() => import('./pages/Routines').then(m => ({ default: m.Routines })));
const Projects    = lazy(() => import('./pages/Projects').then(m => ({ default: m.Projects })));
const Meetings    = lazy(() => import('./pages/Meetings').then(m => ({ default: m.Meetings })));
const SkillLibrary= lazy(() => import('./pages/SkillLibrary').then(m => ({ default: m.SkillLibrary })));
const Intelligence= lazy(() => import('./pages/Intelligence').then(m => ({ default: m.Intelligence })));
const Goals       = lazy(() => import('./pages/Goals').then(m => ({ default: m.Goals })));
const Performance = lazy(() => import('./pages/Performance').then(m => ({ default: m.Performance })));
const WarRoom     = lazy(() => import('./pages/WarRoom').then(m => ({ default: m.WarRoom })));
const Focus        = lazy(() => import('./pages/Focus'));
const WeeklyReport = lazy(() => import('./pages/WeeklyReport').then(m => ({ default: m.WeeklyReport })));
const Clipmart     = lazy(() => import('./pages/Clipmart').then(m => ({ default: m.Clipmart })));
const Metrics      = lazy(() => import('./pages/Metrics').then(m => ({ default: m.Metrics })));
const WorkProducts = lazy(() => import('./pages/WorkProducts').then(m => ({ default: m.WorkProducts })));
const TaskTimeline = lazy(() => import('./pages/TaskTimeline').then(m => ({ default: m.TaskTimeline })));
const Plugins      = lazy(() => import('./pages/Plugins').then(m => ({ default: m.Plugins })));
const WorkerNodes  = lazy(() => import('./pages/WorkerNodes').then(m => ({ default: m.WorkerNodes })));

function PageLoader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh' }}>
      <div style={{ width: 24, height: 24, borderRadius: '50%', border: '2px solid rgba(35,205,202,0.2)', borderTopColor: '#23CDCB', animation: 'spin 0.8s linear infinite' }} />
    </div>
  );
}

function PageErrorFallback() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: '50vh', padding: '2rem', textAlign: 'center', gap: '1rem',
    }}>
      <div style={{ fontSize: '2.5rem' }}>⚠️</div>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>
        Diese Seite konnte nicht geladen werden
      </h2>
      <p style={{ color: 'var(--muted-foreground)', fontSize: '0.875rem', maxWidth: 420, margin: 0 }}>
        Ein unerwarteter Fehler ist aufgetreten. Andere Seiten funktionieren weiterhin — versuche es neu zu laden oder wechsle über die Seitenleiste.
      </p>
      <button className="btn btn-primary" onClick={() => window.location.reload()}>
        Seite neu laden
      </button>
    </div>
  );
}

// Per-route wrapper: catches render errors + shows lazy-load spinner.
// Keeps Layout/Sidebar/navigation alive if a single page crashes.
function Page({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary fallback={<PageErrorFallback />}>
      <Suspense fallback={<PageLoader />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

function ProtectedRoutes() {
  return (
    <BreadcrumbProvider>
      <CompanyProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<ErrorBoundary fallback={<PageErrorFallback />}><Dashboard /></ErrorBoundary>} />
          <Route path="/companies" element={<Page><Companies /></Page>} />
          <Route path="/experts" element={<Page><Experts /></Page>} />
          <Route path="/tasks" element={<Page><Tasks /></Page>} />
          <Route path="/org-chart" element={<Page><OrgChart /></Page>} />
          <Route path="/costs" element={<Page><Costs /></Page>} />
          <Route path="/approvals" element={<Page><Approvals /></Page>} />
          <Route path="/activity" element={<Page><Activity /></Page>} />
          <Route path="/projects" element={<Page><Projects /></Page>} />
          <Route path="/routines" element={<Page><Routines /></Page>} />
          <Route path="/meetings" element={<Page><Meetings /></Page>} />
          <Route path="/skill-library" element={<Page><SkillLibrary /></Page>} />
          <Route path="/intelligence" element={<Page><Intelligence /></Page>} />
          <Route path="/goals" element={<Page><Goals /></Page>} />
          <Route path="/performance" element={<Page><Performance /></Page>} />
          <Route path="/war-room" element={<Page><WarRoom /></Page>} />
          <Route path="/focus" element={<Page><Focus /></Page>} />
          <Route path="/weekly-report" element={<Page><WeeklyReport /></Page>} />
          <Route path="/clipmart" element={<Page><Clipmart /></Page>} />
          <Route path="/metrics" element={<Page><Metrics /></Page>} />
          <Route path="/work-products" element={<Page><WorkProducts /></Page>} />
          <Route path="/tasks/:id/timeline" element={<Page><TaskTimeline /></Page>} />
          <Route path="/plugins" element={<Page><Plugins /></Page>} />
          <Route path="/workers" element={<Page><WorkerNodes /></Page>} />
          <Route path="/settings" element={<Page><Settings /></Page>} />
          {/* Legacy German routes — redirect to English */}
          <Route path="/unternehmen" element={<Navigate to="/companies" replace />} />
          <Route path="/experten" element={<Navigate to="/experts" replace />} />
          <Route path="/aufgaben" element={<Navigate to="/tasks" replace />} />
          <Route path="/organigramm" element={<Navigate to="/org-chart" replace />} />
          <Route path="/kosten" element={<Navigate to="/costs" replace />} />
          <Route path="/genehmigungen" element={<Navigate to="/approvals" replace />} />
          <Route path="/aktivitaet" element={<Navigate to="/activity" replace />} />
          <Route path="/projekte" element={<Navigate to="/projects" replace />} />
          <Route path="/routinen" element={<Navigate to="/routines" replace />} />
          <Route path="/einstellungen" element={<Navigate to="/settings" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </CompanyProvider>
  </BreadcrumbProvider>
  );
}

function AppInner() {
  const { needsSetup, brauchtRegistrierung, isLoading, error } = useSystemStatus();
  const { istAngemeldet, laden: authLaden } = useAuth();

  if (isLoading || authLaden) return (
    <div className="app-layout" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span className="text-muted">Loading OpenCognit OS...</span>
    </div>
  );

  if (error) return (
    <div className="app-layout" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ color: 'var(--color-error)' }}>{error}</span>
    </div>
  );

  if (!istAngemeldet) return <LoginPage erstesKonto={brauchtRegistrierung} />;

  if (needsSetup) return <OnboardingWizard />;

  return <ProtectedRoutes />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/*" element={
          <AuthProvider>
            <ToastProvider>
              <AppInner />
            </ToastProvider>
          </AuthProvider>
        } />


      </Routes>
    </BrowserRouter>
  );
}
