import {vi, describe, beforeEach, afterEach, expect, it} from "vitest";
import nock from "nock";
// Requiring our app implementation
import myProbotApp from "../src/index.js";
import {Probot, ProbotOctokit} from "probot";
// Requiring our fixtures
import pushGhaYamlChangedPayload from "./fixtures/push.gha_yaml_changed.json" with {type: "json"};
import deleteBranchPayload from "./fixtures/delete.branch.json" with {type: "json"};
import pullRequestLabeledPayload from "./fixtures/pull_request.labeled.json" with {type: "json"};
import pullRequestOpenedPayload from "./fixtures/pull_request.opened.json" with {type: "json"};
import pullRequestReopenedPayload from "./fixtures/pull_request.reopened.json" with {type: "json"};
import workflowJobQueuedPayload from "./fixtures/workflow_job.queued.json" with {type: "json"};
import workflowJobInProgressPayload from "./fixtures/workflow_job.in_progress.json" with {type: "json"};
import workflowJobCompletedPayload from "./fixtures/workflow_job.completed.json" with {type: "json"};
import checkRunRequestedActionPayload from "./fixtures/check_run.requested_action.json" with {type: "json"};
import checkRunReRequestedPayload from "./fixtures/check_run.rerequested.json" with {type: "json"};
import prStatuscheckRunReRequestedPayload from "./fixtures/pr_status.check_run.rerequested.json" with {type: "json"};
import checkSuiteRerequestedPayload from "./fixtures/check_suite.rerequested.json" with {type: "json"};
import slashCommandIssueCommentPayload from "./fixtures/slash_command.issue_comment.created.json" with {type: "json"};

import fs from "fs";
import path from "path";

const privateKey = fs.readFileSync(
    path.join(__dirname, "fixtures/mock-cert.pem"),
    "utf-8"
);
import {GhaHook, GhaLoader} from "../src/gha_loader.js";
import {Hooks} from "../src/hooks.js";
import {GhaChecks, PRCheckAction, PRCheckName} from "../src/gha_checks.js";

const loadAllGhaYamlMock = vi
    .spyOn(GhaLoader.prototype, 'loadAllGhaHooksFromRepo')
    .mockImplementation(() => {
        return Promise.resolve();
    });

let validateGhaYamlFilesMock = vi
    .spyOn(GhaLoader.prototype, 'validateGhaYamlFiles')
    .mockImplementation(() => {
        return Promise.resolve([]);
    });

const loadGhaHooksFromCommitsMock = vi
    .spyOn(GhaLoader.prototype, 'loadGhaHooksFromCommits')
    .mockImplementation(() => {
        return Promise.resolve();
    });

const deleteAllGhaHooksForBranchMock = vi
    .spyOn(GhaLoader.prototype, 'deleteAllGhaHooksForBranch')
    .mockImplementation(() => {
        return Promise.resolve();
    });

const loadAllGhaYamlForBranchIfNewMock = vi
    .spyOn(GhaLoader.prototype, 'loadAllGhaYamlForBranchIfNew')
    .mockImplementation(() => {
        return Promise.resolve();
    });

const loadGhaHooksMock = vi
    .spyOn(GhaLoader.prototype, 'loadGhaHooks')
    .mockImplementation(() => {
        return Promise.resolve({hooks: [], hookFilesModified: new Set([])});
    });

const filterTriggeredHooksMock = vi
    .spyOn(Hooks.prototype, 'filterTriggeredHooks')
    .mockImplementation(() => {
        return Promise.resolve(new Set<GhaHook>());
    });

let runWorkflowMock = vi
    .spyOn(Hooks.prototype, 'runWorkflow')
    .mockImplementation(() => {
        return Promise.resolve([]);
    });

const createWorkflowRunCheckErroredMock = vi
    .spyOn(GhaChecks.prototype, 'createWorkflowRunCheckErrored')
    .mockImplementation(() => {
        return Promise.resolve();
    });

const prCheckMock = {
    checkRunId: 1,
    checkName: "pr-status" as PRCheckName,
    checkRunUrl: "https://gh-check.com/",
    hookType: "onPullRequest" as "onBranchMerge" | "onPullRequest" | "onPullRequestClose" | "onSlashCommand",
};

