ALTER TABLE gha_hooks ADD COLUMN IF NOT EXISTS branch_head_sha TEXT NULL;

-- Speeds up the staleness check performed by GhaLoader.loadAllGhaYamlForBranchIfNew,
-- which looks up cached hooks for a given (repo_full_name, branch) pair on every PR event.
CREATE INDEX IF NOT EXISTS idx_gha_hooks_repo_branch ON gha_hooks (repo_full_name, branch);
