-- =============================================================================
-- Migration 0048: PR-SRCH-3 — Command Palette
-- =============================================================================

CREATE TABLE IF NOT EXISTS search_commands (
    id              TEXT PRIMARY KEY NOT NULL,
    command_key     TEXT NOT NULL UNIQUE,
    label           TEXT NOT NULL,
    category        TEXT NOT NULL,
    action_type     TEXT NOT NULL,
    action_target   TEXT NOT NULL,
    beschreibung    TEXT,
    icon            TEXT,
    ist_aktiv       INTEGER NOT NULL DEFAULT 1,
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_search_commands_category
    ON search_commands(category);
CREATE INDEX IF NOT EXISTS idx_search_commands_active
    ON search_commands(ist_aktiv);

CREATE TABLE IF NOT EXISTS search_command_usage (
    id              TEXT PRIMARY KEY NOT NULL,
    user_id         TEXT NOT NULL,
    unternehmen_id  TEXT NOT NULL,
    command_id      TEXT NOT NULL,
    executed_am     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_search_command_usage_user
    ON search_command_usage(user_id);

-- Seed default commands
INSERT OR IGNORE INTO search_commands (id, command_key, label, category, action_type, action_target, beschreibung, icon) VALUES
    ('cmd_open_rfi', 'open_rfi', 'Open RFI', 'navigate', 'open_record', '/rfi/:id', 'Open an RFI by number', 'file-text'),
    ('cmd_create_rfi', 'create_rfi', 'Create RFI', 'create', 'open_route', '/rfi/new', 'Create new RFI', 'plus-circle'),
    ('cmd_open_ipc', 'open_ipc', 'Open IPC', 'navigate', 'open_record', '/ipc/:id', 'Open IPC valuation', 'file-check'),
    ('cmd_create_work_pack', 'create_work_pack', 'Create Work Pack', 'create', 'open_route', '/daily-work/new', 'Create daily work pack', 'clipboard'),
    ('cmd_open_approvals', 'open_approvals', 'Approval Queue', 'navigate', 'open_route', '/approvals', 'View pending approvals', 'check-square'),
    ('cmd_overdue_actions', 'overdue_actions', 'Overdue Actions', 'navigate', 'open_route', '/actions/overdue', 'Show overdue tasks and approvals', 'alert-triangle'),
    ('cmd_open_grn', 'open_grn', 'Open GRN', 'navigate', 'open_record', '/grn/:id', 'Open Goods Received Note', 'package'),
    ('cmd_create_po', 'create_po', 'Create PO', 'create', 'open_route', '/procurement/po/new', 'Create Purchase Order', 'shopping-cart'),
    ('cmd_open_drawing', 'open_drawing', 'Open Drawing', 'navigate', 'open_record', '/documents/drawing/:id', 'Open a drawing by number', 'image'),
    ('cmd_open_variation', 'open_variation', 'Open Variation', 'navigate', 'open_record', '/variations/:id', 'Open variation or claim', 'edit'),
    ('cmd_open_site_instruction', 'open_si', 'Open Site Instruction', 'navigate', 'open_record', '/si/:id', 'Open site instruction', 'message-square'),
    ('cmd_open_snag', 'open_snag', 'Open Snag', 'navigate', 'open_record', '/snags/:id', 'Open snag/defect record', 'tool'),
    ('cmd_go_to_vendor', 'go_to_vendor', 'Vendor Review', 'navigate', 'open_route', '/vendors/review', 'Review vendor invoices', 'users'),
    ('cmd_go_to_dashboard', 'go_to_dashboard', 'Executive Dashboard', 'navigate', 'open_route', '/dashboard', 'View executive cockpit', 'bar-chart'),
    ('cmd_open_incident', 'open_incident', 'Open Incident', 'navigate', 'open_record', '/ops/incidents/:id', 'View platform incident', 'alert-circle');
