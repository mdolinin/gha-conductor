import {Probot} from "probot";
import {GhaLoader} from "./gha_loader";
import {GhaReply} from "./gha_reply";
import {Hooks} from "./hooks";
import {GhaChecks, PRCheckAction, PRCheckName} from "./gha_checks";
import {
    CheckRunRerequestedEvent,
    WorkflowJobCompletedEvent,
    WorkflowJobInProgressEvent,
    WorkflowJobQueuedEvent
} from "@octokit/webhooks-types";
import {
    RestEndpointMethodTypes
} from "@octokit/plugin-rest-endpoint-methods/dist-types/generated/parameters-and-response-types";
import {inspect} from "node:util";


const TOKENISE_REGEX =
    /\S+="[^"\\]*(?:\\.[^"\\]*)*"|"[^"\\]*(?:\\.[^"\\]*)*"|\S+/g

export = (app: Probot) => {

    const ghaLoader = new GhaLoader(app.log);
    const hooks = new Hooks(app.log);
    const checks = new GhaChecks(app.log);
    const reply = new GhaReply(app.log);

    app.on("push", async (context) => {
        // if push was delete branch
        if (context.payload.deleted) {
            const ref = context.payload.ref;
            const branchName = ref.split("/").pop();
            if (ref.startsWith("refs/heads/") && branchName) {
                const fullName = context.payload.repository.full_name;
                await ghaLoader.deleteAllGhaHooksForBranch(fullName, branchName);
                app.log.info(`Delete all gha hooks for branch ${branchName} in repo ${fullName} completed`);
            } else {
                app.log.info(`Delete was for ref ${ref} that is not a branch`);
            }
            return;
        }
        const changedFiles = context.payload.commits.flatMap((commit) => commit.added.concat(commit.modified));
        let changedGhaFiles = false;
        for (const file of changedFiles) {
            if (file.endsWith(".gha.yaml")) {
                changedGhaFiles = true;
                break;
            }
        }
        if (changedGhaFiles) {
            const ref = context.payload.ref;
            const branchName = ref.split("/").pop();
            if (ref.startsWith("refs/heads/") && branchName) {
                // check if branch is base branch for at least one open PR
                let params: RestEndpointMethodTypes["pulls"]["list"]["parameters"] = {
                    owner: context.payload.repository.owner.login,
                    repo: context.payload.repository.name,
                    state: "open",
                    base: branchName
                };
                const branchPRs = await context.octokit.pulls.list(params);
                if (branchPRs.data.length > 0) {
                    const fullName = context.payload.repository.full_name;
                    await ghaLoader.loadAllGhaYaml(context.octokit, fullName, branchName);
                    app.log.info(`Reload gha yaml's in repo ${fullName} for branch ${branchName} completed`);
                } else {
                    app.log.info(`No open PRs found for branch ${branchName}`);
                }
            } else {
                app.log.info(`Push is for ref ${ref} that is not a branch`);
            }
        } else {
            app.log.info("No .gha.yaml files changed in push");
        }
    });

    app.on("pull_request.labeled", async (context) => {
        app.log.info(`Pull request labeled event received for ${context.payload.pull_request.number} and label ${context.payload.label.name}`);
        if (context.payload.label.name === "gha-conductor:load") {
            app.log.info("Reload gha yaml's in repo");
            await ghaLoader.loadAllGhaYaml(context.octokit, context.payload.repository.full_name, context.payload.pull_request.base.ref);
            app.log.info("Reload gha yaml's in repo done");
        }
    });

    app.on(["pull_request.opened", "pull_request.reopened", "pull_request.synchronize", "pull_request.closed"], async (context) => {
        const pr = context.payload.pull_request;
        const pullNumber = context.payload.pull_request.number;
        const owner = context.payload.repository.owner.login;
        const repo = context.payload.repository.name;
        app.log.info(`PR handler called for ${pr.number} and action ${context.payload.action}`);
        let mergeable = pr.mergeable;
        let merge_commit_sha = pr.merge_commit_sha;
        if (mergeable === null && !pr.merged) {
            app.log.info("PR mergeability is null");
            let i = 0;
            while (i < 5 && mergeable === null) {
                await new Promise(r => setTimeout(r, 2000));
                const resp = await context.octokit.pulls.get(
                    {
                        owner: owner,
                        repo: repo,
                        pull_number: pullNumber
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
        // if PR is from forked repo then skip all hooks
        if (pr.head.repo && pr.head.repo.fork) {
            app.log.info("PR is from forked repo. No hooks will be triggered");
            // add comment to PR
            const comment = context.issue({
                body: "PR is from forked repo. No hooks will be triggered."
            });
            await context.octokit.issues.createComment(comment);
            return;
        }
        const numOfChangedFiles = context.payload.pull_request.changed_files;
        if (numOfChangedFiles > 0) {
            const repo_full_name = context.payload.repository.full_name;
            // if PR is just opened load all gha hooks for base branch
            if (context.payload.action === "opened") {
                app.log.info(`PR is just opened. Loading all gha hooks for base branch ${baseBranch}`);
                await ghaLoader.loadAllGhaYamlForBranchIfNew(context.octokit, repo_full_name, baseBranch);
                app.log.info(`PR is just opened. Loading all gha hooks for base branch ${baseBranch} done`);
            }
            const changedFilesResp = await context.octokit.pulls.listFiles({
                owner: owner,
                repo: repo,
                pull_number: pullNumber
            });
            const changedFiles = changedFilesResp.data.map((file) => file.filename);
            app.log.info(`PR changed files are ${JSON.stringify(changedFiles)}`);
            const hooksChangedInPR = await ghaLoader.loadGhaHooks(context.octokit, changedFilesResp.data);
            const eventType = context.payload.action;
            const hookType = Hooks.mapEventTypeToHook(eventType, context.payload.pull_request.merged);
            const triggeredHooks = await hooks.filterTriggeredHooks(repo_full_name, hookType, changedFiles, baseBranch, hooksChangedInPR);
            if (merge_commit_sha === null) {
                merge_commit_sha = context.payload.pull_request.head.sha;
            }
            const triggeredWorkflows = await hooks.runWorkflow(context.octokit, context.payload.pull_request, context.payload.action, triggeredHooks, merge_commit_sha);
            for (const triggeredWorkflow of triggeredWorkflows) {
                await checks.createNewRun(triggeredWorkflow, context.payload.pull_request, hookType, merge_commit_sha);
                if (triggeredWorkflow.error) {
                    await checks.createWorkflowRunCheckErrored(context.octokit, context.payload.pull_request, hookType, merge_commit_sha, triggeredWorkflow);
                }
            }
            const allTriggeredHasError = triggeredWorkflows.every(workflow => workflow.error);
            if (triggeredWorkflows.length === 0) {
                await checks.createPRCheckNoPipelinesTriggered(context.octokit, context.payload.pull_request, hookType, merge_commit_sha);
            } else if (allTriggeredHasError) {
                await checks.createPRCheckForAllErroredPipelines(context.octokit, context.payload.pull_request, hookType, merge_commit_sha, triggeredWorkflows);
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
            await checks.triggerReRunPRCheck(context.octokit, {
                check_run_id: context.payload.check_run.id,
                owner: context.payload.repository.owner.login,
                repo: context.payload.repository.name,
                requested_action_identifier: identifier
            });
        }
    });

    app.on(["check_run.rerequested"], async (context) => {
        const checkRun = context.payload.check_run;
        app.log.info(`check_run.rerequested event received for ${checkRun.name} with status ${checkRun.status}`);
        if ((<any>Object).values(PRCheckName).includes(checkRun.name)) {
            await checks.triggerReRunPRCheck(context.octokit, {
                check_run_id: context.payload.check_run.id,
                owner: context.payload.repository.owner.login,
                repo: context.payload.repository.name,
                requested_action_identifier: PRCheckAction.ReRunFailed
            });
        } else {
            await checks.triggerReRunWorkflowRunCheck(context.octokit, context.payload as CheckRunRerequestedEvent);
        }
    });

    app.on(["check_suite.rerequested"], async (context) => {
        app.log.info(`check_suite.rerequested event received for ${context.payload.check_suite.id}`);
        // get all check runs for this check suite
        const checkRuns = await context.octokit.checks.listForSuite({
            owner: context.payload.repository.owner.login,
            repo: context.payload.repository.name,
            check_suite_id: context.payload.check_suite.id
        });
        for (const checkRun of checkRuns.data.check_runs) {
            if ((<any>Object).values(PRCheckName).includes(checkRun.name)) {
                await checks.triggerReRunPRCheck(context.octokit, {
                    check_run_id: checkRun.id,
                    owner: context.payload.repository.owner.login,
                    repo: context.payload.repository.name,
                    requested_action_identifier: PRCheckAction.ReRun
                });
            }
        }
    });

    function tokeniseCommand(command: string): string[] {
        let matches
        const output: string[] = []
        while ((matches = TOKENISE_REGEX.exec(command))) {
            output.push(matches[0])
        }
        return output
    }

    app.on(["issue_comment.created", "issue_comment.edited"], async (context) => {
        app.log.info(`Issue comment created/edited event received for ${context.payload.issue.number}`);
        const issueComment = context.payload.comment;
        // check that the comment is not from a bot
        if (issueComment.user.type === 'Bot') {
            app.log.debug('The comment is from a bot, ignoring.')
            return
        }
        // check that the comment is on PR and not an issue
        const isPullRequest = 'pull_request' in context.payload.issue
        if (!isPullRequest) {
            app.log.debug('The comment is not on a PR, ignoring.')
            return
        }
        // check that PR is not merged
        const merged_at = context.payload.issue.pull_request?.merged_at
        if (merged_at) {
            app.log.debug('The PR is merged, ignoring.')
            return
        }
        const owner = context.payload.repository.owner.login;
        const repo = context.payload.repository.name;
        // check that the comment is from a user with write permissions
        const permissions = await context.octokit.repos.getCollaboratorPermissionLevel({
            owner: owner,
            repo: repo,
            username: issueComment.user.login
        })
        if (permissions.status !== 200) {
            app.log.error(`Failed to get permissions for ${issueComment.user.login} in ${context.payload.repository.full_name}`)
            return
        }
        app.log.debug(`Permissions for ${issueComment.user.login} in ${context.payload.repository.full_name} are ${permissions.data.permission}`)
        if (permissions.data.permission !== 'write' && permissions.data.permission !== 'admin') {
            app.log.debug('The comment is from a user without write permissions, ignoring.')
            return
        }
        // check that is not from forked repo
        const prNumber = context.payload.issue.number
        const response = await context.octokit.pulls.get({
            owner: context.payload.repository.owner.login,
            repo: context.payload.repository.name,
            pull_number: prNumber
        })
        if (response.status !== 200) {
            app.log.error(`Failed to get PR ${prNumber} from ${context.payload.repository.full_name}`)
            return
        }
        const pr = response.data
        if (pr.head.repo && pr.head.repo.fork) {
            app.log.debug('The comment is from a forked repo, ignoring.')
            return
        }
        // check that the comment is not on a closed PR
        if (pr.state === 'closed') {
            app.log.debug('The comment is on a closed PR, ignoring.')
            return
        }
        const commentBody = issueComment.body;
        // Check if the first line of the comment is a slash command
        const firstLine = commentBody.split(/\r?\n/)[0].trim()
        if (firstLine.length < 2 || firstLine.charAt(0) != '/') {
            app.log.debug('The first line of the comment is not a valid slash command.')
            return
        }
        // Tokenise the first line (minus the leading slash)
        const commandTokens = tokeniseCommand(firstLine.slice(1))
        app.log.debug(`Command tokens: ${inspect(commandTokens)}`)
        // At this point, we have a valid slash command
        // Add the "eyes" reaction to the comment
        await context.octokit.reactions.createForIssueComment({
            owner: owner,
            repo: repo,
            comment_id: issueComment.id,
            content: 'eyes'
        })
        const numOfChangedFiles = pr.changed_files;
        if (numOfChangedFiles > 0) {
            const repo_full_name = context.payload.repository.full_name;
            const changedFilesResp = await context.octokit.pulls.listFiles({
                owner: owner,
                repo: repo,
                pull_number: prNumber
            });
            const changedFiles = changedFilesResp.data.map((file) => file.filename);
            app.log.info(`PR changed files are ${JSON.stringify(changedFiles)}`);
            const hooksChangedInPR = await ghaLoader.loadGhaHooks(context.octokit, changedFilesResp.data);
            const hookType = "onSlashCommand"
            const baseBranch = pr.base.ref;
            const command = commandTokens[0]
            const triggeredHooks = await hooks.filterTriggeredHooks(repo_full_name, hookType, changedFiles, baseBranch, hooksChangedInPR, command);
            let merge_commit_sha = pr.merge_commit_sha;
            if (merge_commit_sha === null) {
                merge_commit_sha = pr.head.sha;
            }
            const triggeredWorkflows = await hooks.runWorkflow(context.octokit, pr, context.payload.action, triggeredHooks, merge_commit_sha, commandTokens);
            for (const triggeredWorkflow of triggeredWorkflows) {
                await checks.createNewRun(triggeredWorkflow, pr, hookType, merge_commit_sha);
                if (triggeredWorkflow.error) {
                    await checks.createWorkflowRunCheckErrored(context.octokit, pr, hookType, merge_commit_sha, triggeredWorkflow);
                }
            }
            const allTriggeredHasError = triggeredWorkflows.every(workflow => workflow.error);
            if (triggeredWorkflows.length === 0) {
                const checkRunUrl = await checks.createPRCheckNoPipelinesTriggered(context.octokit, pr, hookType, merge_commit_sha);
                await reply.replyToCommentWithReactionAndComment(context, `🫤No pipelines triggered. [Check](${checkRunUrl})`, '+1');
            } else if (allTriggeredHasError) {
                const checkRunUrl = await checks.createPRCheckForAllErroredPipelines(context.octokit, pr, hookType, merge_commit_sha, triggeredWorkflows);
                await reply.replyToCommentWithReactionAndComment(context, `❌All pipelines errored. [Check](${checkRunUrl})`, 'confused');
            } else {
                const checkRunUrl = await checks.createPRCheckForTriggeredPipelines(context.octokit, pr, hookType, merge_commit_sha);
                await reply.replyToCommentWithReactionAndComment(context, `🏁Pipelines triggered. [Check](${checkRunUrl})`, 'rocket');
            }
        } else {
            app.log.info(`No files changed in PR ${prNumber}. No hooks will be triggered`);
            await reply.replyToCommentWithReactionAndComment(context, "No files changed in PR. No hooks will be triggered.", 'confused');
        }
    });
    // For more information on building apps:
    // https://probot.github.io/docs/

    // To get your app running against GitHub, see:
    // https://probot.github.io/docs/development/
};
