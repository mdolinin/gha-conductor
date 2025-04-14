import {afterEach, describe, expect, it, vi} from "vitest";
import {
    GhaChecks,
    GITHUB_CHECK_BYTESIZE_LIMIT,
    PRCheckAction,
    PRCheckName,
    ReRunPayload,
    SyncStatusPayload
} from "../src/gha_checks.js";
import pullRequestOpenedPayload from "./fixtures/pull_request.opened.json" with {type: "json"};
import workflowJobQueuedPayload from "./fixtures/workflow_job.queued.json" with {type: "json"};
import workflowJobInProgressPayload from "./fixtures/workflow_job.in_progress.json" with {type: "json"};
import workflowJobCompletedPayload from "./fixtures/workflow_job.completed.json" with {type: "json"};
import checkRunRequestedActionPayload from "./fixtures/check_run.requested_action.json" with {type: "json"};
import checkRunReRequestedPayload from "./fixtures/check_run.rerequested.json" with {type: "json"};

import {TriggeredWorkflow} from "../src/hooks.js";
import {Logger} from "probot";

const insertMock = vi.fn();
const findAllSuccess = vi.fn().mockImplementation(() => {
    return [
        {
            id: 1,
            name: 'gha-checks-1234567890',
            head_sha: '1234567890',
            merge_commit_sha: '1234567890',
            pipeline_run_name: 'gha-checks-1234567890',
            workflow_run_inputs: {},
            pr_number: 1,
            hook: 'onPullRequest',
            status: 'completed',
            pr_check_id: 4,
            conclusion: 'success',
            workflow_run_id: 5,
            check_run_id: 6
        }
    ]
});
let findAllMock = findAllSuccess;
const findOneMock = vi.fn().mockImplementation((query) => {
    return {
        id: 1,
        name: 'gha-checks-1234567890',
        head_sha: '1234567890',
        merge_commit_sha: '1234567890',
        pipeline_run_name: query.pipeline_run_name,
        workflow_run_inputs: {},
        pr_number: 1,
        hook: 'onPullRequest',
        check_run_id: 2,
        pr_check_id: 3,
        workflow_run_id: 5,
    }
});
const findMock = vi.fn().mockImplementation(() => {
    return {
        all: findAllMock
    }
});
const updateMock = vi.fn();

vi.mock('../src/db/database', async (importOriginal) => {
    const mod = await importOriginal();
    return {
        // @ts-ignore
        ...mod,
        gha_workflow_runs: vi.fn(() => {
            return {
                insert: insertMock,
                find: findMock,
                findOne: findOneMock,
                update: updateMock,
            };
        })
    }
});

const logMock = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
};

