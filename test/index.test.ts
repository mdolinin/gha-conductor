// You can import your modules
// import index from '../src/index'

import nock from "nock";
// Requiring our app implementation
import myProbotApp from "../src";
import {Probot, ProbotOctokit} from "probot";
// Requiring our fixtures
import pushGhaYamlChangedPayload from "./fixtures/push.gha_yaml_changed.json";
import deleteBranchPayload from "./fixtures/delete.branch.json";
import pullRequestLabeledPayload from "./fixtures/pull_request.labeled.json";
import pullRequestOpenedPayload from "./fixtures/pull_request.opened.json";
import workflowJobQueuedPayload from "./fixtures/workflow_job.queued.json";
import workflowJobInProgressPayload from "./fixtures/workflow_job.in_progress.json";
import workflowJobCompletedPayload from "./fixtures/workflow_job.completed.json";
import checkRunRequestedActionPayload from "./fixtures/check_run.requested_action.json";
import checkRunReRequestedPayload from "./fixtures/check_run.rerequested.json";
import prStatuscheckRunReRequestedPayload from "./fixtures/pr_status.check_run.rerequested.json";
import checkSuiteRerequestedPayload from "./fixtures/check_suite.rerequested.json";

import fs from "fs";
import path from "path";

const privateKey = fs.readFileSync(
    path.join(__dirname, "fixtures/mock-cert.pem"),
    "utf-8"
);
import {GhaLoader} from "../src/gha_loader";
import {Hooks} from "../src/hooks";
import {GhaChecks} from "../src/gha_checks";

const loadAllGhaYamlMock = jest
    .spyOn(GhaLoader.prototype, 'loadAllGhaYaml')
    .mockImplementation(() => {
        return Promise.resolve();
    });
const deleteAllGhaHooksForBranchMock = jest
    .spyOn(GhaLoader.prototype, 'deleteAllGhaHooksForBranch')
    .mockImplementation(() => {
        return Promise.resolve();
    });

const loadAllGhaYamlForBranchIfNewMock = jest
    .spyOn(GhaLoader.prototype, 'loadAllGhaYamlForBranchIfNew')
    .mockImplementation(() => {
        return Promise.resolve();
    });

const loadGhaHooksMock = jest
    .spyOn(GhaLoader.prototype, 'loadGhaHooks')
    .mockImplementation(() => {
        return Promise.resolve([])
    });

const filterTriggeredHooksMock = jest
    .spyOn(Hooks.prototype, 'filterTriggeredHooks')
    .mockImplementation(() => {
        return Promise.resolve(new Set<string>());
    });

let runWorkflowMock = jest
    .spyOn(Hooks.prototype, 'runWorkflow')
    .mockImplementation(() => {
        return Promise.resolve([]);
    });

const createNewRunMock = jest
    .spyOn(GhaChecks.prototype, 'createNewRun')
    .mockImplementation(() => {
        return Promise.resolve();
    });

const createPRCheckNoPipelinesTriggeredMock = jest
    .spyOn(GhaChecks.prototype, 'createPRCheckNoPipelinesTriggered')
    .mockImplementation(() => {
        return Promise.resolve();
    });

const createPRCheckForTriggeredPipelinesMock = jest
    .spyOn(GhaChecks.prototype, 'createPRCheckForTriggeredPipelines')
    .mockImplementation(() => {
        return Promise.resolve();
    });

const updateWorkflowRunCheckQueuedMock = jest
    .spyOn(GhaChecks.prototype, 'updateWorkflowRunCheckQueued')
    .mockImplementation(() => {
        return Promise.resolve();
    });

const updateWorkflowRunCheckInProgressMock = jest
    .spyOn(GhaChecks.prototype, 'updateWorkflowRunCheckInProgress')
    .mockImplementation(() => {
        return Promise.resolve();
    });

const updatePRStatusCheckInProgressMock = jest
    .spyOn(GhaChecks.prototype, 'updatePRStatusCheckInProgress')
    .mockImplementation(() => {
        return Promise.resolve();
    });

