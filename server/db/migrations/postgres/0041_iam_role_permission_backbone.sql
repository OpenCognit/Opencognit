-- Migration 0041: PR-IAM-1 — Role and Permission Backbone
-- Domain: Identity, Access, Tenant & Audit Control Room
-- Classification: Greenfield schema introduction
-- ADR: ADR-0041-IAM-ROLE-PERMISSION-BACKBONE
-- IC: IC-0041-IAM-ROLE-PERMISSION-BACKBONE
-- Baseline: 42ad144

-- ─── 1. roles ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  unternehmen_id TEXT REFERENCES unternehmen(id),
  name TEXT NOT NULL,
  beschreibung TEXT,
  ist_system INTEGER NOT NULL DEFAULT 0,
  erstellt_am TEXT NOT NULL,
  aktualisiert_am TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_roles_company ON roles(unternehmen_id);

-- ─── 2. permissions ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  action TEXT NOT NULL,
  resource TEXT,
  beschreibung TEXT,
  erstellt_am TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_permissions_module ON permissions(module);
CREATE INDEX IF NOT EXISTS idx_permissions_module_action ON permissions(module, action);

-- ─── 3. role_permissions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id),
  permission_id TEXT NOT NULL REFERENCES permissions(id),
  PRIMARY KEY (role_id, permission_id)
);

