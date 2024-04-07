import {Hooks} from "../src/hooks";
import {HookType} from "../src/__generated__/_enums";
import {GhaHook} from "../src/gha_loader";

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
        all: findAllMock
    }
});

jest.mock('../src/db/database', () => {
    return {
        gha_hooks: jest.fn(() => {
            return {
                find: findMock,
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
        const hook = {
            repo_full_name: "repo_full_name",
            branch: "baseBranch",
            file_changes_matcher: "file1",
            destination_branch_matcher: "baseBranch",
            hook: "onBranchMerge" as HookType,
            hook_name: "hook_name",
            pipeline_unique_prefix: "pipeline_unique_prefix",
            pipeline_name: "pipeline_name",
            pipeline_ref: "pipeline_ref",
            pipeline_params: {},
            shared_params: {}
        };
        const triggeredHooks = await hooks.filterTriggeredHooks(
            "repo_full_name", "onBranchMerge", ["file1", "file2"], "baseBranch",
            [
                hook
            ]);
        expect(triggeredHooks).toEqual(new Set([hook]));
        expect(findMock).toHaveBeenCalledWith(
            {
                repo_full_name: "repo_full_name",
                branch: "baseBranch",
                hook: "onBranchMerge",
                destination_branch_matcher: "baseBranch"
            }
        );
        expect(findAllMock).toHaveBeenCalledTimes(1);
    });

    it('find hooks to trigger, when matched files changed on pull request open', async () => {
        let hook = {
            repo_full_name: "repo_full_name",
            branch: "baseBranch",
            file_changes_matcher: "file1",
            destination_branch_matcher: "baseBranch",
            hook: "onPullRequest" as HookType,
            hook_name: "hook_name",
            pipeline_unique_prefix: "pipeline_unique_prefix",
            pipeline_name: "pipeline_name",
            pipeline_ref: "pipeline_ref",
            pipeline_params: {},
            shared_params: {}
        };
        const triggeredHookNames = await hooks.filterTriggeredHooks(
            "repo_full_name", "onPullRequest", ["file1", "file2"], "baseBranch",
            [
                hook
            ]);
        expect(triggeredHookNames).toEqual(new Set([hook]));
        expect(findMock).toHaveBeenCalledWith(
            {
                repo_full_name: "repo_full_name",
                branch: "baseBranch",
                hook: "onPullRequest",
            }
        );
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
                    default_branch: "main",
                    name: "repo_name",
                    full_name: "repo_full_name",
                    owner: {
                        login: "owner_login"
                    }
                }
            }
        };
        const triggeredHooks = new Set<GhaHook>();
        const hook1 = {
            branch: "hookBranch1",
            destination_branch_matcher: "main",
            hook_name: "hook1",
            pipeline_name: "pipeline_name_1",
            pipeline_params: {
                COMMAND: "command1",
                pipeline_param: "pipeline_param_1"
            },
            pipeline_ref: "feature/1",
            repo_full_name: "repo_full_name",
            shared_params: {
                ROOT_DIR: "root_dir1",
                shared_param: "shared_param"
            },
            pipeline_unique_prefix: "namespace1-module1-hook1",
            file_changes_matcher: "*.yaml",
            hook: "onPullRequest" as HookType
        };
        const hook2 = {
            branch: "hookBranch2",
            destination_branch_matcher: "main",
            hook_name: "hook2",
            pipeline_name: "pipeline_name_2",
            pipeline_params: {
                COMMAND: "command2",
                pipeline_param: "pipeline_param_2"
            },
            pipeline_ref: undefined,
            repo_full_name: "repo_full_name",
            shared_params: {
                ROOT_DIR: "root_dir2",
                shared_param: "shared_param"
            },
            pipeline_unique_prefix: "namespace1-module1-hook2",
            file_changes_matcher: "app/*.js",
            hook: "onBranchMerge" as HookType
        };
        triggeredHooks.add(hook1);
        triggeredHooks.add(hook2);
        // @ts-ignore
        const triggeredPipelineNames = await hooks.runWorkflow(octokit, pull_request, "opened", triggeredHooks, merge_commit_sha);
        expect(workflowDispatchMock).toHaveBeenCalledWith({
            inputs: {
                COMMAND: "command1",
                PIPELINE_NAME: "namespace1-module1-hook1-head_sha",
                SERIALIZED_VARIABLES: "{\"PR_HEAD_REF\":\"head_ref\",\"PR_HEAD_SHA\":\"head_sha\",\"PR_BASE_REF\":\"base_ref\",\"PR_BASE_SHA\":\"base_sha\",\"PR_MERGE_SHA\":\"0123456789abcdef\",\"PR_NUMBER\":1,\"PR_ACTION\":\"opened\",\"ROOT_DIR\":\"root_dir1\",\"shared_param\":\"shared_param\",\"COMMAND\":\"command1\",\"pipeline_param\":\"pipeline_param_1\"}",
                ROOT_DIR: "root_dir1",
            },
            owner: "owner_login",
            ref: "feature/1",
            repo: "repo_name",
            workflow_id: "pipeline_name_1.yaml"
        });
        expect(workflowDispatchMock).toHaveBeenCalledWith({
            inputs: {
                COMMAND: "command2",
                PIPELINE_NAME: "namespace1-module1-hook2-head_sha",
                SERIALIZED_VARIABLES: "{\"PR_HEAD_REF\":\"head_ref\",\"PR_HEAD_SHA\":\"head_sha\",\"PR_BASE_REF\":\"base_ref\",\"PR_BASE_SHA\":\"base_sha\",\"PR_MERGE_SHA\":\"0123456789abcdef\",\"PR_NUMBER\":1,\"PR_ACTION\":\"opened\",\"ROOT_DIR\":\"root_dir2\",\"shared_param\":\"shared_param\",\"COMMAND\":\"command2\",\"pipeline_param\":\"pipeline_param_2\"}",
                ROOT_DIR: "root_dir2",
            },
            owner: "owner_login",
            ref: "main",
            repo: "repo_name",
            workflow_id: "pipeline_name_2.yaml"
        });
        expect(triggeredPipelineNames).toEqual([
            {
                inputs: {
                    COMMAND: "command1",
                    PIPELINE_NAME: "namespace1-module1-hook1-head_sha",
                    SERIALIZED_VARIABLES: "{\"PR_HEAD_REF\":\"head_ref\",\"PR_HEAD_SHA\":\"head_sha\",\"PR_BASE_REF\":\"base_ref\",\"PR_BASE_SHA\":\"base_sha\",\"PR_MERGE_SHA\":\"0123456789abcdef\",\"PR_NUMBER\":1,\"PR_ACTION\":\"opened\",\"ROOT_DIR\":\"root_dir1\",\"shared_param\":\"shared_param\",\"COMMAND\":\"command1\",\"pipeline_param\":\"pipeline_param_1\"}",
                    ROOT_DIR: "root_dir1",
                },
                name: "namespace1-module1-hook1-head_sha"
            },
            {
                inputs: {
                    COMMAND: "command2",
                    PIPELINE_NAME: "namespace1-module1-hook2-head_sha",
                    SERIALIZED_VARIABLES: "{\"PR_HEAD_REF\":\"head_ref\",\"PR_HEAD_SHA\":\"head_sha\",\"PR_BASE_REF\":\"base_ref\",\"PR_BASE_SHA\":\"base_sha\",\"PR_MERGE_SHA\":\"0123456789abcdef\",\"PR_NUMBER\":1,\"PR_ACTION\":\"opened\",\"ROOT_DIR\":\"root_dir2\",\"shared_param\":\"shared_param\",\"COMMAND\":\"command2\",\"pipeline_param\":\"pipeline_param_2\"}",
                    ROOT_DIR: "root_dir2",
                },
                name: "namespace1-module1-hook2-head_sha"
            }
        ]);
    });

    it('should verify that all hooks in provided list pointed to existing branch', async () => {
        const getBranchMock = jest.fn().mockImplementation(() => {
            throw new Error("Branch not found")
        });
        const octokit = {
            rest: {
                repos: {
                    getBranch: getBranchMock
                }
            }
        };
        const hook1 = {
            branch: "hookBranch1",
            destination_branch_matcher: "main",
            hook_name: "hook1",
            pipeline_name: "pipeline_name_1",
            pipeline_params: {
                pipeline_param: "pipeline_param_1"
            },
            pipeline_ref: "feature/1",
            repo_full_name: "repo_full_name",
            shared_params: {
                shared_param: "shared_param"
            },
            pipeline_unique_prefix: "namespace1-module1-hook1",
            file_changes_matcher: "*.yaml",
            hook: "onPullRequest" as HookType
        };
        const hooksList = new Set<GhaHook>();
        hooksList.add(hook1);
        // @ts-ignore
        const hooksWithNotExistingRef = await hooks.verifyAllHooksRefsExist(octokit, "owner", "repo", "main", hooksList);
        expect(hooksWithNotExistingRef).toEqual([hook1]);
    });

});