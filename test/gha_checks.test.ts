import {GhaChecks, PRCheckAction, ReRunPayload} from "../src/gha_checks";
import pullRequestOpenedPayload from "./fixtures/pull_request.opened.json";
import workflowJobQueuedPayload from "./fixtures/workflow_job.queued.json";
import workflowJobInProgressPayload from "./fixtures/workflow_job.in_progress.json";
import workflowJobCompletedPayload from "./fixtures/workflow_job.completed.json";
import checkRunRequestedActionPayload from "./fixtures/check_run.requested_action.json";
import checkRunReRequestedPayload from "./fixtures/check_run.rerequested.json";
import {PullRequest} from "@octokit/webhooks-types";
import {HookType} from "../src/__generated__/_enums";

const insertMock = jest.fn();
const findAllMock = jest.fn().mockImplementation(() => {
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

describe('gha_checks', () => {
    const checks = new GhaChecks();

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('store new run into db', async () => {
        const pipeline = {name: 'gha-checks-1234567890', inputs: {}};
        const pullRequestOpened: PullRequest & {
            state: "open";
            closed_at: null;
            merged_at: null;
            merged: boolean;
            merged_by: null;
        } = {
            ...pullRequestOpenedPayload.pull_request,
            author_association: "OWNER",
            state: "open",
            user: {
                ...pullRequestOpenedPayload.pull_request.user,
                type: "User",
            },
            base: {
                ...pullRequestOpenedPayload.pull_request.base,
                user: {
                    ...pullRequestOpenedPayload.pull_request.base.user,
                    type: "User",
                },
                repo: {
                    ...pullRequestOpenedPayload.pull_request.base.repo,
                    custom_properties: {},
                    visibility: "private",
                    owner: {
                        ...pullRequestOpenedPayload.pull_request.base.repo.owner,
                        type: "User",
                    },
                }
            },
            head: {
                ...pullRequestOpenedPayload.pull_request.head,
                user: {
                    ...pullRequestOpenedPayload.pull_request.head.user,
                    type: "User",
                },
                repo: {
                    ...pullRequestOpenedPayload.pull_request.head.repo,
                    custom_properties: {},
                    visibility: "private",
                    owner: {
                        ...pullRequestOpenedPayload.pull_request.head.repo.owner,
                        type: "User",
                    },
                }
            }
        };
        const merge_commit_sha = '1234567890';
        await checks.createNewRun(pipeline, pullRequestOpened, 'onPullRequest', merge_commit_sha);
        expect(insertMock).toHaveBeenCalledWith({
            name: 'gha-checks',
            head_sha: merge_commit_sha,
            merge_commit_sha: merge_commit_sha,
            pipeline_run_name: pipeline.name,
            workflow_run_inputs: {},
            pr_number: pullRequestOpened.number,
            hook: 'onPullRequest'
        });
    });

    it('should create pr-status check if hook has ref to non existed branch', async () => {
        const merge_commit_sha = '1234567890';
        let mock = jest.fn().mockImplementation(() => {
            return {
                data: {
                    id: 1,
                },
                status: 201,
            }
        });
        const octokit = {
            checks: {
                create: mock
            }
        }
        const hooksWithNotExistingRefs = [
            {
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
            }
        ];
        // @ts-ignore
        await checks.createPRCheckWithNonExistingRefs(octokit, pullRequestOpenedPayload.pull_request, 'onPullRequest', merge_commit_sha, hooksWithNotExistingRefs);
        expect(mock).toHaveBeenCalledWith({
            completed_at: expect.anything(),
            conclusion: "failure",
            head_sha: pullRequestOpenedPayload.pull_request.head.sha,
            name: "pr-status",
            output: {
                summary: "❌Hooks with non-existing refs:\nnamespace1-module1-hook1 -> ref: feature/1\n",
                title: "There are hooks with non-existing refs. No workflows will be triggered"
            },
            owner: "mdolinin",
            repo: "mono-repo-example",
            status: "completed",
        });
    });

    it('create pr-status check if no pipelines triggered', async () => {
        const merge_commit_sha = '1234567890';
        let mock = jest.fn().mockImplementation(() => {
            return {
                data: {
                    id: 1,
                },
                status: 201,
            }
        });
        const octokit = {
            checks: {
                create: mock
            }
        }
        // @ts-ignore
        await checks.createPRCheckNoPipelinesTriggered(octokit, pullRequestOpenedPayload.pull_request, 'onBranchMerge', merge_commit_sha);
        expect(mock).toHaveBeenCalled();
    });

    it('create pr-status check for triggered pipelines', async () => {
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
        await checks.createPRCheckForTriggeredPipelines(octokit, pullRequestOpenedPayload.pull_request, 'onPullRequest', merge_commit_sha);
        expect(findMock).toHaveBeenCalledWith({
            pr_number: pullRequestOpenedPayload.pull_request.number,
            pr_check_id: null,
            hook: 'onPullRequest'
        });
        expect(findAllMock).toHaveBeenCalled();
        expect(createCheckMock).toHaveBeenCalledTimes(1);
        expect(downloadJobLogsForWorkflowRunMock).toHaveBeenCalledTimes(1);
        expect(updateMock).toHaveBeenCalledTimes(1);
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
        });
        expect(reRunWorkflowMock).toHaveBeenCalledWith({
            owner: checkRunRequestedActionPayload.repository.owner.login,
            repo: checkRunRequestedActionPayload.repository.name,
            run_id: 5,
        });
    });
});