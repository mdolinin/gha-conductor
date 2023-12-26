import { Probot } from "probot";
import { GhaLoader } from "./gha_loader";
import {Hooks} from "./hooks";
import {GhaChecks, PRCheckAction, PRCheckName} from "./gha_checks";
import {
    CheckRunRequestedActionEvent, CheckRunRerequestedEvent,
    WorkflowJobCompletedEvent,
    WorkflowJobInProgressEvent,
    WorkflowJobQueuedEvent
} from "@octokit/webhooks-types";

export = (app: Probot) => {

  const ghaLoader = new GhaLoader();
  const hooks = new Hooks();
  const checks = new GhaChecks();

  app.on("issues.opened", async (context) => {
    const issueComment = context.issue({
      body: "Thanks for opening this issue!",
    });
    await context.octokit.issues.createComment(issueComment);
  });

  app.on("push", async (context) => {
    if (context.payload.ref === "refs/heads/master" || context.payload.ref === "refs/heads/main") {
      app.log.info("Reload gha yaml's in repo");
      await ghaLoader.loadAllGhaYaml(context.octokit, context.payload.repository.full_name, context.log);
      app.log.info("Reload gha yaml's in repo done");
    }
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
    const pr = context.payload.pull_request;
    app.log.info(`PR handler called for ${pr.number} and action ${context.payload.action}`);
    let mergeable = pr.mergeable;
    let merge_commit_sha = pr.merge_commit_sha;
    if (mergeable === null && !pr.merged) {
        app.log.info("PR mergeability is null");
        let i = 0;
        while (i < 5 && mergeable === null) {
            await new Promise(r => setTimeout(r, 5000));
            const resp = await context.octokit.pulls.get(
                {
                    owner: context.payload.repository.owner.login,
                    repo: context.payload.repository.name,
                    pull_number: context.payload.pull_request.number
                }
            );
            app.log.info("PR mergeability is " + resp.data.mergeable);
            i++;
            mergeable = resp.data.mergeable;
            merge_commit_sha = resp.data.merge_commit_sha;
        }
        if (mergeable === null || merge_commit_sha === null) {
            app.log.info(`PR mergeability is still not determined after ${i} attempts or merge_commit_sha is null`);
            return;
        }
    }
    if (!mergeable && !pr.merged) {
      app.log.info(`PR is not mergeable. All checks are skipped`);
      return;
    }
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
        if (merge_commit_sha === null) {
            merge_commit_sha = context.payload.pull_request.head.sha;
        }
        const triggeredPipelineNames = await hooks.runPipelines(context.octokit, context.payload.pull_request, context.payload.action, Array.from(triggeredHooks), hookType, merge_commit_sha);
        for (const pipelineName of triggeredPipelineNames) {
            app.log.info(`Triggered pipeline ${pipelineName}`);
            await checks.createNewRun(pipelineName, context.payload.pull_request, hookType, merge_commit_sha);
        }
        if (triggeredPipelineNames.length === 0) {
            await checks.createPRCheckNoPipelinesTriggered(context.octokit, context.payload.pull_request, hookType, merge_commit_sha);
        } else {
            await checks.createPRCheckForTriggeredPipelines(context.octokit, context.payload.pull_request, hookType, merge_commit_sha);
        }
    } else {
        app.log.info("No files changed in PR. No hooks will be triggered");
    }
  });

  app.on("workflow_job", async (context) => {
        app.log.info(`workflow_job event received for ${context.payload.workflow_job.name}`);
        const workflowJob = context.payload.workflow_job;
        if (workflowJob.run_id) {
            const workflowRun = await context.octokit.actions.getWorkflowRun({
                owner: context.payload.repository.owner.login,
                repo: context.payload.repository.name,
                run_id: workflowJob.run_id
            });
            if (workflowRun) {
                if (context.payload.action === "queued") {
                    const payload = context.payload as WorkflowJobQueuedEvent;
                    await checks.updateWorkflowRunCheckQueued(context.octokit, payload, workflowRun.data.id);
                } else if (context.payload.action === "in_progress") {
                    const payload = context.payload as WorkflowJobInProgressEvent;
                    await checks.updateWorkflowRunCheckInProgress(context.octokit, payload);
                    await checks.updatePRStatusCheckInProgress(context.octokit, payload);
                } else {
                    const payload = context.payload as WorkflowJobCompletedEvent;
                    await checks.updateWorkflowRunCheckCompleted(context.octokit, payload);
                    await checks.updatePRStatusCheckCompleted(context.octokit, payload);
                }
            } else {
                app.log.error("Failed to get workflow run for " + workflowJob.run_id);
            }
        }
    });

  app.on(["check_run.requested_action"], async (context) => {
    const identifier = context.payload.requested_action.identifier;
    app.log.info(`check_run.requested_action event received for ${context.payload.check_run.name} with identifier ${identifier}`);
    if (identifier === PRCheckAction.ReRun || identifier === PRCheckAction.ReRunFailed) {
        await checks.triggerReRunPRCheck(context.octokit, context.payload as CheckRunRequestedActionEvent);
    }
  });

  app.on(["check_run.rerequested"], async (context) => {
     const checkRun = context.payload.check_run;
     app.log.info(`check_run.rerequested event received for ${checkRun.name} with status ${checkRun.status}`);
     if (checkRun.name === PRCheckName.PRStatus || checkRun.name === PRCheckName.PRMerge || checkRun.name === PRCheckName.PRClose) {
         await checks.triggerReRunPRCheck(context.octokit, context.payload as CheckRunRerequestedEvent);
     } else {
         await checks.triggerReRunWorkflowRunCheck(context.octokit, context.payload as CheckRunRerequestedEvent);
     }
  });
  // For more information on building apps:
  // https://probot.github.io/docs/

  // To get your app running against GitHub, see:
  // https://probot.github.io/docs/development/
};
