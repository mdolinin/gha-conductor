# gha-conductor

> A GitHub App built with [Probot](https://github.com/probot/probot) that provide more flexible GitHub Actions workflow for monorepo repositories.

## Why gha-conductor exists

Currently, GitHub Actions does not support monorepo repositories natively.
You can define workflows in `.github/workflows` directory, but if you have a monorepo repository, you might want to run different workflows for different subdirectories.
This can be achieved by using `paths` filter in the workflow definition, but it is not very flexible and can be hard to maintain.

## Features

- Define CI/CD workflows closer to the project code (any directory in the repository)
- Reuse common workflows across multiple projects
- Trigger workflows based on PR open/updated, closed or merged events
- Trigger workflows based on what files changed in the pull request
- Trigger workflows based on what branch the pull request is merged into
- Trigger workflows based on /slash commands in PR comments (e.g. `/validate param=value`)
  ![pr-comment-command](./docs/pr-comment-command.png)
- Reload all hooks from `.gha.yaml` files by adding label `gha-conductor:load` to PR
- Run multiple workflows in parallel for the same event
- Report status of the workflow run as GitHub checks
  ![pr-status-check](./docs/green-pr-checks.png)
- Aggregate status of the all triggered workflows for the same event and report it as `pr-satus` GitHub check
  ![pr-status-multiple-workflows](./docs/pr-status-multiple-workflows.png)
- Provide ability to require all workflows to pass before merging PR (just add `pr-status` check to branch protection rules)
- Verify changes in `.gha.yaml` files w/o merge into main branch by open PR with changes
- Re-run all workflows from PR checks page
- Re-run specific workflow from PR checks page
- Re-run only failed workflows from PR checks page (save time and resources)
  ![checks-re-run-options](./docs/checks-re-run-options.png)
- Show workflow logs in PR checks page
- Link to the workflow run from PR checks page
- Validate `.gha.yaml` files against JSON schema and check name uniqueness with error messages in PR diff
  ![pr-diff-yaml-errors](./docs/pr-diff-yaml-errors.png)
- Define repo specific configuration using probot configuration file `.github/gha-conductor-config.yaml`

## What gha-conductor does

This app provides a way to define which workflows should be run for each event.
During the workflow run, the app will create corresponding GitHub checks.

Currently, it supports the following events:

| Event                | GitHub check name  | Description                                                                                                                                              |
|----------------------|--------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------|
| `onPullRequest`      | `pr-status`        | `opened`, `rereopened`, `synchronize`, `edited` - when a pull request is opened, reopened, synchronized or the base branch of a pull request was changed |
| `onBranchMerge`      | `pr-merge`         | `merged` - when a branch is merged into another branch                                                                                                   |
| `onPullRequestClose` | `pr-close`         | `closed` - when a pull request is closed and not merged                                                                                                  |
| `onSlashCommand`     | `pr-slash-command` | `issue_comment.created`, `issue_comment.edited` - when a comment with slash command is created or edited                                                 |

It uses `.gha.yaml` files to define which workflows should be run for each event.
Json schema for `.gha.yaml` files can be found in `schemas/gha_yaml_schema.json` directory.

Example of `.gha.yaml` file:

```yaml
moduleName: example-c
teamNamespace: domain-b

sharedParams:
  ROOT_DIR: "namespaces/domain-b/projects/example-c"

defaultFileChangeTrigger: &defaultFileChangeTrigger
  - "namespaces/domain-b/projects/example-c/**"

onPullRequest:
  - name: build
    pipelineRef:
      name: common-job
    pipelineRunValues:
      params:
        COMMAND: make build
    triggerConditions:
      fileChangesMatchAny: *defaultFileChangeTrigger

  - name: test
    pipelineRef:
      name: common-job
    pipelineRunValues:
      params:
        COMMAND: make test
    triggerConditions:
      fileChangesMatchAny:
        - "namespaces/domain-b/projects/example-c/tests/test.sh"

onBranchMerge:
  - name: release
    pipelineRef:
      name: common-job
    pipelineRunValues:
      params:
        COMMAND: >-
          make release
    triggerConditions:
      destinationBranchMatchesAny:
        - 'main'
      fileChangesMatchAny: *defaultFileChangeTrigger

onPullRequestClose:
  - name: cleanup
    pipelineRef:
      name: common-job
    pipelineRunValues:
      params:
        COMMAND: >-
          make clean
    triggerConditions:
      destinationBranchMatchesAny:
        - 'main'
      fileChangesMatchAny: *defaultFileChangeTrigger

onSlashCommand:
  - name: validate-before-merge
    pipelineRef:
      name: generic-job
    pipelineRunValues:
      params:
        COMMAND: make ${command} ${args} # ${command} and ${args} will be replaced with values from the comment slash command
    triggerConditions:
      slashCommands:
        - "validate"
      fileChangesMatchAny: *defaultFileChangeTrigger
```

Files can be places in any directory in the repository.
App uses `worfklow_dispatch` event to trigger GitHub Actions workflows.

`fileChangesMatchAny` uses [minimatch](https://github.com/isaacs/minimatch) to match file changes.
Uses default configuration for minimatch.
Ignores filenames starting with a period. (e.g. `.gha.yaml`)
If pattern starts with `!`, it will be ignored.

GitHub Actions workflows should be defined in `.github/workflows` directory and should have `workflow_dispatch` trigger.
Example of GitHub Actions workflow:

```yaml
name: "Common job"
run-name: "${{ inputs.PIPELINE_NAME }}"
on:
  workflow_dispatch: # This is required to be able to trigger the workflow from the app
    inputs: # extra inputs can be added to the workflow and will be provided by the app from context, params or sharedParams
      PIPELINE_NAME: # Required to be able to differentiate between jobs
        required: true
      SERIALIZED_VARIABLES: # workaround the 10 input limit by serializing the variables into a JSON string
        required: true

permissions:
  id-token: write   # This is required for requesting the JWT
  contents: read    # This is required for actions/checkout

jobs:
  Execute_Task:
    name: "${{ github.event.inputs.PIPELINE_NAME }}" # Required to be able to differentiate between jobs
    runs-on: ubuntu-latest
    timeout-minutes: 5 # This is the maximum time the job can run for
    env:
      SERIALIZED_VARIABLES: ${{ github.event.inputs.SERIALIZED_VARIABLES }}
    steps:
      - name: Load Serialized Variables
        run: |
          variables=$(echo $SERIALIZED_VARIABLES | jq -r 'to_entries|map("\(.key)=\(.value|tostring)")|.[]')
          while IFS= read -r line; do
              echo "$line" >> $GITHUB_ENV
          done <<< "$variables"
      - name: Check out Code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0 # We need to fetch all history so that we can checkout the PR merge commit
          # We check out github.event.pull_request.merge_commit_sha
          # to ensure we are testing the exact code that will be merged into the base branch
          ref: ${{ env.PR_MERGE_SHA }} # Provided via SERIALIZED_VARIABLES
      - name: Execute Task
        env:
          USER_HOME: ${{ github.workspace }}
        working-directory: ${{ env.ROOT_DIR }}
        run: ${{ env.COMMAND }}
```

## Usage

* Install the app on your GitHub account or organization
* Create `.gha.yaml` files in your repository
* Define GitHub Actions workflows in `.github/workflows` directory
* Run the app
* (First time only) Open PR and add label `gha-conductor:load` to trigger the app to load all `.gha.yaml` files and create corresponding hooks in the database
* When you create a pull request, merge a branch or close a pull request, the app will trigger the workflows defined in `.gha.yaml` files
* During the workflow run, the app will create corresponding GitHub checks for each job defined in `.gha.yaml` file
* (Optional) Update branch protection rules to require successful `pr-status` check before merging

## Examples
- Example of monorepo setup that uses `gha-conductor` can be found in [mdolinin/mono-repo-example](https://github.com/mdolinin/mono-repo-example) repository.

## How it works

Sequence diagram of how the app works for PR event:

```mermaid
sequenceDiagram
    participant GitHub
    participant App
    participant Workflows

    GitHub->>App: Send pull request event
    App->>App: Check what files changed in PR
    App->>App: Find what workflows needs to be triggered
    App->>Workflows: Trigger all requested workflows jobs
    App->>GitHub: Create pr-status check
    loop until all triggered jobs completed
        Workflows->>App: Notify workflow job queued
        App->>GitHub: Create check for triggered workflow job
        Workflows->>App: Notify workflow job in_progress
        App->>GitHub: Update workflow job check in_progress
        App->>GitHub: Update pr-status check in_progress
        Workflows->>App: Notify workflow job completed
        App->>GitHub: Update workflow run check completed
    end
    App->>App: Calculate conclusion
    App->>GitHub: Update pr-status check with conclusion
```    

### When app will not trigger workflows on PR event

- if PR is opened from fork
- if PR is not mergeable
- if PR has no files changed

### When app will not trigger workflow on /slash command in PR comment

- if comment made by bot
- if comment made PR is closed
- if comment made by user that has no write access to the repository
- if PR is opened from fork
- if comment does not contain any slash command in the first line

## Persistence
App uses PostgreSQL database to store information about which workflows should be triggered for each event and workflow executions that were triggered.
- `@databases/pg` is used to interact with the database.
- `pg-migrations` is used to manage database schema. Migrations are located in `migrations` directory.
- `@databases/pg-typed` and `@databases/pg-schema-cli` are used to generate TypeScript types and JSON schemas from the database schema. Generated types and schema are located in `src/__generated__` directory.

## Configuration

- App leverages [Probot configuration plugin](https://github.com/probot/octokit-plugin-config) to provide a way to define repo specific configuration or organization wide configuration.
- App uses `.github/gha-conductor-config.yaml` file to define repo specific configuration.
- Available configuration options(default values are shown):

```yaml
gha_hooks_file: .gha.yaml
workflow_file_extension: .yaml
```

- Environment variables can be used to override app configuration options.
- Available environment variables:
  - `APP_CONFIG_FILE` - name of the configuration file (default: `gha-conductor-config.yaml`)
  - `DEFAULT_GHA_HOOKS_FILE_NAME` - name of the file that contains hooks configurations file (default: `.gha.yaml`)
  - `DEFAULT_WORKFLOW_FILE_EXTENSION` - extension of the GitHub Actions workflow files inside `.github/workflows` folder (default: `.yaml`)

## Setup

```sh
# Install dependencies
yarn
# Generate schemas
yarn generate
# Apply db migrations
yarn db:migrate
# Generate db schema
yarn db:generate
# Run the bot
yarn start
# Run tests
yarn test
```

## Docker

```sh
# 1. Build container
docker build -t gha-conductor .

# 2. Start container
docker run -e APP_ID=<app-id> -e PRIVATE_KEY=<pem-value> -e WEBHOOK_SECRET=<secret-value> -e LOG_LEVEL=info -e DATABASE_URL=<postgres://user:pass@localhost:5432/postgres> gha-conductor
```

## Self-hosting

1. [Register a new GitHub App](https://probot.github.io/docs/deployment/#register-the-github-app)
2. Install the app on your account or organization
3. Create a new PostgreSQL database
4. Apply database migrations
    ```sh
    export DATABASE_URL=<your-database-url>
    yarn db:migrate
    ```
5. Set the following environment variables:
   - `APP_ID` - the ID of the GitHub App
   - `PRIVATE_KEY` - the private key of the GitHub App, base64 encoded
   - `WEBHOOK_SECRET` - the secret used to secure webhooks
   - `LOG_LEVEL` - the log level (default: `info`)
   - `DATABASE_URL` - the URL of the PostgreSQL database (format: `postgres://user:pass@localhost:5432/postgres`)
6. Run the app as a Docker container
    ```sh
    docker run -e APP_ID=<app-id> -e PRIVATE_KEY=<pem-value> -e WEBHOOK_SECRET=<secret-value> -e LOG_LEVEL=info -e DATABASE_URL=<db-url> ghcr.io/mdolinin/gha-conductor:latest
    ```
7. Update the webhook URL in the GitHub App settings to point to your server
8. (Optional) Update branch protection rules to require successful `pr-status` check before merging

## Contributing

If you have suggestions for how gha-conductor could be improved, or want to report a bug, open an issue! We'd love all and any contributions.

For more, check out the [Contributing Guide](CONTRIBUTING.md).

## License

[ISC](LICENSE) © 2024 mdolinin
