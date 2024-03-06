import {Hooks} from "../src/hooks";

const findAllMock = jest.fn().mockImplementation(() => {
    return [
        {
            file_changes_matcher: "file1",
            pipeline_unique_prefix: "pipeline_unique_prefix"
        }
    ]

});
const selectMock = jest.fn().mockImplementation(() => {
    return {
        all: findAllMock
    }

});
const findMock = jest.fn().mockImplementation(() => {
    return {
        select: selectMock,
    }
});

const findOneMock = jest.fn().mockImplementation(() => {
    return {
        pipeline_ref: "pipeline_ref",
        pipeline_name: "pipeline_name",
        shared_params: {
            shared_param: "shared_param"
        },
        pipeline_params: {
            pipeline_param: "pipeline_param"
        }
    }
});

jest.mock('../src/db/database', () => {
    return {
        gha_hooks: jest.fn(() => {
            return {
                find: findMock,
                findOne: findOneMock
            };
        })
    }
});

describe('gha hooks', () => {
    const hooks = new Hooks();

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('find hooks to trigger, when matched files changed on branch merge', async () => {
        const triggeredHookNames = await hooks.filterTriggeredHooks("repo_full_name", "onBranchMerge", ["file1", "file2"], "baseBranch", [
            {
                repo_full_name: "repo_full_name",
                branch: "baseBranch",
                file_changes_matcher: "file1",
                destination_branch_matcher: "baseBranch",
                hook: "onBranchMerge",
                hook_name: "hook_name",
                pipeline_unique_prefix: "pipeline_unique_prefix",
                pipeline_name: "pipeline_name",
                pipeline_ref: "pipeline_ref",
                pipeline_params: {},
                shared_params: {}
            }
        ]);
        expect(triggeredHookNames).toEqual(new Set(["pipeline_unique_prefix"]));
        expect(findMock).toHaveBeenCalledWith(
            {
                repo_full_name: "repo_full_name",
                branch: "baseBranch",
                hook: "onBranchMerge",
                destination_branch_matcher: "baseBranch"
            }
        );
        expect(selectMock).toHaveBeenCalledWith('file_changes_matcher', 'pipeline_unique_prefix');
        expect(findAllMock).toHaveBeenCalledTimes(1);
    });

    it('find hooks to trigger, when matched files changed on pull request open', async () => {
        const triggeredHookNames = await hooks.filterTriggeredHooks("repo_full_name", "onPullRequest", ["file1", "file2"], "baseBranch", [
            {
                repo_full_name: "repo_full_name",
                branch: "baseBranch",
                file_changes_matcher: "file1",
                destination_branch_matcher: "baseBranch",
                hook: "onPullRequest",
                hook_name: "hook_name",
                pipeline_unique_prefix: "pipeline_unique_prefix",
                pipeline_name: "pipeline_name",
                pipeline_ref: "pipeline_ref",
                pipeline_params: {},
                shared_params: {}
            }
        ]);
        expect(triggeredHookNames).toEqual(new Set(["pipeline_unique_prefix"]));
        expect(findMock).toHaveBeenCalledWith(
            {
                repo_full_name: "repo_full_name",
                branch: "baseBranch",
                hook: "onPullRequest",
            }
        );
        expect(selectMock).toHaveBeenCalledWith('file_changes_matcher', 'pipeline_unique_prefix');
        expect(findAllMock).toHaveBeenCalledTimes(1);
    });

    it('should trigger correct workflow, when list of hooks provided', async () => {
        const merge_commit_sha = "0123456789abcdef";
        const workflowDispatchMock = jest.fn().mockImplementation(() => {
            return {
                status: 204
            }
        });
        const octokit = {
            rest: {
                actions: {
                    createWorkflowDispatch: workflowDispatchMock
                }
            }
        };
        const pull_request = {
            merged: false,
            number: 1,
            head: {
                ref: "head_ref",
                sha: "head_sha"
            },
            base: {
                ref: "base_ref",
                sha: "base_sha",
                repo: {
                    name: "repo_name",
                    full_name: "repo_full_name",
                    owner: {
                        login: "owner_login"
                    }
                }
            }
        };
        // @ts-ignore
        const triggeredPipelineNames = await hooks.runWorkflow(octokit, pull_request, "opened", ["hook1", "hook2"], "onPullRequest", merge_commit_sha);
        expect(findOneMock).toHaveBeenCalledWith({
            repo_full_name: "repo_full_name",
            branch: "base_ref",
            hook: "onPullRequest",
            pipeline_unique_prefix: "hook1"
        });
        expect(workflowDispatchMock).toHaveBeenCalledWith({
            inputs: {
                PIPELINE_NAME: "hook1-head_sha",
                SERIALIZED_VARIABLES: "{\"PR_HEAD_REF\":\"head_ref\",\"PR_HEAD_SHA\":\"head_sha\",\"PR_BASE_REF\":\"base_ref\",\"PR_BASE_SHA\":\"base_sha\",\"PR_MERGE_SHA\":\"0123456789abcdef\",\"PR_NUMBER\":1,\"PR_ACTION\":\"opened\"}",
                pipeline_param: "pipeline_param",
                shared_param: "shared_param"
            },
            owner: "owner_login",
            ref: "pipeline_ref",
            repo: "repo_name",
            workflow_id: "pipeline_name.yaml"
        });
        expect(workflowDispatchMock).toHaveBeenCalledWith({
            inputs: {
                PIPELINE_NAME: "hook2-head_sha",
                SERIALIZED_VARIABLES: "{\"PR_HEAD_REF\":\"head_ref\",\"PR_HEAD_SHA\":\"head_sha\",\"PR_BASE_REF\":\"base_ref\",\"PR_BASE_SHA\":\"base_sha\",\"PR_MERGE_SHA\":\"0123456789abcdef\",\"PR_NUMBER\":1,\"PR_ACTION\":\"opened\"}",
                pipeline_param: "pipeline_param",
                shared_param: "shared_param"
            },
            owner: "owner_login",
            ref: "pipeline_ref",
            repo: "repo_name",
            workflow_id: "pipeline_name.yaml"
        });
        expect(triggeredPipelineNames).toEqual([
            {
                inputs: {
                    PIPELINE_NAME: "hook1-head_sha",
                    SERIALIZED_VARIABLES: "{\"PR_HEAD_REF\":\"head_ref\",\"PR_HEAD_SHA\":\"head_sha\",\"PR_BASE_REF\":\"base_ref\",\"PR_BASE_SHA\":\"base_sha\",\"PR_MERGE_SHA\":\"0123456789abcdef\",\"PR_NUMBER\":1,\"PR_ACTION\":\"opened\"}",
                    pipeline_param: "pipeline_param",
                    shared_param: "shared_param"
                },
                name: "hook1-head_sha"
            },
            {
                inputs: {
                    PIPELINE_NAME: "hook2-head_sha",
                    SERIALIZED_VARIABLES: "{\"PR_HEAD_REF\":\"head_ref\",\"PR_HEAD_SHA\":\"head_sha\",\"PR_BASE_REF\":\"base_ref\",\"PR_BASE_SHA\":\"base_sha\",\"PR_MERGE_SHA\":\"0123456789abcdef\",\"PR_NUMBER\":1,\"PR_ACTION\":\"opened\"}",
                    pipeline_param: "pipeline_param",
                    shared_param: "shared_param"
                },
                name: "hook2-head_sha"
            }
        ]);
    });

});