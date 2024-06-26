CREATE TYPE hook_type AS ENUM ('onPullRequest', 'onBranchMerge', 'onPullRequestClose');

CREATE TABLE IF NOT EXISTS gha_hooks
(
    id                         SERIAL PRIMARY KEY,
    repo_full_name             TEXT      NOT NULL,
    branch                     TEXT      NOT NULL,
    file_changes_matcher       TEXT      NOT NULL,
    destination_branch_matcher TEXT      NULL,
    hook                       hook_type NOT NULL,
    hook_name                  TEXT      NOT NULL,
    pipeline_unique_prefix     TEXT      NOT NULL,
    pipeline_name              TEXT      NOT NULL,
    pipeline_ref               TEXT      NULL,
    pipeline_params            JSONB     NOT NULL,
    shared_params              JSONB     NULL
);

CREATE TABLE IF NOT EXISTS gha_workflow_runs
(
    id                  SERIAL PRIMARY KEY,
    name                TEXT      NOT NULL,
    workflow_run_id     BIGINT    NULL,
    workflow_job_id     BIGINT    NULL,
    head_sha            TEXT      NOT NULL,
    merge_commit_sha    TEXT      NOT NULL,
    pipeline_run_name   TEXT      NOT NULL,
    status              TEXT      NULL,
    conclusion          TEXT      NULL,
    pr_number           INT       NOT NULL,
    pr_check_id         BIGINT    NULL,
    pr_conclusion       TEXT      NULL,
    check_run_id        BIGINT    NULL,
    hook                hook_type NOT NULL,
    workflow_run_url    TEXT      NULL,
    workflow_run_inputs JSONB     NULL
);