const updateWorkflowRunCheckCompletedMock = jest
    .spyOn(GhaChecks.prototype, 'updateWorkflowRunCheckCompleted')
    .mockImplementation(() => {
        return Promise.resolve();
    });

const updatePRStatusCheckCompletedMock = jest
    .spyOn(GhaChecks.prototype, 'updatePRStatusCheckCompleted')
    .mockImplementation(() => {
        return Promise.resolve();
    });

const triggerReRunPRCheckMock = jest
    .spyOn(GhaChecks.prototype, 'triggerReRunPRCheck')
    .mockImplementation(() => {
        return Promise.resolve();
    });

const triggerReRunWorkflowRunCheckMock = jest
    .spyOn(GhaChecks.prototype, 'triggerReRunWorkflowRunCheck')
    .mockImplementation(() => {
        return Promise.resolve();
    });

describe("gha-conductor app", () => {
    let probot: any;

    beforeEach(() => {
        nock.disableNetConnect();
        probot = new Probot({
            appId: 123,
            privateKey,
            // disable request throttling and retries for testing
            Octokit: ProbotOctokit.defaults({
                retry: {enabled: false},
                throttle: {enabled: false},
            }),
        });
        // Load our app into probot
        probot.load(myProbotApp);
        loadAllGhaYamlMock.mockReset();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    test("delete all related gha hooks, when branch is deleted", async () => {
        await probot.receive({name: "push", payload: deleteBranchPayload});
        expect(deleteAllGhaHooksForBranchMock).toHaveBeenCalledTimes(1);
    });

    test("when pushed changes with .gha.yaml and branch is base for at least one PR, load it into db", async () => {
        const mock = nock("https://api.github.com")
            .post("/app/installations/44167724/access_tokens")
            .reply(200, {
                token: "test",
                permissions: {
                    pull_requests: "write",
                },
            })
            .get("/repos/mdolinin/mono-repo-example/pulls?state=open&base=main")
            .reply(200, [
                {
                    base: {
                        ref: "main",
                    },
                },
            ])

        await probot.receive({name: "push", payload: pushGhaYamlChangedPayload});
        expect(loadAllGhaYamlMock).toHaveBeenCalledTimes(1);
        expect(mock.pendingMocks()).toStrictEqual([]);
    });

    test("load all gha yaml files into db when PR labeled with gha-conductor:load", async () => {
        await probot.receive({name: "pull_request", payload: pullRequestLabeledPayload});
        expect(loadAllGhaYamlMock).toHaveBeenCalledTimes(1);
    });

    test("when PR opened but is not mergeable, do nothing", async () => {
        const mock = nock("https://api.github.com")
        const unmergeablePullRequestOpenedPayload = {
            ...pullRequestOpenedPayload,
            pull_request: {
                ...pullRequestOpenedPayload.pull_request,
                mergeable: false,
            }
        }
        await probot.receive({name: "pull_request", payload: unmergeablePullRequestOpenedPayload});
        expect(loadAllGhaYamlForBranchIfNewMock).toHaveBeenCalledTimes(0);
        expect(loadGhaHooksMock).toHaveBeenCalledTimes(0);
        expect(filterTriggeredHooksMock).toHaveBeenCalledTimes(0);
        expect(mock.pendingMocks()).toStrictEqual([]);
    });

    test("when PR opened but is not mergeable after checking mergeability, do nothing", async () => {
        const mock = nock("https://api.github.com")
            .post("/app/installations/44167724/access_tokens")
            .reply(200, {
                token: "test",
                permissions: {
                    pull_requests: "write",
                },
            })
            .get("/repos/mdolinin/mono-repo-example/pulls/27")
            .reply(200, {
                mergeable: false,
                merge_commit_sha: null,
                base: {
                    ref: "main",
                },
            });

        await probot.receive({name: "pull_request", payload: pullRequestOpenedPayload});
        expect(loadAllGhaYamlForBranchIfNewMock).toHaveBeenCalledTimes(0);
        expect(loadGhaHooksMock).toHaveBeenCalledTimes(0);
        expect(filterTriggeredHooksMock).toHaveBeenCalledTimes(0);
        expect(mock.pendingMocks()).toStrictEqual([]);
    });

    test("when PR is from forked repo then skip all hooks, and add comment", async () => {
        const forkedPullRequestOpenedPayload = {
            ...pullRequestOpenedPayload,
            pull_request: {
                ...pullRequestOpenedPayload.pull_request,
                mergeable: true,
                head: {
                    repo: {
                        fork: true,
                    }
                }
            }
        }
        const mock = nock("https://api.github.com")
            .post("/app/installations/44167724/access_tokens")
            .reply(200, {
                token: "test",
                permissions: {
                    pull_requests: "write",
                },
            })
            .post("/repos/mdolinin/mono-repo-example/issues/27/comments", (body: any) => {
                expect(body).toMatchObject({body: "PR is from forked repo. No hooks will be triggered."});
                return true;
            })
            .reply(200);

        await probot.receive({name: "pull_request", payload: forkedPullRequestOpenedPayload});
        expect(loadAllGhaYamlForBranchIfNewMock).toHaveBeenCalledTimes(0);
        expect(loadGhaHooksMock).toHaveBeenCalledTimes(0);
        expect(filterTriggeredHooksMock).toHaveBeenCalledTimes(0);
        expect(mock.pendingMocks()).toStrictEqual([]);
    });

    test("when PR opened with files that not match any hook, create pr-status check with status completed", async () => {
        const mock = nock("https://api.github.com")
            .post("/app/installations/44167724/access_tokens")
            .reply(200, {
                token: "test",
                permissions: {
                    pull_requests: "write",
                },
            })
            .get("/repos/mdolinin/mono-repo-example/pulls/27")
            .reply(200, {
                mergeable: true,
                merge_commit_sha: "b2a4cf69f2f60bc8d91cd23dcd80bf571736dee8",
                base: {
                    ref: "main",
                },
            })
            .get("/repos/mdolinin/mono-repo-example/pulls/27/files")
            .reply(200, [
                {
                    filename: "test.sh",
                },
            ]);

        await probot.receive({name: "pull_request", payload: pullRequestOpenedPayload});
        expect(loadAllGhaYamlForBranchIfNewMock).toHaveBeenCalledTimes(1);
        expect(loadGhaHooksMock).toHaveBeenCalledTimes(1);
        expect(filterTriggeredHooksMock).toHaveBeenCalledTimes(1);
        expect(runWorkflowMock).toHaveBeenCalledTimes(1);
        expect(createNewRunMock).toHaveBeenCalledTimes(0);
        expect(createPRCheckNoPipelinesTriggeredMock).toHaveBeenCalledTimes(1);
        expect(createPRCheckForTriggeredPipelinesMock).toHaveBeenCalledTimes(0);
        expect(mock.pendingMocks()).toStrictEqual([]);
    });

    test("when PR opened with files that match hook, create pr-status check with status queued", async () => {
        runWorkflowMock = runWorkflowMock.mockImplementation(() => {
            return Promise.resolve([{name: "test", inputs: {}}]);
        });
        const mock = nock("https://api.github.com")
            .post("/app/installations/44167724/access_tokens")
            .reply(200, {
                token: "test",
                permissions: {
                    pull_requests: "write",
                },
            })
            .get("/repos/mdolinin/mono-repo-example/pulls/27")
            .reply(200, {
                mergeable: true,
                merge_commit_sha: "b2a4cf69f2f60bc8d91cd23dcd80bf571736dee8",
                base: {
                    ref: "main",
                },
            })
            .get("/repos/mdolinin/mono-repo-example/pulls/27/files")
            .reply(200, [
                {
                    filename: "test.sh",
                },
            ]);

        await probot.receive({name: "pull_request", payload: pullRequestOpenedPayload});
        expect(loadAllGhaYamlForBranchIfNewMock).toHaveBeenCalledTimes(1);
        expect(loadGhaHooksMock).toHaveBeenCalledTimes(1);
        expect(filterTriggeredHooksMock).toHaveBeenCalledTimes(1);
        expect(runWorkflowMock).toHaveBeenCalledTimes(1);
        expect(createNewRunMock).toHaveBeenCalledTimes(1);
        expect(createPRCheckNoPipelinesTriggeredMock).toHaveBeenCalledTimes(0);
        expect(createPRCheckForTriggeredPipelinesMock).toHaveBeenCalledTimes(1);
        expect(mock.pendingMocks()).toStrictEqual([]);
    });

    test("when workflow job event received, update pr-status checks and workflow run checks", async () => {
        const mock = nock("https://api.github.com")
            .post("/app/installations/44167724/access_tokens")
            .reply(200, {
                token: "test",
                permissions: {
                    checks: "write",
                },
            })
            .get("/repos/mdolinin/mono-repo-example/actions/runs/7856385885")
            .reply(200, {
                id: 7856385885,
            })
            .get("/repos/mdolinin/mono-repo-example/actions/runs/7856385885")
            .reply(200, {
                id: 7856385885,
            })
            .get("/repos/mdolinin/mono-repo-example/actions/runs/7856385885")
            .reply(200, {
                id: 7856385885,
            })
        await probot.receive({name: "workflow_job", payload: workflowJobQueuedPayload});
        expect(updateWorkflowRunCheckQueuedMock).toHaveBeenCalledTimes(1);
        await probot.receive({name: "workflow_job", payload: workflowJobInProgressPayload});
        expect(updateWorkflowRunCheckInProgressMock).toHaveBeenCalledTimes(1);
        expect(updatePRStatusCheckInProgressMock).toHaveBeenCalledTimes(1);
        await probot.receive({name: "workflow_job", payload: workflowJobCompletedPayload});
        expect(updateWorkflowRunCheckCompletedMock).toHaveBeenCalledTimes(1);
        expect(updatePRStatusCheckCompletedMock).toHaveBeenCalledTimes(1);
        expect(mock.pendingMocks()).toStrictEqual([]);
    });

    test("when user click re-run button on managed check, trigger workflow again", async () => {
        await probot.receive({name: "check_run", payload: checkRunRequestedActionPayload});
        expect(triggerReRunPRCheckMock).toHaveBeenCalledTimes(1);
    });

    test(" when user click re-run link on failed check, trigger workflow again", async () => {
        await probot.receive({name: "check_run", payload: checkRunReRequestedPayload});
        expect(triggerReRunWorkflowRunCheckMock).toHaveBeenCalledTimes(1);
    });

    test(" when user click re-run link on failed pr-status, trigger all pr workflows again", async () => {
        await probot.receive({name: "check_run", payload: prStatuscheckRunReRequestedPayload});
        expect(triggerReRunPRCheckMock).toHaveBeenCalledTimes(1);
    });

    test("when user click re-run checks button on PR, trigger workflows again", async () => {
        const mock = nock("https://api.github.com")
            .post("/app/installations/44167724/access_tokens")
            .reply(200, {
                token: "test",
                permissions: {
                    checks: "write",
                },
            })
            .get("/repos/mdolinin/mono-repo-example/check-suites/20638784158/check-runs")
            .reply(200, {
                check_runs: [
                    {
                        id: 7856385885,
                        name: "pr-status",
                    }
                ]
            });

        await probot.receive({name: "check_suite", payload: checkSuiteRerequestedPayload});
        expect(triggerReRunPRCheckMock).toHaveBeenCalledTimes(1);
        expect(mock.pendingMocks()).toStrictEqual([]);
    });

    afterEach(() => {
        nock.cleanAll();
        nock.enableNetConnect();
    });
});

// For more information about testing with Jest see:
// https://facebook.github.io/jest/

// For more information about using TypeScript in your tests, Jest recommends:
// https://github.com/kulshekhar/ts-jest

// For more information about testing with Nock see:
// https://github.com/nock/nock