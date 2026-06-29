# ADR-0047 — Evidence Link Search

**ID:** `ADR-0047` | **Date:** 2026-06-29
**Branch:** `feat/pr-srch-2-evidence-link-search`

## Decisions

### D-1: Evidence packs as named bundles
Packs group related records for claims, IPC, audits, handover. Named + purposed + owner-trackable.

### D-2: Pack items link by source_module + source_record_id
No FK dependency on search_index_records. Works with any indexed or unindexed record.

### D-3: Click tracking for search quality
`search_result_clicks` captures what users click on, enabling failed-search detection.

### D-4: Agent recommendations for index gaps
Agent detects unindexed records, missing documents, permission-denied searches.

## Recommendation: Authorize. Proceed to IC-0047.
