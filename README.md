# gha-conductor

> A GitHub App built with [Probot](https://github.com/probot/probot) that provide more flexible GitHub Actions workflow for monorepo repositories.

## Why gha-conductor exists
Currently, GitHub Actions does not support monorepo repositories natively.
You can define workflows in `.github/workflows` directory, but if you have a monorepo repository, you might want to run different workflows for different subdirectories.
This can be achieved by using `paths` filter in the workflow definition, but it is not very flexible and can be hard to maintain.

## What gha-conductor does
This app provides a way to define which workflows should be run for each event.
During the workflow run, the app will create corresponding GitHub checks.

Currently, it supports the following events:

| Event                | GitHub check name | Description                                                                                     |
|----------------------|-------------------|-------------------------------------------------------------------------------------------------|
| `onPullRequest`      | `pr-status`       | `opened`, `rereopened`, `synchronize` - when a pull request is opened, reopened or synchronized |
| `onBranchMerge`      | `pr-merge`        | `merged` - when a branch is merged into another branch                                          |
| `onPullRequestClose` | `pr-close`        | `closed` - when a pull request is closed and not merged                                         |

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
```

Files can be places in any directory in the repository.
App uses `worfklow_dispatch` event to trigger GitHub Actions workflows.

GitHub Actions workflows should be defined in `.github/workflows` directory and should have `workflow_dispatch` trigger.
Example of GitHub Actions workflow:
```yaml
name: "Common job"
on:
  workflow_dispatch: # This is required to be able to trigger the workflow from the app
    inputs:
      PIPELINE_NAME: # Required to be able to differentiate between jobs
        required: true
      ROOT_DIR:
        required: false
        default: ""
      COMMAND:
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
        uses: actions/checkout@v3
        with:
          fetch-depth: 0 # We need to fetch all history so that we can checkout the PR merge commit
          # We check out github.event.pull_request.merge_commit_sha
          # to ensure we are testing the exact code that will be merged into the base branch
          ref: ${{ env.PR_MERGE_SHA }} # Provided via SERIALIZED_VARIABLES
      - name: Execute Task
        env:
          USER_HOME: ${{ github.workspace }}
        working-directory: ${{ github.event.inputs.ROOT_DIR }}
        run: ${{ github.event.inputs.COMMAND }}
```

## Usage
* Install the app on your GitHub account or organization
* Create `.gha.yaml` files in your repository
* Define GitHub Actions workflows in `.github/workflows` directory
* Run the app
* When you create a pull request, merge a branch or close a pull request, the app will trigger the workflows defined in `.gha.yaml` files
* During the workflow run, the app will create corresponding GitHub checks for each job defined in `.gha.yaml` file
* (Optional) Update branch protection rules to require successful `pr-status` check before merging

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
```

## Docker

```sh
# 1. Build container
docker build -t gha-conductor .

# 2. Start container
docker run -e APP_ID=<app-id> -e PRIVATE_KEY=<pem-value> gha-conductor
```

## Contributing

If you have suggestions for how gha-conductor could be improved, or want to report a bug, open an issue! We'd love all and any contributions.

For more, check out the [Contributing Guide](CONTRIBUTING.md).

## License

[ISC](LICENSE) © 2024 mdolinin