-- ─── 4. project_users ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_users (
  id TEXT PRIMARY KEY,
  projekt_id TEXT NOT NULL REFERENCES projekte(id),
  benutzer_id TEXT NOT NULL REFERENCES benutzer(id),
  role_id TEXT NOT NULL REFERENCES roles(id),
  status TEXT NOT NULL DEFAULT 'active',
  zugewiesen_von TEXT,
  zugewiesen_am TEXT NOT NULL,
  erstellt_am TEXT NOT NULL,
  aktualisiert_am TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_users_project ON project_users(projekt_id);
CREATE INDEX IF NOT EXISTS idx_project_users_user ON project_users(benutzer_id);
CREATE INDEX IF NOT EXISTS idx_project_users_role ON project_users(role_id);

-- ─── 5. user_tenant_roles ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_tenant_roles (
  id TEXT PRIMARY KEY,
  benutzer_id TEXT NOT NULL REFERENCES benutzer(id),
  unternehmen_id TEXT NOT NULL REFERENCES unternehmen(id),
  role_id TEXT NOT NULL REFERENCES roles(id),
  ist_primary INTEGER NOT NULL DEFAULT 0,
  erstellt_am TEXT NOT NULL,
  aktualisiert_am TEXT NOT NULL,
  UNIQUE (benutzer_id, unternehmen_id, role_id)
);
CREATE INDEX IF NOT EXISTS idx_user_tenant_roles_user ON user_tenant_roles(benutzer_id);
CREATE INDEX IF NOT EXISTS idx_user_tenant_roles_company ON user_tenant_roles(unternehmen_id);

-- ─── Seed: system roles ───────────────────────────────────────────────────────
INSERT INTO roles ON CONFLICT (id) DO NOTHING (id, unternehmen_id, name, beschreibung, ist_system, erstellt_am, aktualisiert_am) VALUES ('role-tenant-admin', NULL, 'tenant_admin', 'Full access to all modules and actions within the tenant', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
INSERT INTO roles ON CONFLICT (id) DO NOTHING (id, unternehmen_id, name, beschreibung, ist_system, erstellt_am, aktualisiert_am) VALUES ('role-director', NULL, 'director', 'View all, approve finance/IPC/procurement', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
INSERT INTO roles ON CONFLICT (id) DO NOTHING (id, unternehmen_id, name, beschreibung, ist_system, erstellt_am, aktualisiert_am) VALUES ('role-finance-admin', NULL, 'finance_admin', 'Full finance access, view other modules', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
INSERT INTO roles ON CONFLICT (id) DO NOTHING (id, unternehmen_id, name, beschreibung, ist_system, erstellt_am, aktualisiert_am) VALUES ('role-pm', NULL, 'project_manager', 'Full project control, workforce, equipment, document approval', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
INSERT INTO roles ON CONFLICT (id) DO NOTHING (id, unternehmen_id, name, beschreibung, ist_system, erstellt_am, aktualisiert_am) VALUES ('role-site-engineer', NULL, 'site_engineer', 'Task management, workforce assignment, HSE reporting', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
INSERT INTO roles ON CONFLICT (id) DO NOTHING (id, unternehmen_id, name, beschreibung, ist_system, erstellt_am, aktualisiert_am) VALUES ('role-qs', NULL, 'qs', 'IPC management, finance viewing', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
INSERT INTO roles ON CONFLICT (id) DO NOTHING (id, unternehmen_id, name, beschreibung, ist_system, erstellt_am, aktualisiert_am) VALUES ('role-storekeeper', NULL, 'storekeeper', 'Procurement creation, workforce viewing', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
INSERT INTO roles ON CONFLICT (id) DO NOTHING (id, unternehmen_id, name, beschreibung, ist_system, erstellt_am, aktualisiert_am) VALUES ('role-foreman', NULL, 'foreman', 'Workforce assignment, task viewing, equipment viewing', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
INSERT INTO roles ON CONFLICT (id) DO NOTHING (id, unternehmen_id, name, beschreibung, ist_system, erstellt_am, aktualisiert_am) VALUES ('role-hse', NULL, 'hse_officer', 'Full HSE access, task viewing', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
INSERT INTO roles ON CONFLICT (id) DO NOTHING (id, unternehmen_id, name, beschreibung, ist_system, erstellt_am, aktualisiert_am) VALUES ('role-procurement', NULL, 'procurement_officer', 'Full procurement access', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
INSERT INTO roles ON CONFLICT (id) DO NOTHING (id, unternehmen_id, name, beschreibung, ist_system, erstellt_am, aktualisiert_am) VALUES ('role-doc-controller', NULL, 'document_controller', 'Full document access', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
INSERT INTO roles ON CONFLICT (id) DO NOTHING (id, unternehmen_id, name, beschreibung, ist_system, erstellt_am, aktualisiert_am) VALUES ('role-viewer', NULL, 'viewer', 'View-only access to all modules', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
INSERT INTO roles ON CONFLICT (id) DO NOTHING (id, unternehmen_id, name, beschreibung, ist_system, erstellt_am, aktualisiert_am) VALUES ('role-auditor', NULL, 'auditor', 'View and export all modules', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

-- ─── Seed: permissions ────────────────────────────────────────────────────────
-- companies
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-companies-view', 'companies', 'view', 'View companies', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-companies-create', 'companies', 'create', 'Create companies', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-companies-edit', 'companies', 'edit', 'Edit companies', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-companies-delete', 'companies', 'delete', 'Delete companies', '2026-01-01T00:00:00Z');
-- projects
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-projects-view', 'projects', 'view', 'View projects', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-projects-create', 'projects', 'create', 'Create projects', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-projects-edit', 'projects', 'edit', 'Edit projects', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-projects-archive', 'projects', 'archive', 'Archive projects', '2026-01-01T00:00:00Z');
-- tasks
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-tasks-view', 'tasks', 'view', 'View tasks', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-tasks-create', 'tasks', 'create', 'Create tasks', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-tasks-edit', 'tasks', 'edit', 'Edit tasks', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-tasks-assign', 'tasks', 'assign', 'Assign tasks', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-tasks-close', 'tasks', 'close', 'Close tasks', '2026-01-01T00:00:00Z');
-- agents
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-agents-view', 'agents', 'view', 'View agents', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-agents-create', 'agents', 'create', 'Create agents', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-agents-edit', 'agents', 'edit', 'Edit agents', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-agents-disable', 'agents', 'disable', 'Disable agents', '2026-01-01T00:00:00Z');
-- documents
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-documents-view', 'documents', 'view', 'View documents', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-documents-create', 'documents', 'create', 'Create documents', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-documents-edit', 'documents', 'edit', 'Edit documents', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-documents-approve', 'documents', 'approve', 'Approve documents', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-documents-delete', 'documents', 'delete', 'Delete documents', '2026-01-01T00:00:00Z');
-- finance
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-finance-view', 'finance', 'view', 'View finance', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-finance-create', 'finance', 'create', 'Create finance entries', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-finance-edit', 'finance', 'edit', 'Edit finance entries', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-finance-submit', 'finance', 'submit', 'Submit finance entries', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-finance-approve', 'finance', 'approve', 'Approve finance entries', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-finance-reject', 'finance', 'reject', 'Reject finance entries', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-finance-export', 'finance', 'export', 'Export finance data', '2026-01-01T00:00:00Z');
-- ipc
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-ipc-view', 'ipc', 'view', 'View IPC', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-ipc-create', 'ipc', 'create', 'Create IPC entries', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-ipc-edit', 'ipc', 'edit', 'Edit IPC entries', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-ipc-submit', 'ipc', 'submit', 'Submit IPC entries', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-ipc-approve', 'ipc', 'approve', 'Approve IPC entries', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-ipc-reject', 'ipc', 'reject', 'Reject IPC entries', '2026-01-01T00:00:00Z');
-- procurement
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-procurement-view', 'procurement', 'view', 'View procurement', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-procurement-create', 'procurement', 'create', 'Create procurement entries', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-procurement-edit', 'procurement', 'edit', 'Edit procurement entries', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-procurement-submit', 'procurement', 'submit', 'Submit procurement entries', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-procurement-approve', 'procurement', 'approve', 'Approve procurement entries', '2026-01-01T00:00:00Z');
-- workforce
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-workforce-view', 'workforce', 'view', 'View workforce', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-workforce-create', 'workforce', 'create', 'Create workforce entries', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-workforce-edit', 'workforce', 'edit', 'Edit workforce entries', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-workforce-assign', 'workforce', 'assign', 'Assign workforce', '2026-01-01T00:00:00Z');
-- equipment
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-equipment-view', 'equipment', 'view', 'View equipment', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-equipment-create', 'equipment', 'create', 'Create equipment entries', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-equipment-edit', 'equipment', 'edit', 'Edit equipment entries', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-equipment-transfer', 'equipment', 'transfer', 'Transfer equipment', '2026-01-01T00:00:00Z');
-- hse
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-hse-view', 'hse', 'view', 'View HSE', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-hse-create', 'hse', 'create', 'Create HSE entries', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-hse-edit', 'hse', 'edit', 'Edit HSE entries', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-hse-escalate', 'hse', 'escalate', 'Escalate HSE issues', '2026-01-01T00:00:00Z');
-- admin
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-admin-view', 'admin', 'view', 'View admin', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-admin-create', 'admin', 'create', 'Create admin entries', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-admin-edit', 'admin', 'edit', 'Edit admin entries', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-admin-override', 'admin', 'override', 'Override system', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-admin-export', 'admin', 'export', 'Export admin data', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-admin-delete', 'admin', 'delete', 'Delete admin entries', '2026-01-01T00:00:00Z');
-- audit
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-audit-view', 'audit', 'view', 'View audit log', '2026-01-01T00:00:00Z');
INSERT INTO permissions ON CONFLICT (id) DO NOTHING (id, module, action, beschreibung, erstellt_am) VALUES ('perm-audit-export', 'audit', 'export', 'Export audit log', '2026-01-01T00:00:00Z');

-- ─── Seed: role_permissions (admin gets everything via backward compat, not mapped here) ───
-- tenant_admin: gets all permissions via admin bypass in middleware — no rows needed
-- director: view all + approve finance/ipc/procurement
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-director', 'perm-finance-view');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-director', 'perm-finance-approve');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-director', 'perm-ipc-view');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-director', 'perm-ipc-approve');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-director', 'perm-procurement-view');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-director', 'perm-procurement-approve');
-- project_manager: full project control
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-pm', 'perm-projects-view');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-pm', 'perm-projects-create');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-pm', 'perm-projects-edit');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-pm', 'perm-tasks-view');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-pm', 'perm-tasks-create');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-pm', 'perm-tasks-edit');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-pm', 'perm-tasks-assign');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-pm', 'perm-tasks-close');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-pm', 'perm-workforce-view');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-pm', 'perm-workforce-assign');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-pm', 'perm-equipment-view');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-pm', 'perm-equipment-transfer');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-pm', 'perm-documents-view');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-pm', 'perm-documents-approve');
-- viewer: view-only all modules
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-viewer', 'perm-companies-view');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-viewer', 'perm-projects-view');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-viewer', 'perm-tasks-view');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-viewer', 'perm-agents-view');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-viewer', 'perm-documents-view');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-viewer', 'perm-finance-view');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-viewer', 'perm-ipc-view');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-viewer', 'perm-procurement-view');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-viewer', 'perm-workforce-view');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-viewer', 'perm-equipment-view');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-viewer', 'perm-hse-view');
-- auditor: view + export all
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-auditor', 'perm-companies-view');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-auditor', 'perm-projects-view');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-auditor', 'perm-tasks-view');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-auditor', 'perm-agents-view');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-auditor', 'perm-documents-view');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-auditor', 'perm-finance-view');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-auditor', 'perm-finance-export');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-auditor', 'perm-ipc-view');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-auditor', 'perm-procurement-view');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-auditor', 'perm-workforce-view');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-auditor', 'perm-equipment-view');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-auditor', 'perm-hse-view');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-auditor', 'perm-audit-view');
INSERT INTO role_permissions ON CONFLICT (role_id, permission_id) DO NOTHING (role_id, permission_id) VALUES ('role-auditor', 'perm-audit-export');
