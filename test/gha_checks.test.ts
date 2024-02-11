import {GhaChecks} from "../src/gha_checks";
import pullRequestOpenedPayload from "./fixtures/pull_request.opened.json";
import {PullRequest} from "@octokit/webhooks-types";

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
            hook: 'onPullRequest'
        }
    ]
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
                update: updateMock,
            };
        })
    }
});

describe('gha_checks', () => {
    const checks = new GhaChecks();

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
        let createCheckMock = jest.fn().mockImplementation(() => {
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
});