import { Probot } from "probot";
import { GhaLoader } from "./gha_loader";
import {Hooks} from "./hooks";

export = (app: Probot) => {

  const ghaLoader = new GhaLoader();
  const hooks = new Hooks();

  app.on("issues.opened", async (context) => {
    const issueComment = context.issue({
      body: "Thanks for opening this issue!",
    });
    await context.octokit.issues.createComment(issueComment);
  });

  app.on("pull_request.labeled", async (context) => {
    app.log.info("context.payload is " + context.payload);
    app.log.info("Label is " + context.payload.label.name);
    if (context.payload.label.name === "gha-conductor:load") {
      app.log.info("Reload gha yaml's in repo");
      await ghaLoader.loadAllGhaYaml(context.octokit, context.payload.repository.full_name, context.log);
      app.log.info("Reload gha yaml's in repo done");
    }
  });

  app.on(["pull_request.opened", "pull_request.reopened", "pull_request.synchronize", "pull_request.closed"], async (context) => {
    app.log.info("PR handler called for " + context.payload.pull_request.number);
    const baseBranch = context.payload.pull_request.base.ref;
    app.log.info("PR base branch is " + baseBranch);
    const numOfChangedFiles = context.payload.pull_request.changed_files;
    if (numOfChangedFiles > 0) {
        const repo_name = context.payload.repository.name;
        const repo_full_name = context.payload.repository.full_name;
        const changedFilesResp = await context.octokit.pulls.listFiles({
            owner: context.payload.repository.owner.login,
            repo: repo_name,
            pull_number: context.payload.pull_request.number
        });
        const changedFiles = changedFilesResp.data.map((file) => file.filename);
        app.log.info("PR changed files are " + changedFiles);
        const eventType = context.payload.action;
        const hookType = Hooks.mapEventTypeToHook(eventType, context.payload.pull_request.merged);
        const triggeredHooks = await hooks.filterTriggeredHooks(repo_full_name, hookType, changedFiles, baseBranch);
        app.log.info(`Triggered hooks are ${JSON.stringify(triggeredHooks)}`);
        const triggeredPipelineNames = await hooks.runPipelines(context.octokit, context.payload.pull_request, context.payload.action, Array.from(triggeredHooks), hookType);
        app.log.info("Triggered pipelines are " + triggeredPipelineNames);
    }
  });
  // For more information on building apps:
  // https://probot.github.io/docs/

  // To get your app running against GitHub, see:
  // https://probot.github.io/docs/development/
};