describe('gha_checks', () => {
    const checks = new GhaChecks(logMock as unknown as Logger);

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should create check if workflow run got error on attempt to trigger', async () => {
        const merge_commit_sha = '1234567890';
        let mock = vi.fn().mockImplementation(() => {
            return {
                data: {
                    id: 1,
                    status: 'completed',
                },
                status: 201,
            }
        });
        const octokit = {
            checks: {
                create: mock
            }
        }
        const erroredWorkflow: TriggeredWorkflow =
            {
                name: "namespace1-module1-hook1-b2a4cf69f2f60bc8d91cd23dcd80bf571736dee8",
                inputs: {
                    "PIPELINE_NAME": "namespace1-module1-hook1",
                },
                error: "ref feature/1 is not exist"
            };
        // @ts-ignore
        await checks.createWorkflowRunCheckErrored(octokit, pullRequestOpenedPayload.pull_request, 'onPullRequest', merge_commit_sha, erroredWorkflow);
        expect(mock).toHaveBeenCalledWith({
            completed_at: expect.anything(),
            conclusion: "failure",
            head_sha: pullRequestOpenedPayload.pull_request.head.sha,
            name: "namespace1-module1-hook1",
            output: {
                summary: expect.stringContaining("ref feature/1 is not exist"),
                title: "Workflow run errored"
            },
            owner: "mdolinin",
            repo: "mono-repo-example",
            status: "completed",
        });
        expect(updateMock).toHaveBeenCalledWith({
            pipeline_run_name: erroredWorkflow.name,
        }, {
            status: "completed",
            check_run_id: 1,
            workflow_run_url: "https://github.com/mdolinin/mono-repo-example/pull/27/checks?check_run_id=1"
        });
    });

    it('create pr-status check with status queued for PR event', async () => {
        const checkRunId = 1234;
        const hookType = 'onBranchMerge';
        const merge_commit_sha = '1234567890';
        let createCheckMock = vi.fn().mockImplementation(() => {
            return {
                data: {
                    id: checkRunId,
                },
                status: 201,
            }
        });
        const octokit = {
            checks: {
                create: createCheckMock
            }
        }
        // @ts-ignore
        const checkRun = await checks.createPRCheck(octokit, pullRequestOpenedPayload.pull_request, hookType, merge_commit_sha);
        expect(createCheckMock).toHaveBeenCalledWith({
            owner: pullRequestOpenedPayload.repository.owner.login,
            repo: pullRequestOpenedPayload.repository.name,
            name: PRCheckName.PRMerge,
            head_sha: merge_commit_sha,
            status: "queued",
            started_at: expect.anything(),
            output: {
                title: "Processing hooks",
                summary: `Processing hooks for ${hookType} to determine workflows to run`,
            }
        })
        expect(checkRun.checkRunId).toBe(checkRunId);
        expect(checkRun.checkName).toBe(PRCheckName.PRMerge);
        expect(checkRun.checkRunUrl).toBe(`https://github.com/mdolinin/mono-repo-example/pull/27/checks?check_run_id=${checkRunId}`);
        expect(checkRun.hookType).toBe(hookType);
    });

    it('update pr-status check if no pipelines triggered', async () => {
        const prCheck = {
            checkRunId: 1,
            checkName: PRCheckName.PRMerge,
            checkRunUrl: 'https://github.com/mdolinin/mono-repo-example/pull/27/checks?check_run_id=1',
            hookType: 'onBranchMerge'
        }
        let updateCheckMock = vi.fn().mockImplementation(() => {
            return {
                data: {
                    id: prCheck.checkRunId,
                },
                status: 201,
            }
        });
        const octokit = {
            checks: {
                update: updateCheckMock
            }
        }
        // @ts-ignore
        const checkRunUrl = await checks.updatePRCheckNoPipelinesTriggered(octokit, pullRequestOpenedPayload.pull_request, prCheck);
        expect(updateCheckMock).toHaveBeenCalledWith({
            owner: pullRequestOpenedPayload.repository.owner.login,
            repo: pullRequestOpenedPayload.repository.name,
            check_run_id: prCheck.checkRunId,
            status: "completed",
            conclusion: "success",
            completed_at: expect.anything(),
            output: {
                title: "No workflows to run",
                summary: `No workflows to run for hook ${prCheck.hookType}`
            },
        })
        expect(checkRunUrl).toBe(prCheck.checkRunUrl);
    });

    it('update pr-status check with annotations if yaml validation failed', async () => {
        const prCheck = {
            checkRunId: 1,
            checkName: PRCheckName.PRStatus,
            checkRunUrl: 'https://github.com/mdolinin/mono-repo-example/pull/27/checks?check_run_id=1',
            hookType: 'onPullRequest'
        }
        const annotationsForCheck = [{
            annotation_level: "failure" as "failure" | "warning" | "notice",
            message: "Unknown error",
            path: ".gha.yaml",
            start_line: 1,
            end_line: 1,
            start_column: 1,
            end_column: 1
        }];
        let updateCheckMock = vi.fn().mockImplementation(() => {
            return {
                data: {
                    id: prCheck.checkRunId,
                },
                status: 201,
            }
        });
        const octokit = {
            checks: {
                update: updateCheckMock
            }
        }
        // @ts-ignore
        const checkRunUrl = await checks.updatePRCheckWithAnnotations(octokit, pullRequestOpenedPayload.pull_request, prCheck, annotationsForCheck);
        expect(updateCheckMock).toHaveBeenCalledWith({
            owner: pullRequestOpenedPayload.repository.owner.login,
            repo: pullRequestOpenedPayload.repository.name,
            check_run_id: prCheck.checkRunId,
            status: "completed",
            conclusion: "failure",
            completed_at: expect.anything(),
            output: {
                summary: "Issues found in .gha.yml files",
                title: "Issues found in .gha.yml files",
                annotations: annotationsForCheck
            },
        });
        expect(checkRunUrl).toBe(prCheck.checkRunUrl);
    });

    it('create pr-status check when all pipelines failed to start', async () => {
        const prCheck = {
            checkRunId: 2,
            checkName: PRCheckName.PRStatus,
            checkRunUrl: 'https://github.com/mdolinin/mono-repo-example/pull/27/checks?check_run_id=2',
            hookType: 'onPullRequest'
        }
        const updateCheckMock = vi.fn().mockImplementation(() => {
            return {
                data: {
                    id: prCheck.checkRunId,
                },
                status: 201,
            }
        });
        const downloadJobLogsForWorkflowRunMock = vi.fn().mockImplementation(() => {
            return {
                data: 'logs',
                status: 200,
            }
        });
        const octokit = {
            checks: {
                update: updateCheckMock
            },
            actions: {
                downloadJobLogsForWorkflowRun: downloadJobLogsForWorkflowRunMock
            }
        }
        const erroredWorkflows: TriggeredWorkflow[] = [{
            name: "namespace2-module2-hook2-1234567890",
            inputs: {
                "PIPELINE_NAME": "namespace2-module2-hook2-1234567890",
            },
            error: "ref feature/2 is not exist"
        }];
        // @ts-ignore
        const checkRunUrl = await checks.updatePRCheckForAllErroredPipelines(octokit, pullRequestOpenedPayload.pull_request, prCheck, erroredWorkflows);
        expect(updateCheckMock).toHaveBeenCalledWith({
            owner: pullRequestOpenedPayload.repository.owner.login,
            repo: pullRequestOpenedPayload.repository.name,
            check_run_id: prCheck.checkRunId,
            status: "completed",
            conclusion: "failure",
            completed_at: expect.anything(),
            output: {
                summary: expect.stringContaining("ref feature/2 is not exist"),
                title: "All workflows errored. Nothing to do"
            },
        });
        expect(updateMock).toHaveBeenCalledWith({
            hook: 'onPullRequest',
            pr_check_id: prCheck.checkRunId,
            pr_number: pullRequestOpenedPayload.pull_request.number,
        }, {
            pr_conclusion: "failure",
        });
        expect(checkRunUrl).toBe(prCheck.checkRunUrl);
    });

    it('update pr-status check for triggered pipelines', async () => {
        const prCheck = {
            checkRunId: 3,
            checkName: PRCheckName.PRStatus,
            checkRunUrl: 'https://github.com/mdolinin/mono-repo-example/pull/27/checks?check_run_id=3',
            hookType: 'onPullRequest'
        }
        const updateCheckMock = vi.fn().mockImplementation(() => {
            return {
                data: {
                    id: prCheck.checkRunId,
                },
                status: 201,
            }
        });
        const downloadJobLogsForWorkflowRunMock = vi.fn().mockImplementation(() => {
            return {
                data: 'logs',
                status: 200,
            }
        });
        const octokit = {
            checks: {
                update: updateCheckMock
            },
            actions: {
                downloadJobLogsForWorkflowRun: downloadJobLogsForWorkflowRunMock
            }
        }
        // @ts-ignore
        const checkRunUrl = await checks.updatePRCheckForTriggeredPipelines(octokit, pullRequestOpenedPayload.pull_request, prCheck);
        expect(findMock).toHaveBeenCalledWith({
            pr_number: pullRequestOpenedPayload.pull_request.number,
            pr_check_id: prCheck.checkRunId,
            hook: 'onPullRequest'
        });
        expect(findAllMock).toHaveBeenCalled();
        expect(updateCheckMock).toHaveBeenCalledWith({
            owner: pullRequestOpenedPayload.repository.owner.login,
            repo: pullRequestOpenedPayload.repository.name,
            check_run_id: prCheck.checkRunId,
            status: "queued",
            output: {
                title: "Workflow runs are queued",
                summary: expect.anything()
            },
            actions: [
                {
                    description: "Sync current workflow status",
                    identifier: "sync-status",
                    label: "Sync status",
                }
            ]
        });
        expect(downloadJobLogsForWorkflowRunMock).toHaveBeenCalledTimes(1);
        expect(updateMock).toHaveBeenCalledTimes(0);
        expect(checkRunUrl).toBe(prCheck.checkRunUrl);
    });

    it('should update check, when workflow run queued', async () => {
        const createCheckMock = vi.fn().mockImplementation(() => {
            return {
                data: {
                    id: 1,
                    status: 'queued',
                    details_url: ''
                },
                status: 201,
            }
        });
        const octokit = {
            checks: {
                create: createCheckMock
            },
        };
        // @ts-ignore
        await checks.updateWorkflowRunCheckQueued(octokit, workflowJobQueuedPayload, 1);
        expect(findOneMock).toHaveBeenCalledWith({
            pipeline_run_name: workflowJobQueuedPayload.workflow_job.name,
        });
        expect(createCheckMock).toHaveBeenCalledWith({
            details_url: 'https://github.com/mdolinin/mono-repo-example/actions/runs/7856385885',
            head_sha: 'b2a4cf69f2f60bc8d91cd23dcd80bf571736dee8',
            name: 'domain-a-example-b-build',
            status: 'queued',
            owner: workflowJobQueuedPayload.repository.owner.login,
            repo: workflowJobQueuedPayload.repository.name,
            started_at: expect.anything(),
            output: {
                title: "Workflow runs are queued",
                summary: expect.anything()
            }
        });
        expect(updateMock).toHaveBeenCalledWith({
            pipeline_run_name: workflowJobQueuedPayload.workflow_job.name,
        }, {
            check_run_id: 1,
            status: "queued",
            workflow_job_id: 21439086539,
            workflow_run_id: 1,
            workflow_run_url: ''
        });
    });

    it('should update check, when workflow run in progress', async () => {
        const updateCheckMock = vi.fn().mockImplementation(() => {
            return {
                data: {
                    id: 2,
                    status: 'in_progress',
                    details_url: ''
                },
                status: 200,
            }
        });
        const octokit = {
            checks: {
                update: updateCheckMock
            }
        }
        // @ts-ignore
        await checks.updateWorkflowRunCheckInProgress(octokit, workflowJobInProgressPayload);
        expect(findOneMock).toHaveBeenCalledWith({
            pipeline_run_name: workflowJobInProgressPayload.workflow_job.name,
        });
        expect(updateCheckMock).toHaveBeenCalledWith({
            check_run_id: 2,
            output: expect.anything(),
            owner: workflowJobInProgressPayload.repository.owner.login,
            repo: workflowJobInProgressPayload.repository.name,
            status: "in_progress",
        });
        expect(updateMock).toHaveBeenCalledWith({
            pipeline_run_name: workflowJobInProgressPayload.workflow_job.name,
            check_run_id: 2,
        }, {
            status: "in_progress",
            conclusion: null
        });
    });

    it('should update check, when workflow run completed', async () => {
        const updateCheckMock = vi.fn().mockImplementation(() => {
            return {
                data: {
                    id: 2,
                    status: 'completed',
                    details_url: '',
                    conclusion: 'success'
                },
                status: 200,
            }
        });
        const downloadJobLogsForWorkflowRunMock = vi.fn().mockImplementation(() => {
            return {
                data: 'logs',
                status: 200,
            }
        });
        const octokit = {
            checks: {
                update: updateCheckMock
            },
            actions: {
                downloadJobLogsForWorkflowRun: downloadJobLogsForWorkflowRunMock
            }
        }
        // @ts-ignore
        await checks.updateWorkflowRunCheckCompleted(octokit, workflowJobCompletedPayload);
        expect(findOneMock).toHaveBeenCalledWith({
            pipeline_run_name: workflowJobCompletedPayload.workflow_job.name,
        });
        expect(updateCheckMock).toHaveBeenCalledWith({
            check_run_id: 2,
            output: expect.anything(),
            conclusion: "success",
            completed_at: expect.anything(),
            owner: workflowJobCompletedPayload.repository.owner.login,
            repo: workflowJobCompletedPayload.repository.name,
            status: "completed",
        });
        expect(updateMock).toHaveBeenCalledWith({
            pipeline_run_name: workflowJobCompletedPayload.workflow_job.name,
            check_run_id: 2,
        }, {
            status: "completed",
            conclusion: "success"
        });
    });

    it('should update pr-status check, when workflow run in progress', async () => {
        const updateCheckMock = vi.fn().mockImplementation(() => {
            return {
                data: {
                    id: 2,
                    status: 'in_progress',
                    details_url: ''
                },
                status: 200,
            }
        });
        const downloadJobLogsForWorkflowRunMock = vi.fn().mockImplementation(() => {
            return {
                data: 'logs',
                status: 200,
            }
        });
        const octokit = {
            checks: {
                update: updateCheckMock
            },
            actions: {
                downloadJobLogsForWorkflowRun: downloadJobLogsForWorkflowRunMock
            }
        }
        // @ts-ignore
        await checks.updatePRStatusCheckInProgress(octokit, workflowJobInProgressPayload);
        expect(findOneMock).toHaveBeenCalledWith({
            pipeline_run_name: workflowJobInProgressPayload.workflow_job.name,
        });
        expect(findMock).toHaveBeenCalledWith({
            pr_number: 1,
            hook: 'onPullRequest',
            pr_check_id: 3,
        });
        expect(findAllMock).toHaveBeenCalled();
        expect(updateCheckMock).toHaveBeenCalledWith({
            check_run_id: 3,
            output: expect.anything(),
            owner: workflowJobInProgressPayload.repository.owner.login,
            repo: workflowJobInProgressPayload.repository.name,
            status: "in_progress",
            actions: [
                {
                    description: "Sync current workflow status",
                    identifier: "sync-status",
                    label: "Sync status",
                }
            ]
        });
        expect(updateMock).not.toHaveBeenCalled();
    });

    it('should update pr-status check, when workflow run completed', async () => {
        const updateCheckMock = vi.fn().mockImplementation(() => {
            return {
                data: {
                    id: 2,
                    status: 'completed',
                    details_url: '',
                    conclusion: 'success'
                },
                status: 200,
            }
        });
        const downloadJobLogsForWorkflowRunMock = vi.fn().mockImplementation(() => {
            return {
                data: 'logs',
                status: 200,
            }
        });
        const octokit = {
            checks: {
                update: updateCheckMock
            },
            actions: {
                downloadJobLogsForWorkflowRun: downloadJobLogsForWorkflowRunMock
            }
        }
        // @ts-ignore
        await checks.updatePRStatusCheckCompleted(octokit, workflowJobCompletedPayload);
        expect(findOneMock).toHaveBeenCalledWith({
            pipeline_run_name: workflowJobCompletedPayload.workflow_job.name,
        });
        expect(findMock).toHaveBeenCalledWith({
            pr_check_id: 3,
            pr_number: 1,
        });
        expect(findAllMock).toHaveBeenCalled();
        expect(updateCheckMock).toHaveBeenCalledWith({
            check_run_id: 4,
            output: expect.anything(),
            conclusion: "success",
            completed_at: expect.anything(),
            owner: workflowJobCompletedPayload.repository.owner.login,
            repo: workflowJobCompletedPayload.repository.name,
            status: "completed",
            actions: [
                {
                    description: "Re-run all workflows",
                    identifier: "re-run",
                    label: "Re-run",
                },
                {
                    description: "Sync current workflow status",
                    identifier: "sync-status",
                    label: "Sync status",
                }
            ]
        });
        expect(updateMock).toHaveBeenCalledWith({
            pr_check_id: 4,
        }, {
            pr_conclusion: "success"
        });
    });

    it('should update pr-merge check and add comment to PR, when workflow run completed with failure', async () => {
        findAllMock = vi.fn().mockImplementation(() => {
            return [
                {
                    id: 1,
                    name: 'gha-checks-1234567890',
                    head_sha: '1234567890',
                    merge_commit_sha: '1234567890',
                    pipeline_run_name: 'gha-checks-1234567890',
                    workflow_run_inputs: {},
                    pr_number: 1,
                    hook: 'onBranchMerge',
                    status: 'completed',
                    pr_check_id: 4,
                    conclusion: 'failure',
                    workflow_run_id: 5,
                }
            ]
        });
        const updateCheckMock = vi.fn().mockImplementation(() => {
            return {
                data: {
                    id: 3,
                    status: 'completed',
                    details_url: '',
                    conclusion: 'failure'
                },
                status: 200,
            }
        });
        const downloadJobLogsForWorkflowRunMock = vi.fn().mockImplementation(() => {
            return {
                data: 'logs',
                status: 200,
            }
        });
        const createCommentMock = vi.fn();
        const octokit = {
            checks: {
                update: updateCheckMock
            },
            actions: {
                downloadJobLogsForWorkflowRun: downloadJobLogsForWorkflowRunMock
            },
            issues: {
                createComment: createCommentMock
            }
        }
        // @ts-ignore
        await checks.updatePRStatusCheckCompleted(octokit, workflowJobCompletedPayload);
        expect(findOneMock).toHaveBeenCalledWith({
            pipeline_run_name: workflowJobCompletedPayload.workflow_job.name,
        });
        expect(findMock).toHaveBeenCalledWith({
            pr_check_id: 3,
            pr_number: 1,
        });
        expect(findAllMock).toHaveBeenCalled();
        findAllMock = findAllSuccess;
        expect(downloadJobLogsForWorkflowRunMock).toBeCalledTimes(1);
        expect(updateCheckMock).toHaveBeenCalledWith({
            check_run_id: 4,
            output: expect.anything(),
            conclusion: "failure",
            completed_at: expect.anything(),
            owner: workflowJobCompletedPayload.repository.owner.login,
            repo: workflowJobCompletedPayload.repository.name,
            status: "completed",
            actions: [
                {
                    description: "Re-run all workflows",
                    identifier: "re-run",
                    label: "Re-run",
                },
                {
                    description: "Sync current workflow status",
                    identifier: "sync-status",
                    label: "Sync status",
                },
                {
                    description: "Re-run failed workflows",
                    identifier: "re-run-failed",
                    label: "Re-run failed",
                }
            ]
        });
        expect(updateMock).toHaveBeenCalledWith({
            pr_check_id: 4,
        }, {
            pr_conclusion: "failure"
        });
        expect(createCommentMock).toHaveBeenCalledWith({
            owner: 'mdolinin',
            repo: 'mono-repo-example',
            issue_number: 1,
            body: expect.stringContaining("# pr-merge completed with failure\n**[Check run](https://github.com/mdolinin/mono-repo-example/runs/4)**"),
        });
    });

    it('should trigger re-run of all workflows, when re-all button clicked', async () => {
        const reRunPayload: ReRunPayload = {
            check_run_id: checkRunRequestedActionPayload.check_run.id,
            owner: checkRunRequestedActionPayload.repository.owner.login,
            repo: checkRunRequestedActionPayload.repository.name,
            requested_action_identifier: PRCheckAction.ReRun,
        };
        const createCheckMock = vi.fn().mockImplementation(() => {
            return {
                data: {
                    id: 21439086478,
                    status: 'queued',
                    details_url: ''
                },
                status: 201,
            }
        });
        const reRunWorkflowMock = vi.fn().mockImplementation(() => {
            return {
                data: {
                    id: 21439086478,
                    status: 'queued',
                    details_url: ''
                },
                status: 201,
            }
        });
        const octokit = {
            checks: {
                create: createCheckMock,
            },
            actions: {
                reRunWorkflow: reRunWorkflowMock
            }
        };
        // @ts-ignore
        await checks.triggerReRunPRCheck(octokit, reRunPayload);
        expect(findMock).toHaveBeenCalledWith({
            pr_check_id: reRunPayload.check_run_id,
            pr_conclusion: expect.objectContaining({
                "__query": expect.anything(),
                "__special": {
                    query: null,
                    type: "not",
                }
            })
        });
        expect(findAllMock).toHaveBeenCalled();
        expect(updateMock).toHaveBeenCalledWith({
            workflow_run_id: 5,
        }, {
            workflow_job_id: null,
            conclusion: null,
            pr_conclusion: null,
        });
        expect(createCheckMock).toHaveBeenCalledWith({
            head_sha: '1234567890',
            name: 'pr-status',
            owner: checkRunRequestedActionPayload.repository.owner.login,
            repo: checkRunRequestedActionPayload.repository.name,
            status: 'queued',
            started_at: expect.anything(),
            output: {
                title: "Workflows re-run in progress",
                summary: "All workflows that belong to this check are re-run",
            },
            actions: [{
                description: "Sync current workflow status",
                identifier: "sync-status",
                label: "Sync status",
            }]
        });
        expect(updateMock).toHaveBeenCalledWith({
            pr_check_id: reRunPayload.check_run_id,
        }, {
            pr_check_id: 21439086478,
            pr_conclusion: null,
        });
        expect(reRunWorkflowMock).toHaveBeenCalledWith({
            owner: checkRunRequestedActionPayload.repository.owner.login,
            repo: checkRunRequestedActionPayload.repository.name,
            run_id: 5,
        });
    });

    it('should trigger re-run of only failed workflows, when re-run-failed button clicked', async () => {
        const reRunPayload: ReRunPayload = {
            check_run_id: checkRunRequestedActionPayload.check_run.id,
            owner: checkRunRequestedActionPayload.repository.owner.login,
            repo: checkRunRequestedActionPayload.repository.name,
            requested_action_identifier: PRCheckAction.ReRunFailed,
        };
        const createCheckMock = vi.fn().mockImplementation(() => {
            return {
                data: {
                    id: 21439086479,
                    status: 'queued',
                    details_url: ''
                },
                status: 201,
            }
        });
        const reRunWorkflowMock = vi.fn().mockImplementation(() => {
            return {
                data: {
                    id: 21439086478,
                    status: 'queued',
                    details_url: ''
                },
                status: 201,
            }
        });
        const octokit = {
            checks: {
                create: createCheckMock,
            },
            actions: {
                reRunWorkflow: reRunWorkflowMock
            }
        };
        // @ts-ignore
        await checks.triggerReRunPRCheck(octokit, reRunPayload);
        expect(findMock).toHaveBeenCalledWith({
            conclusion: expect.objectContaining({
                "__query": expect.anything(),
                "__special": undefined
            }),
            pr_check_id: reRunPayload.check_run_id,
            pr_conclusion: expect.objectContaining({
                "__query": expect.anything(),
                "__special": {
                    query: null,
                    type: "not",
                }
            })
        });
        expect(findAllMock).toHaveBeenCalled();
        expect(updateMock).toHaveBeenCalledWith({
            workflow_run_id: 5,
        }, {
            workflow_job_id: null,
            conclusion: null,
            pr_conclusion: null,
        });
        expect(createCheckMock).toHaveBeenCalledWith({
            head_sha: '1234567890',
            name: 'pr-status',
            owner: checkRunRequestedActionPayload.repository.owner.login,
            repo: checkRunRequestedActionPayload.repository.name,
            status: 'queued',
            started_at: expect.anything(),
            output: {
                title: "Workflows re-run in progress",
                summary: "All workflows that belong to this check are re-run",
            },
            actions: [{
                description: "Sync current workflow status",
                identifier: "sync-status",
                label: "Sync status",
            }]
        });
        expect(updateMock).toHaveBeenCalledWith({
            pr_check_id: reRunPayload.check_run_id,
        }, {
            pr_check_id: 21439086479,
            pr_conclusion: null,
        });
        expect(reRunWorkflowMock).toHaveBeenCalledWith({
            owner: checkRunRequestedActionPayload.repository.owner.login,
            repo: checkRunRequestedActionPayload.repository.name,
            run_id: 5,
        });
    });

    it('should trigger re-run of all workflows, when re-all link clicked', async () => {
        const createCheckMock = vi.fn().mockImplementation(() => {
            return {
                data: {
                    id: 21439086478,
                    status: 'queued',
                    details_url: ''
                },
                status: 201,
            }
        });
        const reRunWorkflowMock = vi.fn().mockImplementation(() => {
            return {
                data: {
                    id: 21439086478,
                    status: 'queued',
                    details_url: ''
                },
                status: 201,
            }
        });
        const octokit = {
            checks: {
                create: createCheckMock,
            },
            actions: {
                reRunWorkflow: reRunWorkflowMock
            }
        };
        // @ts-ignore
        await checks.triggerReRunWorkflowRunCheck(octokit, checkRunReRequestedPayload);
        expect(findOneMock).toHaveBeenCalledWith({
            check_run_id: checkRunReRequestedPayload.check_run.id,
            pr_conclusion: expect.objectContaining({
                "__query": expect.anything(),
                "__special": {
                    query: null,
                    type: "not",
                }
            })
        });
        expect(updateMock).toHaveBeenCalledWith({
            workflow_run_id: 5,
        }, {
            workflow_job_id: null,
            conclusion: null,
            pr_conclusion: null,
        });
        expect(createCheckMock).toHaveBeenCalledWith({
            head_sha: '1234567890',
            name: 'pr-status',
            owner: checkRunRequestedActionPayload.repository.owner.login,
            repo: checkRunRequestedActionPayload.repository.name,
            status: 'queued',
            started_at: expect.anything(),
            output: {
                title: "Workflows re-run in progress",
                summary: "All workflows that belong to this check are re-run",
            },
            actions: [{
                description: "Sync current workflow status",
                identifier: "sync-status",
                label: "Sync status",
            }]
        });
        expect(updateMock).toHaveBeenCalledWith({
            pr_check_id: 3,
        }, {
            pr_check_id: 21439086478,
            pr_conclusion: null,
        });
        expect(reRunWorkflowMock).toHaveBeenCalledWith({
            owner: checkRunRequestedActionPayload.repository.owner.login,
            repo: checkRunRequestedActionPayload.repository.name,
            run_id: 5,
        });
    });

    it('update pr-close check when PR closed hook triggered', async () => {
        const prCheck = {
            checkRunId: 4,
            checkName: PRCheckName.PRClose,
            checkRunUrl: 'https://github.com/mdolinin/mono-repo-example/pull/27/checks?check_run_id=4',
            hookType: 'onPullRequestClose'
        }
        const updateCheckMock = vi.fn().mockImplementation(() => {
            return {
                data: {
                    id: prCheck.checkRunId,
                },
                status: 201,
            }
        });
        const downloadJobLogsForWorkflowRunMock = vi.fn().mockImplementation(() => {
            return {
                data: 'logs',
                status: 200,
            }
        });
        const octokit = {
            checks: {
                update: updateCheckMock
            },
            actions: {
                downloadJobLogsForWorkflowRun: downloadJobLogsForWorkflowRunMock
            }
        }
        // @ts-ignore
        const checkRunUrl = await checks.updatePRCheckForTriggeredPipelines(octokit, pullRequestOpenedPayload.pull_request, prCheck);
        expect(checkRunUrl).toBe(prCheck.checkRunUrl);
        expect(findMock).toHaveBeenCalledWith({
            pr_number: pullRequestOpenedPayload.pull_request.number,
            pr_check_id: prCheck.checkRunId,
            hook: 'onPullRequestClose'
        });
        expect(findAllMock).toHaveBeenCalled();
        expect(updateCheckMock).toHaveBeenCalledTimes(1);
        expect(downloadJobLogsForWorkflowRunMock).toHaveBeenCalledTimes(1);
        expect(updateMock).toHaveBeenCalledTimes(0);
    });

    it('update pr-slash-command check when slash command hook triggered', async () => {
        const prCheck = {
            checkRunId: 5,
            checkName: PRCheckName.PRSlashCommand,
            checkRunUrl: 'https://github.com/mdolinin/mono-repo-example/pull/27/checks?check_run_id=5',
            hookType: 'onSlashCommand'
        }
        const updateCheckMock = vi.fn().mockImplementation(() => {
            return {
                data: {
                    id: prCheck.checkRunId,
                },
                status: 201,
            }
        });
        const downloadJobLogsForWorkflowRunMock = vi.fn().mockImplementation(() => {
            return {
                data: 'logs',
                status: 200,
            }
        });
        const octokit = {
            checks: {
                update: updateCheckMock
            },
            actions: {
                downloadJobLogsForWorkflowRun: downloadJobLogsForWorkflowRunMock
            }
        }
        // @ts-ignore
        const checkRunUrl = await checks.updatePRCheckForTriggeredPipelines(octokit, pullRequestOpenedPayload.pull_request, prCheck);
        expect(checkRunUrl).toBe(prCheck.checkRunUrl);
        expect(findMock).toHaveBeenCalledWith({
            pr_number: pullRequestOpenedPayload.pull_request.number,
            pr_check_id: prCheck.checkRunId,
            hook: 'onSlashCommand'
        });
        expect(findAllMock).toHaveBeenCalled();
        expect(updateCheckMock).toHaveBeenCalledTimes(1);
        expect(downloadJobLogsForWorkflowRunMock).toHaveBeenCalledTimes(1);
        expect(updateMock).toHaveBeenCalledTimes(0);
    });

    it('should update PR check status based on current aggregated workflow run statuses', async () => {
        const syncStatusPayload: SyncStatusPayload = {
            check_run_id: 1,
            owner: 'mdolinin',
            repo: 'mono-repo-example',
        };

        const getWorkflowRunMock = vi.fn().mockImplementation(() => {
            return {
                data: {
                    status: 'completed',
                    conclusion: 'success',
                },
                status: 200,
            }
        });

        const updateCheckMock = vi.fn().mockImplementation(() => {
            return {
                data: {
                    id: 1,
                    status: 'completed',
                    conclusion: 'success',
                    details_url: ''
                },
                status: 200,
            }
        });

        const downloadJobLogsForWorkflowRunMock = vi.fn().mockImplementation(() => {
            return {
                data: 'logs',
                status: 200,
            }
        });

        const octokit = {
            checks: {
                update: updateCheckMock,
            },
            actions: {
                getWorkflowRun: getWorkflowRunMock,
                downloadJobLogsForWorkflowRun: downloadJobLogsForWorkflowRunMock
            }
        };

        // @ts-ignore
        await checks.syncPRCheckStatus(octokit, syncStatusPayload);
        // Find all workflow runs associated with this check
        expect(findMock).toHaveBeenCalledWith({
            pr_check_id: syncStatusPayload.check_run_id,
        });
        // For each workflow run, get its status
        expect(getWorkflowRunMock).toHaveBeenCalledWith({
            owner: syncStatusPayload.owner,
            repo: syncStatusPayload.repo,
            run_id: 5,
        });
        // For each workflow run, download its logs
        expect(downloadJobLogsForWorkflowRunMock).toHaveBeenCalledTimes(1);
        // For each workflow run, update its status in GitHub
        expect(updateCheckMock).toHaveBeenCalledWith({
            owner: 'mdolinin',
            repo: 'mono-repo-example',
            check_run_id: 6,
            status: 'completed',
            conclusion: 'success',
            completed_at: expect.anything(),
            output: {
                title: 'Workflow run completed',
                summary: expect.anything()
            },
        });
        // For each workflow run, update its status in database
        expect(updateMock).toHaveBeenCalledWith({
            pipeline_run_name: 'gha-checks-1234567890',
            check_run_id: 6,
        }, {
            status: 'completed',
            conclusion: 'success',
        });
        expect(updateMock).toHaveBeenCalledTimes(1);
        // Refresh workflow runs data after updates
        expect(findAllMock).toHaveBeenCalledTimes(2);
        // Update PR check status in GitHub
        expect(updateCheckMock).toHaveBeenCalledWith({
            owner: 'mdolinin',
            repo: 'mono-repo-example',
            check_run_id: 1,
            status: 'completed',
            conclusion: 'success',
            completed_at: expect.anything(),
            output: {
                title: 'All workflow runs completed',
                summary: expect.anything()
            },
            actions: [
                {
                    description: "Re-run all workflows",
                    identifier: "re-run",
                    label: "Re-run",
                },
                {
                    description: "Sync current workflow status",
                    identifier: "sync-status",
                    label: "Sync status",
                }
            ]
        });
    });

    it.each([0, 1, 10, 300, 1000])('github check summary for \'%s\' workflow runs should not go over limit', async (numberOfWorkflowRuns) => {
        const veryLongString = "😀".repeat(GITHUB_CHECK_BYTESIZE_LIMIT + 1000);
        const octokit = {
            actions: {
                downloadJobLogsForWorkflowRun: vi.fn().mockImplementation(() => {
                    return {
                        data: veryLongString
                    }
                })
            }
        }
        const randomWorkflowRuns = (amount: number) => Array.from({length: amount}, () => {
            return {
                status: "completed",
                conclusion: "success",
                workflow_job_id: 1,
                workflow_run_url: `https://github.com/mdolinin/mono-repo-example/actions/runs/${Math.floor(Math.random() * 10000000000)}`,
                workflow_run_inputs: {"PIPELINE_NAME": "namespace1-module1-hook1"}
            }
        });
        // @ts-ignore
        const summary = await checks.formatGHCheckSummaryAll(octokit, "test_owner", "test_repo", randomWorkflowRuns(numberOfWorkflowRuns), "completed");
        const summaryBytes = new TextEncoder().encode(summary);
        expect(summaryBytes.length).toBeLessThanOrEqual(GITHUB_CHECK_BYTESIZE_LIMIT);
    });

    it('should find pr-status check id by commit sha', async () => {
        const listForRefMock = vi.fn().mockImplementation(() => {
            return {
                data: {
                    check_runs: [
                        {
                            id: 1234567890,
                            name: 'pr-status',
                        }
                    ]
                }
            }
        });
        const commitSha = 'a5ede490bb1594ebb28abb77f6d10cf74dbf6513';
        const owner = 'mdolinin';
        const repo = 'mono-repo-example';
        const octokit = {
            checks: {
                listForRef: listForRefMock,
            },
            paginate: vi.fn().mockImplementation((fn: any, args: any) => {
                return fn(args).data.check_runs;
            })
        }
        // @ts-ignore
        const prStatusCheckId = await checks.findPRStatusCheckIdForCommit(octokit, owner, repo, commitSha);
        expect(prStatusCheckId).toEqual(1234567890);
        expect(listForRefMock).toHaveBeenCalledWith({
            owner: owner,
            repo: repo,
            ref: commitSha,
        });
    });
});
