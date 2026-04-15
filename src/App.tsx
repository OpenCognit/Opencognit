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

function PageLoader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh' }}>
      <div style={{ width: 24, height: 24, borderRadius: '50%', border: '2px solid rgba(35,205,202,0.2)', borderTopColor: '#23CDCB', animation: 'spin 0.8s linear infinite' }} />
    </div>
  );
}

function ProtectedRoutes() {
  return (
    <BreadcrumbProvider>
      <CompanyProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/companies" element={<Suspense fallback={<PageLoader />}><Companies /></Suspense>} />
          <Route path="/experts" element={<Suspense fallback={<PageLoader />}><Experts /></Suspense>} />
          <Route path="/tasks" element={<Suspense fallback={<PageLoader />}><Tasks /></Suspense>} />
          <Route path="/org-chart" element={<Suspense fallback={<PageLoader />}><OrgChart /></Suspense>} />
          <Route path="/costs" element={<Suspense fallback={<PageLoader />}><Costs /></Suspense>} />
          <Route path="/approvals" element={<Suspense fallback={<PageLoader />}><Approvals /></Suspense>} />
          <Route path="/activity" element={<Suspense fallback={<PageLoader />}><Activity /></Suspense>} />
          <Route path="/projects" element={<Suspense fallback={<PageLoader />}><Projects /></Suspense>} />
          <Route path="/routines" element={<Suspense fallback={<PageLoader />}><Routines /></Suspense>} />
          <Route path="/meetings" element={<Suspense fallback={<PageLoader />}><Meetings /></Suspense>} />
          <Route path="/skill-library" element={<Suspense fallback={<PageLoader />}><SkillLibrary /></Suspense>} />
          <Route path="/intelligence" element={<Suspense fallback={<PageLoader />}><Intelligence /></Suspense>} />
          <Route path="/goals" element={<Suspense fallback={<PageLoader />}><Goals /></Suspense>} />
          <Route path="/performance" element={<Suspense fallback={<PageLoader />}><Performance /></Suspense>} />
          <Route path="/war-room" element={<Suspense fallback={<PageLoader />}><WarRoom /></Suspense>} />
          <Route path="/focus" element={<Suspense fallback={<PageLoader />}><Focus /></Suspense>} />
          <Route path="/weekly-report" element={<Suspense fallback={<PageLoader />}><WeeklyReport /></Suspense>} />
          <Route path="/clipmart" element={<Suspense fallback={<PageLoader />}><Clipmart /></Suspense>} />
          <Route path="/metrics" element={<Suspense fallback={<PageLoader />}><Metrics /></Suspense>} />
          <Route path="/work-products" element={<Suspense fallback={<PageLoader />}><WorkProducts /></Suspense>} />
          <Route path="/settings" element={<Suspense fallback={<PageLoader />}><Settings /></Suspense>} />
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
