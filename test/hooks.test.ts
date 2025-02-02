import {vi, describe, afterEach, expect, it} from "vitest";
import {Hooks} from "../src/hooks.js";
import {HookType} from "../src/__generated__/_enums.js";
import {GhaHook} from "../src/gha_loader.js";
import {Logger} from "probot";

const insertMock = vi.fn();
const findAllMock = vi.fn().mockImplementation(() => {
    return [
        {
            file_changes_matcher: "file1",
            pipeline_unique_prefix: "pipeline_unique_prefix"
        },
        {
            file_changes_matcher: "file2",
            pipeline_unique_prefix: "pipeline_unique_prefix"
        }
    ]

});
const selectMock = vi.fn().mockImplementation(() => {
    return {
        all: findAllMock
    }

});
const findMock = vi.fn().mockImplementation(() => {
    return {
        select: selectMock,
        all: findAllMock
    }
});

vi.mock('../src/db/database', async (importOriginal) => {
    const mod = await importOriginal();
    return {
        // @ts-ignore
        ...mod,
        gha_hooks: vi.fn(() => {
            return {
                find: findMock,
            };
        }),
        gha_workflow_runs: vi.fn(() => {
            return {
                insert: insertMock,
            };
        }),
    }
});

const logMock = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
};

const workflowYamlValid = `
name: pipeline_name_1
on:
  workflow_dispatch:
    inputs:
      PIPELINE_NAME:
        required: true
      COMMAND:
        required: false
        default: "command1"
      SERIALIZED_VARIABLES:
        required: true
`;