let createPRCheckMock = vi
    .spyOn(GhaChecks.prototype, 'createPRCheck')
    .mockImplementation(() => {
        return Promise.resolve(prCheckMock);
    });

const updatePRCheckNoPipelinesTriggeredMock = vi
    .spyOn(GhaChecks.prototype, 'updatePRCheckNoPipelinesTriggered')
    .mockImplementation(() => {
        return Promise.resolve("");
    });

const updatePRCheckWithAnnotationsMock = vi
    .spyOn(GhaChecks.prototype, 'updatePRCheckWithAnnotations')
    .mockImplementation(() => {
        return Promise.resolve("");
    });

const updatePRCheckForAllErroredPipelinesMock = vi
    .spyOn(GhaChecks.prototype, 'updatePRCheckForAllErroredPipelines')
    .mockImplementation(() => {
        return Promise.resolve("");
    });

const updatePRCheckForTriggeredPipelinesMock = vi
    .spyOn(GhaChecks.prototype, 'updatePRCheckForTriggeredPipelines')
    .mockImplementation(() => {
        return Promise.resolve("");
    });

const updateWorkflowRunCheckQueuedMock = vi
    .spyOn(GhaChecks.prototype, 'updateWorkflowRunCheckQueued')
    .mockImplementation(() => {
        return Promise.resolve();
    });

const updateWorkflowRunCheckInProgressMock = vi
    .spyOn(GhaChecks.prototype, 'updateWorkflowRunCheckInProgress')
    .mockImplementation(() => {
        return Promise.resolve();
    });

const updatePRStatusCheckInProgressMock = vi
    .spyOn(GhaChecks.prototype, 'updatePRStatusCheckInProgress')
    .mockImplementation(() => {
        return Promise.resolve();
    });

const updateWorkflowRunCheckCompletedMock = vi
    .spyOn(GhaChecks.prototype, 'updateWorkflowRunCheckCompleted')
    .mockImplementation(() => {
        return Promise.resolve();
    });

const updatePRStatusCheckCompletedMock = vi
    .spyOn(GhaChecks.prototype, 'updatePRStatusCheckCompleted')
    .mockImplementation(() => {
        return Promise.resolve();
    });

const syncPRCheckStatusMock = vi
    .spyOn(GhaChecks.prototype, 'syncPRCheckStatus')
    .mockImplementation(() => {
        return Promise.resolve();
    });

const triggerReRunPRCheckMock = vi
    .spyOn(GhaChecks.prototype, 'triggerReRunPRCheck')
    .mockImplementation(() => {
        return Promise.resolve();
    });

const triggerReRunWorkflowRunCheckMock = vi
    .spyOn(GhaChecks.prototype, 'triggerReRunWorkflowRunCheck')
    .mockImplementation(() => {
        return Promise.resolve();
    });

const findPRStatusCheckIdForCommitMock = vi
    .spyOn(GhaChecks.prototype, 'findPRStatusCheckIdForCommit')
    .mockImplementation(() => {
        return Promise.resolve(1);
    });

