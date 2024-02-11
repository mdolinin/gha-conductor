import {GhaChecks} from "../src/gha_checks";
import pullRequestOpenedPayload from "./fixtures/pull_request.opened.json";
import {PullRequest} from "@octokit/webhooks-types";

const insertMock = jest.fn();

jest.mock('../src/db/database', () => {
    return {
        gha_workflow_runs: jest.fn(() => {
            return {
                insert: insertMock,
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
});