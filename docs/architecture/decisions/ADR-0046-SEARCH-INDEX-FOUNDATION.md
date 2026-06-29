# ADR-0046 — Universal Search Index Foundation

**ID:** `ADR-0046` | **Date:** 2026-06-29
**Branch:** `feat/pr-srch-1-search-index-foundation`

---

## Decisions

### D-1: Tokenized term index, not FTS5
Simple tokenization (lowercase, alphanumeric, min 2 chars) with term frequency. FTS5 can layer on later.

### D-2: Upsert on re-index
Re-indexing a source record deletes old terms + record and inserts fresh. No stale data.

### D-3: Search filters applied post-term-match
Filters (project, module, type, status) applied after term matching. Simpler than compound indexes.

### D-4: Cross-record links as separate table
`search_index_links` decouples link storage from record storage. Bi-directional count tracking.

### D-5: Permission-aware via visibility_scope
`visibility_scope` field (tenant/project/owner) enables post-query permission filtering without middleware integration.

### D-6: English tables, German FK/timestamp columns.

---

## Recommendation: Authorize. Proceed to IC-0046.
