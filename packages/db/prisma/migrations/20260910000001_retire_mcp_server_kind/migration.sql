-- Retire MCP_SERVER from the GraphNodeKind vocabulary (cf30e62 removed the
-- MCP product surface: extractor, connector, mcp-diff adapter, fixtures).
--
-- Intentionally a no-op for Postgres: enum values cannot be dropped while any
-- row references them, and recreating the type for a dead value is risk without
-- benefit. The PG enum keeps a dormant 'MCP_SERVER' value; nothing in the
-- codebase reads or writes it (verified: zero references in packages/*), the
-- Prisma client no longer exposes it, and seed no longer creates MCP rows.
-- Rollback: re-add MCP_SERVER to schema.prisma GraphNodeKind (no DB change needed).
SELECT 1;
