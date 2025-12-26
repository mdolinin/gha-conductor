ALTER TABLE gha_workflow_runs ADD COLUMN IF NOT EXISTS repo_full_name TEXT NULL;

-- Create an index on (pipeline_run_name, repo_full_name) for efficient lookups
CREATE INDEX IF NOT EXISTS idx_workflow_runs_pipeline_repo ON gha_workflow_runs(pipeline_run_name, repo_full_name);
