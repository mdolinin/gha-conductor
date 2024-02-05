// You can import your modules
// import index from '../src/index'

import nock from "nock";
// Requiring our app implementation
import myProbotApp from "../src";
import { Probot, ProbotOctokit } from "probot";
// Requiring our fixtures
import payload from "./fixtures/issues.opened.json";
import pushGhaYamlChangedPayload from "./fixtures/push.gha_yaml_changed.json";
import deleteBranchPayload from "./fixtures/delete.branch.json";
import pullRequestLabeledPayload from "./fixtures/pull_request.labeled.json";
const issueCreatedBody = { body: "Thanks for opening this issue!" };
const fs = require("fs");
const path = require("path");

const privateKey = fs.readFileSync(
  path.join(__dirname, "fixtures/mock-cert.pem"),
  "utf-8"
);
import {GhaLoader} from "../src/gha_loader";
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

describe("gha-conductor app", () => {
  let probot: any;

  beforeEach(() => {
    nock.disableNetConnect();
    probot = new Probot({
      appId: 123,
      privateKey,
      // disable request throttling and retries for testing
      Octokit: ProbotOctokit.defaults({
        retry: { enabled: false },
        throttle: { enabled: false },
      }),
    });
    // Load our app into probot
    probot.load(myProbotApp);
    loadAllGhaYamlMock.mockReset();
  });

  test("creates a comment when an issue is opened", async () => {
    const mock = nock("https://api.github.com")
        // Test that we correctly return a test token
        .post("/app/installations/2/access_tokens")
        .reply(200, {
          token: "test",
          permissions: {
            issues: "write",
          },
        })

        // Test that a comment is posted
        .post("/repos/hiimbex/testing-things/issues/1/comments", (body: any) => {
          expect(body).toMatchObject(issueCreatedBody);
          return true;
        })
        .reply(200);

    // Receive a webhook event
    await probot.receive({ name: "issues", payload });

    expect(mock.pendingMocks()).toStrictEqual([]);
  });

  test("delete all related gha hooks, when branch is deleted", async () => {
    await probot.receive({ name: "push", payload: deleteBranchPayload });
    expect(deleteAllGhaHooksForBranchMock).toHaveBeenCalledTimes(1);
  });

  test("when pushed changes with .gha.yaml and branch is base for at least one PR, load it into db", async () => {
    const mock = nock("https://api.github.com")
        // Test that we correctly return a test token
        .post("/app/installations/44167724/access_tokens")
        .reply(200, {
          token: "test",
          permissions: {
            pull_requests: "write",
          },
        })

        // get list of all open PRs in the repo
        .get("/repos/mdolinin/mono-repo-example/pulls?state=open&base=main")
        .reply(200, [
          {
            base: {
              ref: "main",
            },
          },
        ])

    await probot.receive({ name: "push", payload: pushGhaYamlChangedPayload });
    expect(loadAllGhaYamlMock).toHaveBeenCalledTimes(1);
    expect(mock.pendingMocks()).toStrictEqual([]);
  });

  test("load all gha yaml files into db when PR labeled with gha-conductor:load", async () => {
    await probot.receive({ name: "pull_request", payload: pullRequestLabeledPayload });
    expect(loadAllGhaYamlMock).toHaveBeenCalledTimes(1);
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
