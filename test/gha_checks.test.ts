import {GhaChecks, PRCheckAction, ReRunPayload} from "../src/gha_checks";
import pullRequestOpenedPayload from "./fixtures/pull_request.opened.json";
import workflowJobQueuedPayload from "./fixtures/workflow_job.queued.json";
import workflowJobInProgressPayload from "./fixtures/workflow_job.in_progress.json";
import workflowJobCompletedPayload from "./fixtures/workflow_job.completed.json";
import checkRunRequestedActionPayload from "./fixtures/check_run.requested_action.json";
import checkRunReRequestedPayload from "./fixtures/check_run.rerequested.json";

import {TriggeredWorkflow} from "../src/hooks";
import {Logger} from "probot";

const insertMock = jest.fn();
const findAllSuccess = jest.fn().mockImplementation(() => {
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
        }
    ]
});
let findAllMock = findAllSuccess;
const findOneMock = jest.fn().mockImplementation(() => {
    return {
        id: 1,
        name: 'gha-checks-1234567890',
        head_sha: '1234567890',
        merge_commit_sha: '1234567890',
        pipeline_run_name: 'gha-checks-1234567890',
        workflow_run_inputs: {},
        pr_number: 1,
        hook: 'onPullRequest',
        check_run_id: 2,
        pr_check_id: 3,
    }
});
const findMock = jest.fn().mockImplementation(() => {
    return {
        all: findAllMock
    }
});
const updateMock = jest.fn();