describe('gha hooks', () => {
    const hooks = new Hooks(logMock as unknown as Logger);

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('find hooks to trigger, when matched files changed on branch merge and no hooks changed in PR', async () => {
        const hook = {
            file_changes_matcher: "file1",
            pipeline_unique_prefix: "pipeline_unique_prefix",
        };
        const triggeredHooks = await hooks.filterTriggeredHooks(
            "repo_full_name", "onBranchMerge", ["file1", "file2"], "baseBranch",
            {hooks: [], hookFilesModified: new Set([])});
        expect(triggeredHooks).toEqual(new Set([hook]));
        expect(findMock).toHaveBeenCalledWith(
            {
                repo_full_name: "repo_full_name",
                branch: "baseBranch",
                hook: "onBranchMerge",
                destination_branch_matcher: "baseBranch",
                path_to_gha_yaml: expect.objectContaining({
                    "__query": expect.anything(),
                    "__special": {
                        query: expect.anything(),
                        type: "not",
                    }
                })
            }
        );
        expect(findAllMock).toHaveBeenCalledTimes(1);
    });

    it('find hooks to trigger, when matched files changed on pull request open', async () => {
        const hook1 = {
            repo_full_name: "repo_full_name",
            branch: "baseBranch",
            file_changes_matcher: "file1",
            destination_branch_matcher: "baseBranch",
            hook: "onPullRequest" as HookType,
            hook_name: "hook_name",
            path_to_gha_yaml: "namespace1/module1/.gha.yaml",
            pipeline_unique_prefix: "pipeline_unique_prefix",
            pipeline_name: "pipeline_name",
            pipeline_ref: "pipeline_ref",
            pipeline_params: {},
            shared_params: {},
            slash_command: undefined
        };
        const hook2 = {
            repo_full_name: "repo_full_name",
            branch: "baseBranch",
            file_changes_matcher: "file2",
            destination_branch_matcher: "baseBranch",
            hook: "onPullRequest" as HookType,
            hook_name: "hook_name",
            path_to_gha_yaml: "namespace1/module1/.gha.yaml",
            pipeline_unique_prefix: "pipeline_unique_prefix",
            pipeline_name: "pipeline_name",
            pipeline_ref: "pipeline_ref",
            pipeline_params: {},
            shared_params: {},
            slash_command: undefined
        };
        const triggeredHookNames = await hooks.filterTriggeredHooks(
            "repo_full_name", "onPullRequest", ["file1", "file2", "namespace1/module1/.gha.yaml"], "baseBranch",
            {hooks: [hook1, hook2], hookFilesModified: new Set(["namespace1/module1/.gha.yaml"])});
        expect(triggeredHookNames).toEqual(new Set([hook1]));
        expect(findMock).toHaveBeenCalledWith(
            {
                repo_full_name: "repo_full_name",
                branch: "baseBranch",
                hook: "onPullRequest",
                path_to_gha_yaml: expect.objectContaining({
                    "__query": expect.anything(),
                    "__special": {
                        query: expect.anything(),
                        type: "not",
                    }
                })

            }
        );
        expect(findAllMock).toHaveBeenCalledTimes(1);
    });

    it('find hooks to trigger, when matched files changed on slash command received', async () => {
        const hook = {
            repo_full_name: "repo_full_name",
            branch: "baseBranch",
            file_changes_matcher: "file1",
            destination_branch_matcher: "baseBranch",
            hook: "onSlashCommand" as HookType,
            hook_name: "hook_name",
            path_to_gha_yaml: "namespace1/module1/.gha.yaml",
            pipeline_unique_prefix: "pipeline_unique_prefix",
            pipeline_name: "pipeline_name",
            pipeline_ref: "pipeline_ref",
            pipeline_params: {},
            shared_params: {},
            slash_command: 'validate'
        };
        const triggeredHookNames = await hooks.filterTriggeredHooks(
            "repo_full_name", "onSlashCommand", ["file1", "file2", "namespace1/module1/.gha.yaml"], "baseBranch",
            {hooks: [hook], hookFilesModified: new Set(["namespace1/module1/.gha.yaml"])}, 'validate');
        expect(triggeredHookNames).toEqual(new Set([hook]));
        expect(findMock).toHaveBeenCalledWith(
            {
                repo_full_name: "repo_full_name",
                branch: "baseBranch",
                hook: "onSlashCommand",
                slash_command: 'validate',
                path_to_gha_yaml: expect.objectContaining({
                    "__query": expect.anything(),
                    "__special": {
                        query: expect.anything(),
                        type: "not",
                    }
                })
            }
        );
        expect(findAllMock).toHaveBeenCalledTimes(1);
    });

    it('should not find hooks to trigger, when matched files changed on slash command not received', async () => {
        const hook = {
            repo_full_name: "repo_full_name",
            branch: "baseBranch",
            file_changes_matcher: "file1",
            destination_branch_matcher: "baseBranch",
            hook: "onSlashCommand" as HookType,
            hook_name: "hook_name",
            path_to_gha_yaml: "namespace1/module1/.gha.yaml",
            pipeline_unique_prefix: "pipeline_unique_prefix",
            pipeline_name: "pipeline_name",
            pipeline_ref: "pipeline_ref",
            pipeline_params: {},
            shared_params: {},
            slash_command: 'validate'
        };
        const triggeredHookNames = await hooks.filterTriggeredHooks(
            "repo_full_name", "onSlashCommand", ["file1", "file2", "namespace1/module1/.gha.yaml"], "baseBranch",
            {hooks: [hook], hookFilesModified: new Set(["namespace1/module1/.gha.yaml"])});
        expect(triggeredHookNames).toEqual(new Set([]));
        expect(findMock).not.toHaveBeenCalled();
        expect(findAllMock).not.toHaveBeenCalled();
    });

    it('should trigger correct workflow, when list of hooks provided', async () => {
        const prCheckId = 1;
        const merge_commit_sha = "0123456789abcdef";
        const workflowDispatchMock = vi.fn().mockImplementation(() => {
            return {
                status: 204
            }
        });
        const getWorkflowMock = vi.fn().mockImplementation(() => {
            return {
                status: 200,
                data: {
                    state: "active"
                }
            }
        });
        const octokit = {
            rest: {
                actions: {
                    createWorkflowDispatch: workflowDispatchMock,
                    getWorkflow: getWorkflowMock
                },
                repos: {
                    getContent: vi.fn().mockImplementation(() => {
                        return {
                            status: 200,
                            data: {
                                content: Buffer.from(workflowYamlValid).toString('base64'),
                            }
                        }
                    })
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
            path_to_gha_yaml: "namespace1/module1/.gha.yaml",
            pipeline_unique_prefix: "namespace1-module1-hook1",
            file_changes_matcher: "*.yaml",
            slash_command: undefined,
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
            path_to_gha_yaml: "namespace1/module1/.gha.yaml",
            pipeline_unique_prefix: "namespace1-module1-hook2",
            file_changes_matcher: "app/*.js",
            slash_command: undefined,
            hook: "onBranchMerge" as HookType
        };
        triggeredHooks.add(hook1);
        triggeredHooks.add(hook2);
        // @ts-ignore
        const triggeredPipelineNames = await hooks.runWorkflow(octokit, pull_request, "opened", triggeredHooks, merge_commit_sha, prCheckId, undefined, ".yaml");
        expect(getWorkflowMock).toHaveBeenCalledWith({
            owner: "owner_login",
            repo: "repo_name",
            workflow_id: "pipeline_name_1.yaml"
        });
        expect(getWorkflowMock).toHaveBeenCalledWith({
            owner: "owner_login",
            repo: "repo_name",
            workflow_id: "pipeline_name_2.yaml"
        });
        expect(getWorkflowMock).toHaveBeenCalledTimes(2);
        expect(workflowDispatchMock).toHaveBeenCalledWith({
            inputs: {
                COMMAND: "command1",
                PIPELINE_NAME: "namespace1-module1-hook1-head_sha",
                SERIALIZED_VARIABLES: "{\"PR_HEAD_REF\":\"head_ref\",\"PR_HEAD_SHA\":\"head_sha\",\"PR_BASE_REF\":\"base_ref\",\"PR_BASE_SHA\":\"base_sha\",\"PR_MERGE_SHA\":\"0123456789abcdef\",\"PR_NUMBER\":1,\"PR_ACTION\":\"opened\",\"ROOT_DIR\":\"root_dir1\",\"shared_param\":\"shared_param\",\"COMMAND\":\"command1\",\"pipeline_param\":\"pipeline_param_1\"}",
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
            },
            owner: "owner_login",
            ref: "main",
            repo: "repo_name",
            workflow_id: "pipeline_name_2.yaml"
        });
        expect(insertMock).toHaveBeenCalledTimes(2);
        expect(triggeredPipelineNames).toEqual([
            {
                inputs: {
                    COMMAND: "command1",
                    PIPELINE_NAME: "namespace1-module1-hook1-head_sha",
                    SERIALIZED_VARIABLES: "{\"PR_HEAD_REF\":\"head_ref\",\"PR_HEAD_SHA\":\"head_sha\",\"PR_BASE_REF\":\"base_ref\",\"PR_BASE_SHA\":\"base_sha\",\"PR_MERGE_SHA\":\"0123456789abcdef\",\"PR_NUMBER\":1,\"PR_ACTION\":\"opened\",\"ROOT_DIR\":\"root_dir1\",\"shared_param\":\"shared_param\",\"COMMAND\":\"command1\",\"pipeline_param\":\"pipeline_param_1\"}",
                },
                name: "namespace1-module1-hook1-head_sha"
            },
            {
                inputs: {
                    COMMAND: "command2",
                    PIPELINE_NAME: "namespace1-module1-hook2-head_sha",
                    SERIALIZED_VARIABLES: "{\"PR_HEAD_REF\":\"head_ref\",\"PR_HEAD_SHA\":\"head_sha\",\"PR_BASE_REF\":\"base_ref\",\"PR_BASE_SHA\":\"base_sha\",\"PR_MERGE_SHA\":\"0123456789abcdef\",\"PR_NUMBER\":1,\"PR_ACTION\":\"opened\",\"ROOT_DIR\":\"root_dir2\",\"shared_param\":\"shared_param\",\"COMMAND\":\"command2\",\"pipeline_param\":\"pipeline_param_2\"}",
                },
                name: "namespace1-module1-hook2-head_sha"
            }
        ]);
    });

    it('should trigger workflow with substituted command and args, for onSlashCommand when list of command tokens provided', async () => {
        const prCheckId = 1;
        const merge_commit_sha = "0123456789abcdef";
        const workflowDispatchMock = vi.fn().mockImplementation(() => {
            return {
                status: 204
            }
        });
        const getWorkflowMock = vi.fn().mockImplementation(() => {
            return {
                status: 200,
                data: {
                    state: "active"
                }
            }
        });
        const octokit = {
            rest: {
                actions: {
                    createWorkflowDispatch: workflowDispatchMock,
                    getWorkflow: getWorkflowMock
                },
                repos: {
                    getContent: vi.fn().mockImplementation(() => {
                        return {
                            status: 200,
                            data: {
                                content: Buffer.from(workflowYamlValid).toString('base64'),
                            }
                        }
                    })
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
                COMMAND: 'make ${command} ${args}',
                pipeline_param: "pipeline_param_1"
            },
            pipeline_ref: "feature/1",
            repo_full_name: "repo_full_name",
            shared_params: {
                ROOT_DIR: "root_dir1",
                shared_param: "shared_param"
            },
            path_to_gha_yaml: "namespace1/module1/.gha.yaml",
            pipeline_unique_prefix: "namespace1-module1-hook1",
            file_changes_matcher: "*.yaml",
            slash_command: 'validate',
            hook: "onSlashCommand" as HookType
        };
        triggeredHooks.add(hook1);
        // @ts-ignore
        const triggeredPipelineNames = await hooks.runWorkflow(octokit, pull_request, "opened", triggeredHooks, merge_commit_sha, prCheckId, ['validate', 'arg1', 'arg2'], ".yaml");
        expect(getWorkflowMock).toHaveBeenCalledWith({
            owner: "owner_login",
            repo: "repo_name",
            workflow_id: "pipeline_name_1.yaml"
        });
        expect(workflowDispatchMock).toHaveBeenCalledTimes(1);
        expect(workflowDispatchMock).toHaveBeenCalledWith({
            inputs: {
                COMMAND: "make validate arg1 arg2",
                PIPELINE_NAME: "namespace1-module1-hook1-head_sha",
                SERIALIZED_VARIABLES: "{\"PR_HEAD_REF\":\"head_ref\",\"PR_HEAD_SHA\":\"head_sha\",\"PR_BASE_REF\":\"base_ref\",\"PR_BASE_SHA\":\"base_sha\",\"PR_MERGE_SHA\":\"0123456789abcdef\",\"PR_NUMBER\":1,\"PR_ACTION\":\"opened\",\"ROOT_DIR\":\"root_dir1\",\"shared_param\":\"shared_param\",\"COMMAND\":\"make validate arg1 arg2\",\"pipeline_param\":\"pipeline_param_1\"}",
            },
            owner: "owner_login",
            ref: "feature/1",
            repo: "repo_name",
            workflow_id: "pipeline_name_1.yaml"
        });
        expect(workflowDispatchMock).toHaveBeenCalledTimes(1);
        expect(insertMock).toHaveBeenCalledTimes(1);
        expect(triggeredPipelineNames).toEqual([
            {
                inputs: {
                    COMMAND: "make validate arg1 arg2",
                    PIPELINE_NAME: "namespace1-module1-hook1-head_sha",
                    SERIALIZED_VARIABLES: "{\"PR_HEAD_REF\":\"head_ref\",\"PR_HEAD_SHA\":\"head_sha\",\"PR_BASE_REF\":\"base_ref\",\"PR_BASE_SHA\":\"base_sha\",\"PR_MERGE_SHA\":\"0123456789abcdef\",\"PR_NUMBER\":1,\"PR_ACTION\":\"opened\",\"ROOT_DIR\":\"root_dir1\",\"shared_param\":\"shared_param\",\"COMMAND\":\"make validate arg1 arg2\",\"pipeline_param\":\"pipeline_param_1\"}",
                },
                name: "namespace1-module1-hook1-head_sha"
            }
        ]);
    });

    it('should not trigger workflow, when workflow is not exist or inactive', async () => {
        const prCheckId = 1;
        const merge_commit_sha = "0123456789abcdej";
        const workflowDispatchMock = vi.fn().mockImplementation(() => {
            return {
                status: 204
            }
        });
        const getWorkflowMock = vi.fn().mockImplementation(() => {
            throw new Error("Workflow not found")
        });
        const octokit = {
            rest: {
                actions: {
                    createWorkflowDispatch: workflowDispatchMock,
                    getWorkflow: getWorkflowMock
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
            path_to_gha_yaml: "namespace1/module1/.gha.yaml",
            pipeline_unique_prefix: "namespace1-module1-hook1",
            file_changes_matcher: "*.yaml",
            slash_command: undefined,
            hook: "onPullRequest" as HookType
        };
        triggeredHooks.add(hook1);
        // @ts-ignore
        const triggeredPipelineNames = await hooks.runWorkflow(octokit, pull_request, "opened", triggeredHooks, merge_commit_sha, prCheckId, undefined, ".yaml");
        expect(getWorkflowMock).toHaveBeenCalledWith({
            owner: "owner_login",
            repo: "repo_name",
            workflow_id: "pipeline_name_1.yaml"
        });
        expect(getWorkflowMock).toHaveBeenCalledTimes(1);
        expect(workflowDispatchMock).not.toHaveBeenCalled();
        expect(insertMock).toBeCalledTimes(1);
        expect(triggeredPipelineNames).toEqual([
            {
                error: "Failed to get workflow pipeline_name_1.yaml, probably does not exist in repo owner_login/repo_name",
                inputs: {
                    PIPELINE_NAME: "namespace1-module1-hook1-head_sha",
                    SERIALIZED_VARIABLES: "{\"PR_HEAD_REF\":\"head_ref\",\"PR_HEAD_SHA\":\"head_sha\",\"PR_BASE_REF\":\"base_ref\",\"PR_BASE_SHA\":\"base_sha\",\"PR_MERGE_SHA\":\"0123456789abcdej\",\"PR_NUMBER\":1,\"PR_ACTION\":\"opened\",\"ROOT_DIR\":\"root_dir1\",\"shared_param\":\"shared_param\",\"COMMAND\":\"command1\",\"pipeline_param\":\"pipeline_param_1\"}",
                },
                name: "namespace1-module1-hook1-head_sha"
            }
        ]);
    });

    it('should not trigger workflow, when workflow required inputs are missing in context', async () => {
        const prCheckId = 1;
        const merge_commit_sha = "0123456789abcdej";
        const workflowDispatchMock = vi.fn().mockImplementation(() => {
            return {
                status: 204
            }
        });
        const getWorkflowMock = vi.fn().mockImplementation(() => {
            return {
                status: 200,
                data: {
                    state: "active"
                }
            }
        });
        const workflowYamlWithExtraInputs = `
        name: pipeline_name_1
        on:
          workflow_dispatch:
            inputs:
              PIPELINE_NAME:
                required: true
              SERIALIZED_VARIABLES:
                required: true
              EXTRA_INPUT_REQUIRED:
                required: true
              EXTRA_INPUT_OPTIONAL:
                required: false
              EXTRA_INPUT_DEFAULT:
                required: false
                default: "default_value"
        `;
        const octokit = {
            rest: {
                actions: {
                    createWorkflowDispatch: workflowDispatchMock,
                    getWorkflow: getWorkflowMock
                },
                repos: {
                    getContent: vi.fn().mockImplementation(() => {
                        return {
                            status: 200,
                            data: {
                                content: Buffer.from(workflowYamlWithExtraInputs).toString('base64'),
                            }
                        }
                    })
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
            path_to_gha_yaml: "namespace1/module1/.gha.yaml",
            pipeline_unique_prefix: "namespace1-module1-hook1",
            file_changes_matcher: "*.yaml",
            slash_command: undefined,
            hook: "onPullRequest" as HookType
        };
        triggeredHooks.add(hook1);
        // @ts-ignore
        const triggeredPipelineNames = await hooks.runWorkflow(octokit, pull_request, "opened", triggeredHooks, merge_commit_sha, prCheckId, undefined, ".yaml");
        expect(getWorkflowMock).toHaveBeenCalledWith({
            owner: "owner_login",
            repo: "repo_name",
            workflow_id: "pipeline_name_1.yaml"
        });
        expect(getWorkflowMock).toHaveBeenCalledTimes(1);
        expect(workflowDispatchMock).not.toHaveBeenCalled();
        expect(insertMock).toBeCalledTimes(1);
        expect(triggeredPipelineNames).toEqual([
            {
                error: "Workflow pipeline_name_1.yaml requires input EXTRA_INPUT_REQUIRED which is missing in SERIALIZED_VARIABLES and has no default value",
                inputs: {
                    PIPELINE_NAME: "namespace1-module1-hook1-head_sha",
                    SERIALIZED_VARIABLES: "{\"PR_HEAD_REF\":\"head_ref\",\"PR_HEAD_SHA\":\"head_sha\",\"PR_BASE_REF\":\"base_ref\",\"PR_BASE_SHA\":\"base_sha\",\"PR_MERGE_SHA\":\"0123456789abcdej\",\"PR_NUMBER\":1,\"PR_ACTION\":\"opened\",\"ROOT_DIR\":\"root_dir1\",\"shared_param\":\"shared_param\",\"COMMAND\":\"command1\",\"pipeline_param\":\"pipeline_param_1\"}",
                },
                name: "namespace1-module1-hook1-head_sha"
            }
        ]);
    });

    it('store new run into db, including errors', async () => {
        const pipelineUniquePrefix = 'gha-checks';
        const headSha = '1234567890';
        const merge_commit_sha = '1234567890';
        const pipeline_name = `${pipelineUniquePrefix}-${headSha}`;
        const inputs = {};
        const prNumber = 1;
        const prCheckId = 2;
        const HookType = "onPullRequest";
        await hooks.createNewRun(pipelineUniquePrefix, headSha, merge_commit_sha, pipeline_name, inputs, prNumber, prCheckId, HookType, true);
        expect(insertMock).toHaveBeenCalledWith({
            name: 'gha-checks',
            head_sha: headSha,
            merge_commit_sha: merge_commit_sha,
            pipeline_run_name: pipeline_name,
            workflow_run_inputs: inputs,
            pr_number: prNumber,
            pr_check_id: prCheckId,
            hook: 'onPullRequest',
            status: 'completed',
            conclusion: 'failure',
        });
    });

});