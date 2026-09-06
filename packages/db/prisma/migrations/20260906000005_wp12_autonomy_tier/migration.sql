-- WP12 product UX: organization default delivery autonomy tier on
-- AutonomyPolicy. Nullable so legacy rows keep legacy behavior (no tier
-- enforcement until the onboarding wizard or policies UI sets one).

ALTER TABLE "AutonomyPolicy" ADD COLUMN "defaultDecision" TEXT;
