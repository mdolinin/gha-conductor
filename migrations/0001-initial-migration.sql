CREATE TYPE hook_type AS ENUM ('onPullRequest', 'onBranchMerge', 'onPullRequestClose');

CREATE TABLE IF NOT EXISTS gha_hooks
(
    id                         SERIAL PRIMARY KEY,
    repo_full_name             TEXT      NOT NULL,
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