const timeout = 10000; // greater than 5000ms

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
        vi.clearAllMocks();
    });

    it("delete all related gha hooks, when branch is deleted", async () => {
        await probot.receive({name: "push", payload: deleteBranchPayload});
        expect(deleteAllGhaHooksForBranchMock).toHaveBeenCalledTimes(1);
    });

    it("when pushed changes with gha-conductor-config.yaml and branch is base, reload config from file", async () => {
        const mock = nock("https://api.github.com")
            .post("/app/installations/44167724/access_tokens")
            .reply(200, {
                token: "test",
                permissions: {
                    pull_requests: "write",
                },
            })
            .get("/repos/mdolinin/mono-repo-example/contents/.github%2Fgha-conductor-config.yaml")
            .reply(200, "gha_hooks_file: .gha-hooks.yaml");
        const configChangePayload = JSON.parse(JSON.stringify(pushGhaYamlChangedPayload));
        configChangePayload.commits[0].modified = [".github/gha-conductor-config.yaml"];
        await probot.receive({name: "push", payload: configChangePayload});
        expect(loadAllGhaYamlMock).toHaveBeenCalledTimes(0);
        expect(mock.pendingMocks()).toStrictEqual([]);
    });

    it("when pushed changes with .gha.yaml and branch is base for at least one PR, load it into db", async () => {
        const mock = nock("https://api.github.com")
            .post("/app/installations/44167724/access_tokens")
            .reply(200, {
                token: "test",
                permissions: {
                    pull_requests: "write",
                },
            })
            .get("/repos/mdolinin/mono-repo-example/contents/.github%2Fgha-conductor-config.yaml")
            .reply(200, "gha_hooks_file: .gha.yaml")
            .get("/repos/mdolinin/mono-repo-example/pulls?state=open&base=feature-1")
            .reply(200, [
                {
                    base: {
                        ref: "main",
                    },
                },
            ])
        const ghaYamlChangedAndHavePROpenedPayload = {
            ...pushGhaYamlChangedPayload,
            ref: "refs/heads/feature-1",
        }
        await probot.receive({name: "push", payload: ghaYamlChangedAndHavePROpenedPayload});
        expect(loadGhaHooksFromCommitsMock).toHaveBeenCalledTimes(1);
        expect(mock.pendingMocks()).toStrictEqual([]);
    });

    it("load all gha yaml files into db when PR labeled with gha-conductor:load", async () => {
        const mock = nock("https://api.github.com")
            .post("/app/installations/44167724/access_tokens")
            .reply(200, {
                token: "test",
                permissions: {
                    pull_requests: "write",
                },
            })
            .get("/repos/mdolinin/mono-repo-example/contents/.github%2Fgha-conductor-config.yaml")
            .reply(200, "gha_hooks_file: .gha-hooks.yaml");
        await probot.receive({name: "pull_request", payload: pullRequestLabeledPayload});
        expect(loadAllGhaYamlMock).toHaveBeenCalledWith(expect.anything(), "mdolinin/mono-repo-example", "main", ".gha-hooks.yaml");
        expect(mock.pendingMocks()).toStrictEqual([]);
    });

    it("when PR opened but is not mergeable, do nothing", async () => {
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
        expect(validateGhaYamlFilesMock).toHaveBeenCalledTimes(0);
        expect(loadGhaHooksMock).toHaveBeenCalledTimes(0);
        expect(filterTriggeredHooksMock).toHaveBeenCalledTimes(0);
        expect(mock.pendingMocks()).toStrictEqual([]);
    });

    it("when PR opened but is not mergeable after checking mergeability, do nothing", async () => {
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
        expect(validateGhaYamlFilesMock).toHaveBeenCalledTimes(0);
        expect(loadGhaHooksMock).toHaveBeenCalledTimes(0);
        expect(filterTriggeredHooksMock).toHaveBeenCalledTimes(0);
        expect(mock.pendingMocks()).toStrictEqual([]);
    }, timeout);

    it("when PR is from forked repo then skip all hooks, and add comment", async () => {
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
        expect(validateGhaYamlFilesMock).toHaveBeenCalledTimes(0);
        expect(loadGhaHooksMock).toHaveBeenCalledTimes(0);
        expect(filterTriggeredHooksMock).toHaveBeenCalledTimes(0);
        expect(mock.pendingMocks()).toStrictEqual([]);
    });

    it("when PR opened, but fail to create pr-status check do nothing", async () => {
        createPRCheckMock = createPRCheckMock.mockImplementation(() => {
            return Promise.resolve({
                checkRunId: 0,
                checkName: "pr-status" as PRCheckName,
                checkRunUrl: "",
                hookType: "onPullRequest"
            });
        });
        const mergeCommitSha = "b2a4cf69f2f60bc8d91cd23dcd80bf571736dee8";
        const mock = nock("https://api.github.com")
            .post("/app/installations/44167724/access_tokens")
            .reply(200, {
                token: "test",
                permissions: {
                    pull_requests: "write",
                },
            })
            .get("/repos/mdolinin/mono-repo-example/contents/.github%2Fgha-conductor-config.yaml")
            .reply(200, "gha_hooks_file: .gha.yaml")
            .get("/repos/mdolinin/mono-repo-example/pulls/27")
            .reply(200, {
                mergeable: true,
                merge_commit_sha: mergeCommitSha,
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
        // restore mock implementation
        createPRCheckMock = createPRCheckMock.mockImplementation(() => {
            return Promise.resolve(prCheckMock);
        });
        expect(loadAllGhaYamlForBranchIfNewMock).toHaveBeenCalledTimes(1);
        expect(createPRCheckMock).toHaveBeenCalledWith(expect.anything(), pullRequestOpenedPayload.pull_request, "onPullRequest", mergeCommitSha);
        expect(validateGhaYamlFilesMock).toHaveBeenCalledTimes(0);
        expect(updatePRCheckWithAnnotationsMock).toHaveBeenCalledTimes(0);
        expect(loadGhaHooksMock).toHaveBeenCalledTimes(0);
        expect(filterTriggeredHooksMock).toHaveBeenCalledTimes(0);
        expect(runWorkflowMock).toHaveBeenCalledTimes(0);
        expect(createWorkflowRunCheckErroredMock).toHaveBeenCalledTimes(0);
        expect(updatePRCheckNoPipelinesTriggeredMock).toHaveBeenCalledTimes(0);
        expect(updatePRCheckForAllErroredPipelinesMock).toHaveBeenCalledTimes(0);
        expect(updatePRCheckForTriggeredPipelinesMock).toHaveBeenCalledTimes(0);
        expect(mock.pendingMocks()).toStrictEqual([]);
    }, timeout);

    it("when PR opened with not valid .gha.yaml files, create pr-status check with status failed and annotate failures in PR changes", async () => {
        const annotationsForCheck = [{
            annotation_level: "failure" as "failure" | "warning" | "notice",
            message: "Unknown error",
            path: ".gha.yaml",
            start_line: 1,
            end_line: 1,
            start_column: 1,
            end_column: 1
        }];
        validateGhaYamlFilesMock = validateGhaYamlFilesMock.mockImplementation(() => {
            return Promise.resolve(annotationsForCheck);
        });
        const mergeCommitSha = "b2a4cf69f2f60bc8d91cd23dcd80bf571736dee8";
        const mock = nock("https://api.github.com")
            .post("/app/installations/44167724/access_tokens")
            .reply(200, {
                token: "test",
                permissions: {
                    pull_requests: "write",
                },
            })
            .get("/repos/mdolinin/mono-repo-example/contents/.github%2Fgha-conductor-config.yaml")
            .reply(200, "gha_hooks_file: .gha.yaml")
            .get("/repos/mdolinin/mono-repo-example/pulls/27")
            .reply(200, {
                mergeable: true,
                merge_commit_sha: mergeCommitSha,
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
        // restore mock implementation
        validateGhaYamlFilesMock = validateGhaYamlFilesMock.mockImplementation(() => {
            return Promise.resolve([]);
        });
        expect(loadAllGhaYamlForBranchIfNewMock).toHaveBeenCalledTimes(1);
        expect(createPRCheckMock).toHaveBeenCalledWith(expect.anything(), pullRequestOpenedPayload.pull_request, "onPullRequest", mergeCommitSha);
        expect(validateGhaYamlFilesMock).toHaveBeenCalledTimes(1);
        expect(updatePRCheckWithAnnotationsMock).toHaveBeenCalledWith(expect.anything(), pullRequestOpenedPayload.pull_request, prCheckMock, annotationsForCheck);
        expect(loadGhaHooksMock).toHaveBeenCalledTimes(0);
        expect(filterTriggeredHooksMock).toHaveBeenCalledTimes(0);
        expect(runWorkflowMock).toHaveBeenCalledTimes(0);
        expect(createWorkflowRunCheckErroredMock).toHaveBeenCalledTimes(0);
        expect(updatePRCheckNoPipelinesTriggeredMock).toHaveBeenCalledTimes(0);
        expect(updatePRCheckForAllErroredPipelinesMock).toHaveBeenCalledTimes(0);
        expect(updatePRCheckForTriggeredPipelinesMock).toHaveBeenCalledTimes(0);
        expect(mock.pendingMocks()).toStrictEqual([]);
    }, timeout);

    it("when PR opened with files that match hook and pipeline ref is not exist, create pr-status check with status failed", async () => {
        runWorkflowMock = runWorkflowMock.mockImplementation(() => {
            return Promise.resolve([{name: "test", inputs: {}, error: "ref not found"}]);
        });
        const mock = nock("https://api.github.com")
            .post("/app/installations/44167724/access_tokens")
            .reply(200, {
                token: "test",
                permissions: {
                    pull_requests: "write",
                },
            })
            .get("/repos/mdolinin/mono-repo-example/contents/.github%2Fgha-conductor-config.yaml")
            .reply(200, "gha_hooks_file: .gha.yaml")
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
        // restore mock implementation
        runWorkflowMock = runWorkflowMock.mockImplementation(() => {
            return Promise.resolve([]);
        });
        expect(loadAllGhaYamlForBranchIfNewMock).toHaveBeenCalledTimes(1);
        expect(createPRCheckMock).toHaveBeenCalledTimes(1);
        expect(validateGhaYamlFilesMock).toHaveBeenCalledTimes(1);
        expect(loadGhaHooksMock).toHaveBeenCalledTimes(1);
        expect(filterTriggeredHooksMock).toHaveBeenCalledTimes(1);
        expect(runWorkflowMock).toHaveBeenCalledTimes(1);
        expect(createWorkflowRunCheckErroredMock).toHaveBeenCalledTimes(1);
        expect(updatePRCheckNoPipelinesTriggeredMock).toHaveBeenCalledTimes(0);
        expect(updatePRCheckForAllErroredPipelinesMock).toHaveBeenCalledTimes(1);
        expect(updatePRCheckForTriggeredPipelinesMock).toHaveBeenCalledTimes(0);
        expect(mock.pendingMocks()).toStrictEqual([]);
    }, timeout);

    it("when PR opened with files that not match any hook, create pr-status check with status completed", async () => {
        const mock = nock("https://api.github.com")
            .post("/app/installations/44167724/access_tokens")
            .reply(200, {
                token: "test",
                permissions: {
                    pull_requests: "write",
                },
            })
            .get("/repos/mdolinin/mono-repo-example/contents/.github%2Fgha-conductor-config.yaml")
            .reply(200, "gha_hooks_file: .gha.yaml")
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
        expect(createPRCheckMock).toHaveBeenCalledTimes(1)
        expect(validateGhaYamlFilesMock).toHaveBeenCalledTimes(1);
        expect(loadGhaHooksMock).toHaveBeenCalledTimes(1);
        expect(filterTriggeredHooksMock).toHaveBeenCalledTimes(1);
        expect(runWorkflowMock).toHaveBeenCalledTimes(1);
        expect(createWorkflowRunCheckErroredMock).toHaveBeenCalledTimes(0);
        expect(updatePRCheckNoPipelinesTriggeredMock).toHaveBeenCalledTimes(1);
        expect(updatePRCheckForAllErroredPipelinesMock).toHaveBeenCalledTimes(0);
        expect(updatePRCheckForTriggeredPipelinesMock).toHaveBeenCalledTimes(0);
        expect(mock.pendingMocks()).toStrictEqual([]);
    }, timeout);

    it("when PR opened with files that match hook, create pr-status check with status queued", async () => {
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
            .get("/repos/mdolinin/mono-repo-example/contents/.github%2Fgha-conductor-config.yaml")
            .reply(200, "gha_hooks_file: .gha.yaml")
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
        expect(createPRCheckMock).toHaveBeenCalledTimes(1)
        expect(validateGhaYamlFilesMock).toHaveBeenCalledTimes(1);
        expect(loadGhaHooksMock).toHaveBeenCalledTimes(1);
        expect(filterTriggeredHooksMock).toHaveBeenCalledTimes(1);
        expect(runWorkflowMock).toHaveBeenCalledTimes(1);
        expect(createWorkflowRunCheckErroredMock).toHaveBeenCalledTimes(0);
        expect(updatePRCheckNoPipelinesTriggeredMock).toHaveBeenCalledTimes(0);
        expect(updatePRCheckForAllErroredPipelinesMock).toHaveBeenCalledTimes(0);
        expect(updatePRCheckForTriggeredPipelinesMock).toHaveBeenCalledTimes(1);
        expect(mock.pendingMocks()).toStrictEqual([]);
    }, timeout);

    it("when PR reopened, find corresponding pr-status check and trigger re-run", async () => {
        const mock = nock("https://api.github.com")
            .post("/app/installations/44167724/access_tokens")
            .reply(200, {
                token: "test",
                permissions: {
                    pull_requests: "write",
                },
            })
            .get("/repos/mdolinin/mono-repo-example/pulls/35")
            .reply(200, {
                mergeable: true,
                merge_commit_sha: "b2a4cf69f2f60bc8d91cd23dcd80bf571736dee8",
                base: {
                    ref: "main",
                },
            });
        await probot.receive({name: "pull_request", payload: pullRequestReopenedPayload});
        expect(findPRStatusCheckIdForCommitMock).toHaveBeenCalledTimes(1);
        expect(triggerReRunPRCheckMock).toHaveBeenCalledWith(expect.anything(), {
            check_run_id: 1,
            owner: "mdolinin",
            repo: "mono-repo-example",
            requested_action_identifier: PRCheckAction.ReRun,
        });
        expect(mock.pendingMocks()).toStrictEqual([]);
    }, timeout);

    it("when workflow job event received, update pr-status checks and workflow run checks", async () => {
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

    it("when user click sync-status button on managed check, trigger sync PR check status", async () => {
        const syncStatusActionPayload = {
            ...checkRunRequestedActionPayload,
            requested_action: {
                identifier: "sync-status",
            }
        }
        await probot.receive({name: "check_run", payload: syncStatusActionPayload});
        expect(syncPRCheckStatusMock).toHaveBeenCalledTimes(1);
    });

    it("when user click re-run button on managed check, trigger workflow again", async () => {
        await probot.receive({name: "check_run", payload: checkRunRequestedActionPayload});
        expect(triggerReRunPRCheckMock).toHaveBeenCalledTimes(1);
    });

    it("when user click re-run link on failed check, trigger workflow again", async () => {
        await probot.receive({name: "check_run", payload: checkRunReRequestedPayload});
        expect(triggerReRunWorkflowRunCheckMock).toHaveBeenCalledTimes(1);
    });

    it("when user click re-run link on failed pr-status, trigger all pr workflows again", async () => {
        await probot.receive({name: "check_run", payload: prStatuscheckRunReRequestedPayload});
        expect(triggerReRunPRCheckMock).toHaveBeenCalledTimes(1);
    });

    it("when user click re-run checks button on PR, trigger workflows again", async () => {
        const mock = nock("https://api.github.com")
            .post("/app/installations/44167724/access_tokens")
            .reply(200, {
                token: "test",
                permissions: {
                    checks: "write",
                },
            })
            .get("/repos/mdolinin/mono-repo-example/check-suites/20638784158/check-runs")
            .reply(200,
                [
                    {
                        id: 7856385885,
                        name: "pr-status",
                    }
                ]
            );

        await probot.receive({name: "check_suite", payload: checkSuiteRerequestedPayload});
        expect(triggerReRunPRCheckMock).toHaveBeenCalledTimes(1);
        expect(mock.pendingMocks()).toStrictEqual([]);
    });

    it("when comment with slash command received, trigger workflow", async () => {
        runWorkflowMock = runWorkflowMock.mockImplementation(() => {
            return Promise.resolve([{name: "test", inputs: {}}]);
        });
        const mock = nock("https://api.github.com")
            .post("/app/installations/44167724/access_tokens")
            .reply(200, {
                token: "test",
                permissions: {
                    issue_comments: "write",
                },
            })
            .get("/repos/mdolinin/mono-repo-example/contents/.github%2Fgha-conductor-config.yaml")
            .reply(200, "gha_hooks_file: .gha.yaml")
            .get("/repos/mdolinin/mono-repo-example/collaborators/mdolinin/permission")
            .reply(200, {
                permission: "write",
            })
            .get("/repos/mdolinin/mono-repo-example/pulls/10")
            .reply(200, {
                mergeable: true,
                merge_commit_sha: "b2a4cf69f2f60bc8d91cd23dcd80bf571736dee8",
                base: {
                    ref: "main",
                    repo: {
                        branch: "main",
                    }
                },
                head: {
                    repo: {
                        fork: false,
                    }
                },
                changed_files: 1
            })
            .post("/repos/mdolinin/mono-repo-example/issues/comments/2080272675/reactions", {content: 'eyes'})
            .reply(200)
            .get("/repos/mdolinin/mono-repo-example/pulls/10/files")
            .reply(200, [
                {
                    filename: "test.sh",
                },
            ])
            .get("/repos/mdolinin/mono-repo-example/issues/comments/2080272675/reactions")
            .reply(200, [
                {
                    id: 1,
                    content: "eyes",
                }
            ])
            .delete("/repos/mdolinin/mono-repo-example/issues/comments/2080272675/reactions/1")
            .reply(200)
            .post("/repos/mdolinin/mono-repo-example/issues/comments/2080272675/reactions", {content: 'rocket'})
            .reply(200)
            .post("/repos/mdolinin/mono-repo-example/issues/10/comments", (body: any) => {
                expect(body).toMatchObject({body: "🏁Pipelines triggered. [Check]()"});
                return true;
            })
            .reply(200);

        await probot.receive({name: "issue_comment", payload: slashCommandIssueCommentPayload});
        expect(validateGhaYamlFilesMock).toHaveBeenCalledTimes(0);
        expect(createPRCheckMock).toHaveBeenCalledTimes(1);
        expect(loadGhaHooksMock).toHaveBeenCalledTimes(1);
        expect(filterTriggeredHooksMock).toHaveBeenCalledTimes(1);
        expect(runWorkflowMock).toHaveBeenCalledTimes(1);
        expect(createWorkflowRunCheckErroredMock).toHaveBeenCalledTimes(0);
        expect(updatePRCheckNoPipelinesTriggeredMock).toHaveBeenCalledTimes(0);
        expect(updatePRCheckForAllErroredPipelinesMock).toHaveBeenCalledTimes(0);
        expect(updatePRCheckForTriggeredPipelinesMock).toHaveBeenCalledTimes(1);
        expect(mock.pendingMocks()).toStrictEqual([]);
    }, timeout);

    it("when PR edited but base branch is not changed, do nothing", async () => {
        const mock = nock("https://api.github.com")
        const prTitleEditedPayload = {
            ...pullRequestOpenedPayload,
            action: "edited",
            changes: {
                title: {
                    from: "test",
                }
            }
        }
        await probot.receive({name: "pull_request", payload: prTitleEditedPayload});
        expect(loadAllGhaYamlForBranchIfNewMock).toHaveBeenCalledTimes(0);
        expect(validateGhaYamlFilesMock).toHaveBeenCalledTimes(0);
        expect(loadGhaHooksMock).toHaveBeenCalledTimes(0);
        expect(filterTriggeredHooksMock).toHaveBeenCalledTimes(0);
        expect(mock.pendingMocks()).toStrictEqual([]);
    });

    it("when PR edited but base branch is changed, load all hooks from new branch and continue", async () => {
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
            .get("/repos/mdolinin/mono-repo-example/contents/.github%2Fgha-conductor-config.yaml")
            .reply(200, "gha_hooks_file: .gha.yaml")
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
        const prBaseBranchEditedPayload = {
            ...pullRequestOpenedPayload,
            action: "edited",
            changes: {
                base: {
                    ref: {
                        from: "main",
                    }
                }
            },
        }
        await probot.receive({name: "pull_request", payload: prBaseBranchEditedPayload});
        // restore mock implementation
        runWorkflowMock = runWorkflowMock.mockImplementation(() => {
            return Promise.resolve([]);
        });
        expect(loadAllGhaYamlForBranchIfNewMock).toHaveBeenCalledTimes(1);
        expect(validateGhaYamlFilesMock).toHaveBeenCalledTimes(1);
        expect(createPRCheckMock).toHaveBeenCalledTimes(1);
        expect(loadGhaHooksMock).toHaveBeenCalledTimes(1);
        expect(filterTriggeredHooksMock).toHaveBeenCalledTimes(1);
        expect(runWorkflowMock).toHaveBeenCalledTimes(1);
        expect(createWorkflowRunCheckErroredMock).toHaveBeenCalledTimes(0);
        expect(updatePRCheckNoPipelinesTriggeredMock).toHaveBeenCalledTimes(0);
        expect(updatePRCheckForAllErroredPipelinesMock).toHaveBeenCalledTimes(0);
        expect(updatePRCheckForTriggeredPipelinesMock).toHaveBeenCalledTimes(1);
        expect(mock.pendingMocks()).toStrictEqual([]);
    });

    afterEach(() => {
        nock.cleanAll();
        nock.enableNetConnect();
    });
});
