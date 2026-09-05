-- WP1 domain vocabulary: standardized risk tags for authz/secrets/encryption
-- (Production Spec §8.2 approval classes). Policy wiring lands in WP5; this
-- migration only extends the vocabulary.
ALTER TYPE "RiskTag" ADD VALUE IF NOT EXISTS 'AUTHORIZATION';
ALTER TYPE "RiskTag" ADD VALUE IF NOT EXISTS 'SECRETS';
ALTER TYPE "RiskTag" ADD VALUE IF NOT EXISTS 'ENCRYPTION';
