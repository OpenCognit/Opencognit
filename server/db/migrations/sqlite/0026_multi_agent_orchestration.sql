-- Migration 0026: Multi-Agent Orchestration Features (2026)
-- Adds: Agent Capabilities, Contract-Net Bids, Agent Votes, Trust Scores, Memory Conflicts

-- Agent Capabilities (structured capability registry for Contract-Net)
CREATE TABLE IF NOT EXISTS agent_capabilities (
  id TEXT PRIMARY KEY,
  expert_id TEXT NOT NULL REFERENCES experten(id),
  unternehmen_id TEXT NOT NULL REFERENCES unternehmen(id),
  capabilities_json TEXT NOT NULL,
  quelle TEXT NOT NULL DEFAULT 'manual' CHECK(quelle IN ('auto-extracted', 'manual', 'hybrid')),
  konfidenz INTEGER NOT NULL DEFAULT 50,
  letzte_aktualisierung TEXT,
  erstellt_am TEXT NOT NULL,
  aktualisiert_am TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_capabilities_expert_idx ON agent_capabilities(expert_id);

-- Contract-Net Bids (task auction/bidding system)
CREATE TABLE IF NOT EXISTS contract_net_bids (
  id TEXT PRIMARY KEY,
  unternehmen_id TEXT NOT NULL REFERENCES unternehmen(id),
  aufgabe_id TEXT NOT NULL REFERENCES aufgaben(id),
  bidder_expert_id TEXT NOT NULL REFERENCES experten(id),
  bid_score INTEGER NOT NULL DEFAULT 0,
  begruendung TEXT,
  estimated_minutes INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected', 'expired')),
  announcer_expert_id TEXT REFERENCES experten(id),
  erstellt_am TEXT NOT NULL,
  abgeschlossen_am TEXT
);
CREATE INDEX IF NOT EXISTS contract_net_bids_aufgabe_idx ON contract_net_bids(aufgabe_id);
CREATE INDEX IF NOT EXISTS contract_net_bids_bidder_idx ON contract_net_bids(bidder_expert_id);

-- Agent Votes (consensus/voting system)
CREATE TABLE IF NOT EXISTS agent_votes (
  id TEXT PRIMARY KEY,
  unternehmen_id TEXT NOT NULL REFERENCES unternehmen(id),
  context_id TEXT NOT NULL,
  context_typ TEXT NOT NULL CHECK(context_typ IN ('meeting', 'task', 'decision', 'proposal')),
  expert_id TEXT NOT NULL REFERENCES experten(id),
  vote INTEGER NOT NULL,
  gewichteter_vote REAL NOT NULL,
  begruendung TEXT,
  proposal_text TEXT,
  erstellt_am TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_votes_context_idx ON agent_votes(context_id, context_typ);
CREATE INDEX IF NOT EXISTS agent_votes_expert_idx ON agent_votes(expert_id);

-- Agent Trust Scores (reputation system)
CREATE TABLE IF NOT EXISTS agent_trust_scores (
  id TEXT PRIMARY KEY,
  unternehmen_id TEXT NOT NULL REFERENCES unternehmen(id),
  subject_expert_id TEXT NOT NULL REFERENCES experten(id),
  evaluator_expert_id TEXT,
  score INTEGER NOT NULL DEFAULT 50,
  zuverlaessigkeit INTEGER NOT NULL DEFAULT 50,
  qualitaet INTEGER NOT NULL DEFAULT 50,
  kommunikation INTEGER NOT NULL DEFAULT 50,
  zusammenarbeit INTEGER NOT NULL DEFAULT 50,
  bewertungs_count INTEGER NOT NULL DEFAULT 0,
  verlauf_json TEXT,
  letzte_aktualisierung TEXT,
  erstellt_am TEXT NOT NULL,
  aktualisiert_am TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_trust_subject_idx ON agent_trust_scores(subject_expert_id);
CREATE INDEX IF NOT EXISTS agent_trust_unternehmen_idx ON agent_trust_scores(unternehmen_id, score);

-- Memory Conflicts (actor-aware memory conflict detection)
CREATE TABLE IF NOT EXISTS memory_conflicts (
  id TEXT PRIMARY KEY,
  unternehmen_id TEXT NOT NULL REFERENCES unternehmen(id),
  conflicting_triples_json TEXT NOT NULL,
  conflict_typ TEXT NOT NULL CHECK(conflict_typ IN ('contradiction', 'outdated', 'ambiguity', 'stale')),
  beschreibung TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved', 'ignored')),
  resolution TEXT,
  resolved_by_expert_id TEXT REFERENCES experten(id),
  erstellt_am TEXT NOT NULL,
  aktualisiert_am TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS memory_conflicts_unternehmen_status_idx ON memory_conflicts(unternehmen_id, status);
