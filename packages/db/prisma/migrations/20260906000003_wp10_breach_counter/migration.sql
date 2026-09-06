-- WP10 suspension hardening (spec §11.2): consecutive-breach counter on
-- CapabilityGate. Suspension fires only after N consecutive unhealthy
-- evaluations so a single bad window cannot flap a gate; the counter resets
-- on a healthy evaluation while the status itself still restores by admin.

ALTER TABLE "CapabilityGate" ADD COLUMN "consecutiveBreaches" INTEGER NOT NULL DEFAULT 0;