jest.mock('../src/db/database', () => {
    return {
        gha_workflow_runs: jest.fn(() => {
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
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
};

describe('gha_checks', () => {
    const checks = new GhaChecks(logMock as unknown as Logger);

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should create check if workflow run got error on attempt to trigger', async () => {
        const merge_commit_sha = '1234567890';
        let mock = jest.fn().mockImplementation(() => {
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
            workflow_job_id: null
        }, {
            status: "completed",
            check_run_id: 1,
            workflow_run_url: "https://github.com/mdolinin/mono-repo-example/pull/27/checks?check_run_id=1"
        });
    });

    it('create pr-status check if no pipelines triggered', async () => {
        const merge_commit_sha = '1234567890';
        let createCheckMock = jest.fn().mockImplementation(() => {
            return {
                data: {
                    id: 1,
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
        const checkRunUrl = await checks.createPRCheckNoPipelinesTriggered(octokit, pullRequestOpenedPayload.pull_request, 'onBranchMerge', merge_commit_sha);
        expect(createCheckMock).toHaveBeenCalled();
        expect(checkRunUrl).toBe('https://github.com/mdolinin/mono-repo-example/pull/27/checks?check_run_id=1');
    });

    it('create pr-status check with annotations if yaml validation failed', async () => {
        const annotationsForCheck = [{
            annotation_level: "failure" as "failure" | "warning" | "notice",
            message: "Unknown error",
            path: ".gha.yaml",
            start_line: 1,
            end_line: 1,
            start_column: 1,
            end_column: 1
        }];
        // const merge_commit_sha = '1234567890';
        let createCheckMock = jest.fn().mockImplementation(() => {
            return {
                data: {
                    id: 1,
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
        const checkRunUrl = await checks.createPRCheckWithAnnotations(octokit, pullRequestOpenedPayload.pull_request, 'onPullRequest', annotationsForCheck);
        expect(createCheckMock).toHaveBeenCalledWith({
            completed_at: expect.anything(),
            conclusion: "failure",
            head_sha: pullRequestOpenedPayload.pull_request.head.sha,
            name: "pr-status",
            output: {
                summary: "Issues found in .gha.yml files",
                title: "Issues found in .gha.yml files",
                annotations: annotationsForCheck
            },
            owner: "mdolinin",
            repo: "mono-repo-example",
            status: "completed",
        });
        expect(checkRunUrl).toBe('https://github.com/mdolinin/mono-repo-example/pull/27/checks?check_run_id=1');
    });

    it('create pr-status check when all pipelines failed to start', async () => {
        const merge_commit_sha = '1234567890';
        const createCheckMock = jest.fn().mockImplementation(() => {
            return {
                data: {
                    id: 2,
                },
                status: 201,
            }
        });
        const downloadJobLogsForWorkflowRunMock = jest.fn().mockImplementation(() => {
            return {
                data: 'logs',
                status: 200,
            }
        });
        const octokit = {
            checks: {
                create: createCheckMock
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
        const checkRunUrl = await checks.createPRCheckForAllErroredPipelines(octokit, pullRequestOpenedPayload.pull_request, 'onPullRequest', merge_commit_sha, erroredWorkflows);
        expect(createCheckMock).toHaveBeenCalledWith({
            completed_at: expect.anything(),
            conclusion: "failure",
            head_sha: pullRequestOpenedPayload.pull_request.head.sha,
            name: "pr-status",
            output: {
                summary: expect.stringContaining("ref feature/2 is not exist"),
                title: "All workflows errored. Nothing to do"
            },
            owner: "mdolinin",
            repo: "mono-repo-example",
            status: "completed",
        });
        expect(updateMock).toHaveBeenCalledWith({
            hook: 'onPullRequest',
            pr_check_id: null,
            pr_number: pullRequestOpenedPayload.pull_request.number,
        }, {
            pr_check_id: 2,
            pr_conclusion: "failure",
        });
        expect(checkRunUrl).toBe('https://github.com/mdolinin/mono-repo-example/pull/27/checks?check_run_id=2');
    });

    it('create pr-status check for triggered pipelines', async () => {
        const merge_commit_sha = '1234567890';
        const createCheckMock = jest.fn().mockImplementation(() => {
            return {
                data: {
                    id: 3,
                },
                status: 201,
            }
        });
        const downloadJobLogsForWorkflowRunMock = jest.fn().mockImplementation(() => {
            return {
                data: 'logs',
                status: 200,
            }
        });
        const octokit = {
            checks: {
                create: createCheckMock
            },
            actions: {
                downloadJobLogsForWorkflowRun: downloadJobLogsForWorkflowRunMock
            }
        }
        // @ts-ignore
        const checkRunUrl = await checks.createPRCheckForTriggeredPipelines(octokit, pullRequestOpenedPayload.pull_request, 'onPullRequest', merge_commit_sha);
        expect(findMock).toHaveBeenCalledWith({
            pr_number: pullRequestOpenedPayload.pull_request.number,
            pr_check_id: null,
            hook: 'onPullRequest'
        });
        expect(findAllMock).toHaveBeenCalled();
        expect(createCheckMock).toHaveBeenCalledTimes(1);
        expect(downloadJobLogsForWorkflowRunMock).toHaveBeenCalledTimes(1);
        expect(updateMock).toHaveBeenCalledTimes(1);
        expect(checkRunUrl).toBe('https://github.com/mdolinin/mono-repo-example/pull/27/checks?check_run_id=3');
    });

    it('should update check, when workflow run queued', async () => {
        const createCheckMock = jest.fn().mockImplementation(() => {
            return {
                data: {
                    id: 1,
                    status: 'queued',
                    details_url: ''
                },
                status: 201,
            }
        });
        const downloadJobLogsForWorkflowRunMock = jest.fn().mockImplementation(() => {
            return {
                data: 'logs',
                status: 200,
            }
        });
        const octokit = {
            checks: {
                create: createCheckMock
            },
            actions: {
                downloadJobLogsForWorkflowRun: downloadJobLogsForWorkflowRunMock
            }
        };
        // @ts-ignore
        await checks.updateWorkflowRunCheckQueued(octokit, workflowJobQueuedPayload, 1);
        expect(findMock).toHaveBeenCalledWith({
            pipeline_run_name: workflowJobQueuedPayload.workflow_job.name,
        });
        expect(findAllMock).toHaveBeenCalled();
        expect(downloadJobLogsForWorkflowRunMock).toHaveBeenCalledTimes(1);
        expect(createCheckMock).toHaveBeenCalledWith({
            details_url: 'https://github.com/mdolinin/mono-repo-example/actions/runs/7856385885',
            head_sha: 'b2a4cf69f2f60bc8d91cd23dcd80bf571736dee8',
            name: 'domain-a-example-b-build',
            status: 'queued',
            owner: workflowJobQueuedPayload.repository.owner.login,
            repo: workflowJobQueuedPayload.repository.name,
            started_at: expect.anything(),
            output: expect.anything(),
        });
        expect(updateMock).toHaveBeenCalledWith({
            pipeline_run_name: workflowJobQueuedPayload.workflow_job.name,
            workflow_job_id: null
        }, {
            check_run_id: 1,
            status: "queued",
            workflow_job_id: 21439086539,
            workflow_run_id: 1,
            workflow_run_url: ''
        });
    });

    it('should update check, when workflow run in progress', async () => {
        const updateCheckMock = jest.fn().mockImplementation(() => {
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
            workflow_job_id: workflowJobInProgressPayload.workflow_job.id,
            conclusion: null
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
            workflow_job_id: workflowJobInProgressPayload.workflow_job.id,
            check_run_id: 2,
        }, {
            status: "in_progress"
        });
    });

    it('should update check, when workflow run completed', async () => {
        const updateCheckMock = jest.fn().mockImplementation(() => {
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
        const downloadJobLogsForWorkflowRunMock = jest.fn().mockImplementation(() => {
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
            workflow_job_id: workflowJobCompletedPayload.workflow_job.id,
            conclusion: null
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
            workflow_job_id: workflowJobCompletedPayload.workflow_job.id,
            check_run_id: 2,
        }, {
            status: "completed",
            conclusion: "success"
        });
    });

    it('should update pr-status check, when workflow run in progress', async () => {
        const updateCheckMock = jest.fn().mockImplementation(() => {
            return {
                data: {
                    id: 2,
                    status: 'in_progress',
                    details_url: ''
                },
                status: 200,
            }
        });
        const downloadJobLogsForWorkflowRunMock = jest.fn().mockImplementation(() => {
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
            workflow_job_id: workflowJobInProgressPayload.workflow_job.id,
            conclusion: null
        });
        expect(findMock).toHaveBeenCalledWith({
            pr_number: 1,
            hook: 'onPullRequest',
            pr_check_id: 3,
            pr_conclusion: null
        });
        expect(findAllMock).toHaveBeenCalled();
        expect(updateCheckMock).toHaveBeenCalledWith({
            check_run_id: 3,
            output: expect.anything(),
            owner: workflowJobInProgressPayload.repository.owner.login,
            repo: workflowJobInProgressPayload.repository.name,
            status: "in_progress",
        });
        expect(updateMock).not.toHaveBeenCalled();
    });

    it('should update pr-status check, when workflow run completed', async () => {
        const updateCheckMock = jest.fn().mockImplementation(() => {
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
        const downloadJobLogsForWorkflowRunMock = jest.fn().mockImplementation(() => {
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
            workflow_job_id: workflowJobCompletedPayload.workflow_job.id,
            pr_conclusion: null
        });
        expect(findMock).toHaveBeenCalledWith({
            pr_check_id: 3,
            pr_number: 1,
            pr_conclusion: null
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
        findAllMock = jest.fn().mockImplementation(() => {
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
        const updateCheckMock = jest.fn().mockImplementation(() => {
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
        const downloadJobLogsForWorkflowRunMock = jest.fn().mockImplementation(() => {
            return {
                data: 'logs',
                status: 200,
            }
        });
        const createCommentMock = jest.fn();
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
            workflow_job_id: workflowJobCompletedPayload.workflow_job.id,
            pr_conclusion: null
        });
        expect(findMock).toHaveBeenCalledWith({
            pr_check_id: 3,
            pr_number: 1,
            pr_conclusion: null
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
        const createCheckMock = jest.fn().mockImplementation(() => {
            return {
                data: {
                    id: 21439086478,
                    status: 'queued',
                    details_url: ''
                },
                status: 201,
            }
        });
        const reRunWorkflowMock = jest.fn().mockImplementation(() => {
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
        const createCheckMock = jest.fn().mockImplementation(() => {
            return {
                data: {
                    id: 21439086479,
                    status: 'queued',
                    details_url: ''
                },
                status: 201,
            }
        });
        const reRunWorkflowMock = jest.fn().mockImplementation(() => {
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
        const createCheckMock = jest.fn().mockImplementation(() => {
            return {
                data: {
                    id: 21439086478,
                    status: 'queued',
                    details_url: ''
                },
                status: 201,
            }
        });
        const reRunWorkflowMock = jest.fn().mockImplementation(() => {
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
        expect(findMock).toHaveBeenCalledWith({
            check_run_id: checkRunReRequestedPayload.check_run.id,
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
        });
        expect(updateMock).toHaveBeenCalledWith({
            pr_check_id: 4,
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

    it('create pr-close check when PR closed hook triggered', async () => {
        const merge_commit_sha = '1234567890';
        const createCheckMock = jest.fn().mockImplementation(() => {
            return {
                data: {
                    id: 1,
                },
                status: 201,
            }
        });
        const downloadJobLogsForWorkflowRunMock = jest.fn().mockImplementation(() => {
            return {
                data: 'logs',
                status: 200,
            }
        });
        const octokit = {
            checks: {
                create: createCheckMock
            },
            actions: {
                downloadJobLogsForWorkflowRun: downloadJobLogsForWorkflowRunMock
            }
        }
        // @ts-ignore
        const checkRunUrl = await checks.createPRCheckForTriggeredPipelines(octokit, pullRequestOpenedPayload.pull_request, 'onPullRequestClose', merge_commit_sha);
        expect(checkRunUrl).toBe('https://github.com/mdolinin/mono-repo-example/pull/27/checks?check_run_id=1');
        expect(findMock).toHaveBeenCalledWith({
            pr_number: pullRequestOpenedPayload.pull_request.number,
            pr_check_id: null,
            hook: 'onPullRequestClose'
        });
        expect(findAllMock).toHaveBeenCalled();
        expect(createCheckMock).toHaveBeenCalledTimes(1);
        expect(downloadJobLogsForWorkflowRunMock).toHaveBeenCalledTimes(1);
        expect(updateMock).toHaveBeenCalledTimes(1);
    });

    it('create pr-slash-command check when slash command hook triggered', async () => {
        const merge_commit_sha = '1234567890';
        const createCheckMock = jest.fn().mockImplementation(() => {
            return {
                data: {
                    id: 2,
                },
                status: 201,
            }
        });
        const downloadJobLogsForWorkflowRunMock = jest.fn().mockImplementation(() => {
            return {
                data: 'logs',
                status: 200,
            }
        });
        const octokit = {
            checks: {
                create: createCheckMock
            },
            actions: {
                downloadJobLogsForWorkflowRun: downloadJobLogsForWorkflowRunMock
            }
        }
        // @ts-ignore
        const checkRunUrl = await checks.createPRCheckForTriggeredPipelines(octokit, pullRequestOpenedPayload.pull_request, 'onSlashCommand', merge_commit_sha);
        expect(checkRunUrl).toBe('https://github.com/mdolinin/mono-repo-example/pull/27/checks?check_run_id=2');
        expect(findMock).toHaveBeenCalledWith({
            pr_number: pullRequestOpenedPayload.pull_request.number,
            pr_check_id: null,
            hook: 'onSlashCommand'
        });
        expect(findAllMock).toHaveBeenCalled();
        expect(createCheckMock).toHaveBeenCalledTimes(1);
        expect(downloadJobLogsForWorkflowRunMock).toHaveBeenCalledTimes(1);
        expect(updateMock).toHaveBeenCalledTimes(1);
    });
});