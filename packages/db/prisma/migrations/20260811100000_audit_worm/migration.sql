-- WORM (write-once, read-many) enforcement for the audit log.
-- UPDATE and DELETE are rejected at the database level, so no code path,
-- bug, or future migration can silently rewrite history.

CREATE OR REPLACE FUNCTION audit_event_worm_guard() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit events are append-only (WORM guard)';
END;
$$;

CREATE TRIGGER audit_event_worm_trigger
BEFORE UPDATE OR DELETE ON "AuditEvent"
FOR EACH ROW
EXECUTE FUNCTION audit_event_worm_guard();
