# IC-0046 — Universal Search Index Verification

**IC:** `IC-0046` | **ADR:** ADR-0046 | **Migration:** `0046_search_index_foundation.sql`

---

## Gates

1. SQLite: 5 tables, 9 indexes
2. Index a record → tokenize → terms stored
3. Search by keyword → returns matching records
4. Re-index same source → old terms deleted, new inserted (no duplicates)
5. Link two records → link_type stored, linked_record_count incremented
6. Save a query → retrieve by user
7. Record recent item → retrieve by user
8. Permission-aware: filter by visibility_scope = 'tenant' | 'project' | 'owner'
9. Migration parity (SQLite = Postgres)
10. Idempotency
11. TypeScript: 0 new errors

---

## Rollback
```sql
DROP TABLE IF EXISTS search_recent_items;
DROP TABLE IF EXISTS search_saved_queries;
DROP TABLE IF EXISTS search_index_links;
DROP TABLE IF EXISTS search_index_terms;
DROP TABLE IF EXISTS search_index_records;
```
