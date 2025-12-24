import {ApplicationFunctionOptions, Probot, ProbotOctokit} from "probot";
import {GhaLoader} from "./gha_loader.js";
import {GhaReply} from "./gha_reply.js";
import {Hooks} from "./hooks.js";
import {GhaChecks, PRCheckAction, PRCheckName} from "./gha_checks.js";
import {
    CheckRunRerequestedEvent,
    WorkflowJobCompletedEvent,
    WorkflowJobInProgressEvent,
    WorkflowJobQueuedEvent
} from "@octokit/webhooks-types";
import {
    RestEndpointMethodTypes
} from "@octokit/plugin-rest-endpoint-methods/dist-types/generated/parameters-and-response-types.js";
import {inspect} from "node:util";
import {MergeOptions} from "probot/lib/context.js";
import {loadPackageJson} from "probot/lib/helpers/load-package-json.js";
import {resolve} from "node:path";

const APP_CONFIG_FILE = process.env.APP_CONFIG_FILE || "gha-conductor-config.yaml";
const DEFAULT_GHA_HOOKS_FILE_NAME = process.env.DEFAULT_GHA_HOOKS_FILE_NAME || ".gha.yaml";
const DEFAULT_WORKFLOW_FILE_EXTENSION = process.env.DEFAULT_WORKFLOW_FILE_EXTENSION || ".yaml";

const TOKENISE_REGEX =
    /\S+="[^"\\]*(?:\\.[^"\\]*)*"|"[^"\\]*(?:\\.[^"\\]*)*"|\S+/g

export default (app: Probot, {getRouter}: ApplicationFunctionOptions) => {

    if (getRouter) {
        const pkg = loadPackageJson(resolve(process.cwd(), "package.json"));
        const router = getRouter("/api");
        router.get("/health", (_req, res) => {
            res.json({healthy: true, version: pkg.version});
        });
    }

    const ghaLoader = new GhaLoader(app.log);
    const hooks = new Hooks(app.log);
    const checks = new GhaChecks(app.log);
    const reply = new GhaReply(app.log);
    const configs = new Map<string, any>();

    async function getValueFromConfig(context: {
        config<T>(fileName: string, defaultConfig?: T, deepMergeOptions?: MergeOptions): Promise<T | null>
    }, repo_full_name: string, key: string, reload: boolean = false): Promise<string> {
        let config;
        if (configs.has(repo_full_name) && !reload) {
            config = configs.get(repo_full_name);
        } else {
            config = await context.config(APP_CONFIG_FILE, {
                gha_hooks_file: DEFAULT_GHA_HOOKS_FILE_NAME,
                workflow_file_extension: DEFAULT_WORKFLOW_FILE_EXTENSION
            });
            configs.set(repo_full_name, config);
        }
        return config[key] || "";
    }

    async function getHooksFileNameFromConfig(context: {
        config<T>(fileName: string, defaultConfig?: T, deepMergeOptions?: MergeOptions): Promise<T | null>
    }, repo_full_name: string, reload: boolean = false) {
        return await getValueFromConfig(context, repo_full_name, "gha_hooks_file", reload);
    }

    app.on("push", async (context) => {
        const repoFullName = context.payload.repository.full_name;
        // if push was delete branch
        if (context.payload.deleted) {
            const ref = context.payload.ref;
            const branchName = ref.split("/").pop();
            if (ref.startsWith("refs/heads/") && branchName) {
                await ghaLoader.deleteAllGhaHooksForBranch(repoFullName, branchName);
                app.log.info(`Delete all gha hooks for branch ${branchName} in repo ${repoFullName} completed`);
            } else {
                app.log.info(`Delete was for ref ${ref} that is not a branch`);
            }
            return;
        }
        const changedFiles = context.payload.commits.flatMap((commit) => commit.added.concat(commit.modified).concat(commit.removed));
        let configFileChanged = false;
        for (const file of changedFiles) {
            if (file.endsWith(APP_CONFIG_FILE)) {
                configFileChanged = true;
                break;
            }
        }
        const ref = context.payload.ref;
        const branchName = ref.split("/").pop();
        let reloadConfig = false;
        if (configFileChanged) {
            if (ref.startsWith("refs/heads/") && branchName) {
                if (branchName === "master" || branchName === "main") {
                    reloadConfig = true;
                    app.log.info(`Config file ${APP_CONFIG_FILE} changed in push for branch ${branchName}`);
                }
            }
        }
        const ghaHooksFileName = await getHooksFileNameFromConfig(context, repoFullName, reloadConfig);
        let changedHooksFiles = false;
        for (const file of changedFiles) {
            if (file.endsWith(ghaHooksFileName)) {
                changedHooksFiles = true;
                break;
            }
        }
        if (changedHooksFiles) {
            if (ref.startsWith("refs/heads/") && branchName) {
                let loadHooks = false;
                if (branchName !== "master" && branchName !== "main") {
                    // check if branch is base branch for at least one open PR
                    let params: RestEndpointMethodTypes["pulls"]["list"]["parameters"] = {
                        owner: context.payload.repository.owner.login,
                        repo: context.payload.repository.name,
                        state: "open",
                        base: branchName
                    };
                    try {
                        const branchPRs = await context.octokit.pulls.list(params);
                        if (branchPRs.data.length > 0) {
                            loadHooks = true;
                        } else {
                            app.log.info(`No open PRs found for branch ${branchName}`);
                        }
                    } catch (e) {
                        app.log.error(e, `Failed to get open PRs for branch ${branchName} in repo ${repoFullName}`);
                    }
                } else {
                    loadHooks = true;
                }
                if (loadHooks) {
                    const fullName = context.payload.repository.full_name;
                    if (branchName !== "master" && branchName !== "main") {
                        // For non-main branches that are PR target branches, do a full reload
                        // This ensures hooks are correctly loaded even after force-push
                        await ghaLoader.loadAllGhaHooksFromRepo(context.octokit, fullName, branchName, ghaHooksFileName);
                        app.log.info(`Full reload of hooks for branch ${branchName} in repo ${repoFullName} completed`);
                    } else {
                        // For main/master branches, load incrementally from commits
                        await ghaLoader.loadGhaHooksFromCommits(context.octokit, fullName, branchName, ghaHooksFileName, context.payload.commits);
                        app.log.info(`Load hooks from ${context.payload.commits.map(commit => commit.id).join(',')} commits for branch ${branchName} in repo ${repoFullName} completed`);
                    }
                } else {
                    app.log.info(`No need to load hooks from ${ghaHooksFileName} files for branch ${branchName} in repo ${repoFullName}`);
                }
            } else {
                app.log.info(`Push is for ref ${ref} that is not a branch`);
            }
        } else {
            app.log.info(`No ${ghaHooksFileName} files changed in push`);
        }
    });

    app.on("pull_request.labeled", async (context) => {
        app.log.info(`Pull request labeled event received for ${context.payload.pull_request.number} and label ${context.payload.label.name}`);
        if (context.payload.label.name === "gha-conductor:load") {
            app.log.info("Force reload gha yaml's in repo started");
            const ghaHooksFileName = await getHooksFileNameFromConfig(context, context.payload.repository.full_name, true);
            await ghaLoader.loadAllGhaHooksFromRepo(context.octokit, context.payload.repository.full_name, context.payload.pull_request.base.ref, ghaHooksFileName);
            app.log.info("Force reload gha yaml's in repo done");
        }
    });

    async function determineIsPRMergeable(octokit: InstanceType<typeof ProbotOctokit>, pull_request: {
        mergeable: boolean | null,
        merge_commit_sha: string | null,
        merged: boolean | null,
        number: number
    }, owner: string, repo: string) {
        let mergeable = pull_request.mergeable;
        let merge_commit_sha = pull_request.merge_commit_sha;
        if (mergeable === null && !pull_request.merged) {
            app.log.info(`PR #${pull_request.number} mergeability is null`);
            let i = 0;
            while (i < 5 && mergeable === null) {
                await new Promise(r => setTimeout(r, 2000));
                const resp = await octokit.pulls.get(
                    {
                        owner: owner,
                        repo: repo,
                        pull_number: pull_request.number
                    }
                );
                app.log.debug(`PR #${pull_request.number} mergeability is ${resp.data.mergeable}`);
                i++;
                mergeable = resp.data.mergeable;
                merge_commit_sha = resp.data.merge_commit_sha;
            }
            if (mergeable === null || merge_commit_sha === null) {
                app.log.warn(`PR mergeability is still not determined after ${i} attempts or merge_commit_sha is null`);
            }
        }
        return {mergeable, merge_commit_sha};
    }

    app.on(["pull_request.opened", "pull_request.synchronize", "pull_request.closed", "pull_request.edited"], async (context) => {
        const pr = context.payload.pull_request;
        const pullNumber = context.payload.pull_request.number;
        const owner = context.payload.repository.owner.login;
        const repo = context.payload.repository.name;
        const repo_full_name = context.payload.repository.full_name;
        app.log.info(`PR handler called for ${pr.number} and action ${context.payload.action}`);
        // if pull request edited but changes doesn't contain base branch changes then skip all hooks
        if (context.payload.action === "edited") {
            const changes = context.payload.changes;
            if (changes && changes.base && changes.base.ref && changes.base.ref.from) {
                const baseBranch = changes.base.ref.from;
                const newBaseBranch = pr.base.ref;
                app.log.info(`PR base branch was changed from ${baseBranch} to ${newBaseBranch}. Reevaluating hooks`);
                const ghaHooksFileName = await getHooksFileNameFromConfig(context, context.payload.repository.full_name);
                await ghaLoader.loadAllGhaYamlForBranchIfNew(context.octokit, repo_full_name, newBaseBranch, ghaHooksFileName);
            } else {
                app.log.info("PR base branch was not changed. No hooks will be triggered");
                return;
            }
        }
        let {mergeable, merge_commit_sha} = await determineIsPRMergeable(context.octokit, pr, owner, repo);
        if (merge_commit_sha === null) {
            merge_commit_sha = context.payload.pull_request.head.sha;
        }
        if (!mergeable && !pr.merged) {
            app.log.info(`PR #${pr.number} is not mergeable. No hooks will be triggered`);
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
            const ghaHooksFileName = await getHooksFileNameFromConfig(context, context.payload.repository.full_name);
            // if PR is just opened load all gha hooks for base branch
            if (context.payload.action === "opened") {
                await ghaLoader.loadAllGhaYamlForBranchIfNew(context.octokit, repo_full_name, baseBranch, ghaHooksFileName);
                app.log.info(`PR is just opened. Loading all gha hooks for base branch ${baseBranch} completed`);
            }
            const eventType = context.payload.action;
            const hookType = Hooks.mapEventTypeToHook(eventType, context.payload.pull_request.merged);
            let changedFilesResp = [];
            try {
                changedFilesResp = await context.octokit.paginate(context.octokit.pulls.listFiles, {
                    owner: owner,
                    repo: repo,
                    pull_number: pullNumber
                });
            } catch (e) {
                app.log.error(e, `Failed to get changed files for PR ${pullNumber} in repo ${repo_full_name}`);
                return;
            }
            const changedFiles = changedFilesResp.map((file) => file.filename);
            app.log.debug(`PR changed files are ${JSON.stringify(changedFiles)}`);
            const prCheck = await checks.createPRCheck(context.octokit, pr, hookType, merge_commit_sha);
            if (prCheck.checkRunId === 0) {
                app.log.warn(`Failed to create PR check for ${hookType} in repo ${repo_full_name} for PR ${pullNumber}`);
                return;
            }
            const annotationsForCheck = await ghaLoader.validateGhaYamlFiles(context.octokit, ghaHooksFileName, changedFilesResp);
            if (annotationsForCheck.length > 0) {
                await checks.updatePRCheckWithAnnotations(context.octokit, pr, prCheck, annotationsForCheck);
                return;
            }
            const hooksChangedInPR = await ghaLoader.loadGhaHooks(context.octokit, ghaHooksFileName, changedFilesResp);
            const triggeredHooks = await hooks.filterTriggeredHooks(repo_full_name, hookType, changedFiles, baseBranch, hooksChangedInPR);
            const workflowFileExtension = await getValueFromConfig(context, repo_full_name, "workflow_file_extension");
            const triggeredWorkflows = await hooks.runWorkflow(context.octokit, context.payload.pull_request, context.payload.action, triggeredHooks, merge_commit_sha, prCheck.checkRunId, undefined, workflowFileExtension);
            for (const triggeredWorkflow of triggeredWorkflows) {
                if (triggeredWorkflow.error) {
                    await checks.createWorkflowRunCheckErrored(context.octokit, context.payload.pull_request, hookType, merge_commit_sha, triggeredWorkflow);
                }
            }
            const allTriggeredHasError = triggeredWorkflows.every(workflow => workflow.error);
            if (triggeredWorkflows.length === 0) {
                await checks.updatePRCheckNoPipelinesTriggered(context.octokit, context.payload.pull_request, prCheck);
            } else if (allTriggeredHasError) {
                await checks.updatePRCheckForAllErroredPipelines(context.octokit, context.payload.pull_request, prCheck, triggeredWorkflows);
            } else {
                await checks.updatePRCheckForTriggeredPipelines(context.octokit, context.payload.pull_request, prCheck);
            }
        } else {
            app.log.info("No files changed in PR. No hooks will be triggered");
        }
    });

    app.on("pull_request.reopened", async (context) => {
        app.log.info(`Pull request reopened event received for ${context.payload.pull_request.number}`);
        const pr = context.payload.pull_request;
        const prNumber = pr.number;
        const owner = context.payload.repository.owner.login;
        const repo = context.payload.repository.name;
        const {mergeable} = await determineIsPRMergeable(context.octokit, pr, owner, repo);
        if (!mergeable) {
            app.log.info(`PR #${prNumber} is not mergeable. No hooks will be triggered`);
            return;
        }
        // if PR is from forked repo then skip all hooks
        if (pr.head.repo && pr.head.repo.fork) {
            app.log.info(`PR #${prNumber} is from forked repo. No hooks will be triggered`);
            const comment = context.issue({
                body: "PR is from forked repo. No hooks will be triggered."
            });
            await context.octokit.issues.createComment(comment);
            return;
        }
        // if PR doesn't have any changed files then skip all hooks
        const numOfChangedFiles = pr.changed_files;
        if (numOfChangedFiles === 0) {
            app.log.info(`PR #${prNumber} doesn't have any changed files. No hooks will be triggered`);
            return;
        }
        // if PR is reopened, we need to identify existing pr-status check and re-run all workflows
        const prStatusCheckId = await checks.findPRStatusCheckIdForCommit(context.octokit, owner, repo, pr.head.sha);
        if (prStatusCheckId == undefined) {
            app.log.warn(`No ${PRCheckName.PRStatus} check found for PR #${prNumber}`);
            return;
        }
        await checks.triggerReRunPRCheck(context.octokit, {
            check_run_id: prStatusCheckId,
            owner: owner,
            repo: repo,
            requested_action_identifier: PRCheckAction.ReRun
        });
    });

    app.on("workflow_job", async (context) => {
        const payload = context.payload;
        app.log.info(`workflow_job.${payload.action} event received for ${payload.workflow_job.name}`);
        const workflowJob = payload.workflow_job;
        if (workflowJob.run_id) {
            try {
                const workflowRun = await context.octokit.actions.getWorkflowRun({
                    owner: payload.repository.owner.login,
                    repo: payload.repository.name,
                    run_id: workflowJob.run_id
                });
                switch (payload.action) {
                    case "queued":
                        await checks.updateWorkflowRunCheckQueued(context.octokit, payload as WorkflowJobQueuedEvent, workflowRun.data.id);
                        break;
                    case "in_progress":
                        await checks.updateWorkflowRunCheckInProgress(context.octokit, payload as WorkflowJobInProgressEvent);
                        await checks.updatePRStatusCheckInProgress(context.octokit, payload as WorkflowJobInProgressEvent);
                        break;
                    default:
                        await checks.updateWorkflowRunCheckCompleted(context.octokit, payload as WorkflowJobCompletedEvent);
                        await checks.updatePRStatusCheckCompleted(context.octokit, payload as WorkflowJobCompletedEvent);
                        break;
                }
            } catch (e) {
                app.log.error(e, `Failed to get workflow run for ${workflowJob.run_id} in repo ${payload.repository.full_name}`);
            }
        }
    });

    app.on(["check_run.requested_action"], async (context) => {
        const identifier = context.payload.requested_action.identifier;
        app.log.info(`check_run.requested_action event received for ${context.payload.check_run.name} with identifier ${identifier}`);
        if (identifier === PRCheckAction.SyncStatus) {
            await checks.syncPRCheckStatus(context.octokit, {
                check_run_id: context.payload.check_run.id,
                owner: context.payload.repository.owner.login,
                repo: context.payload.repository.name
            });
        } else if (identifier === PRCheckAction.ReRun || identifier === PRCheckAction.ReRunFailed) {
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
        try {
            const checkRuns = await context.octokit.paginate(context.octokit.checks.listForSuite, {
                owner: context.payload.repository.owner.login,
                repo: context.payload.repository.name,
                check_suite_id: context.payload.check_suite.id
            });
            for (const checkRun of checkRuns) {
                if ((<any>Object).values(PRCheckName).includes(checkRun.name)) {
                    await checks.triggerReRunPRCheck(context.octokit, {
                        check_run_id: checkRun.id,
                        owner: context.payload.repository.owner.login,
                        repo: context.payload.repository.name,
                        requested_action_identifier: PRCheckAction.ReRun
                    });
                }
            }
        } catch (e) {
            app.log.error(e, `Failed to get check runs for check suite ${context.payload.check_suite.id} in repo ${context.payload.repository.full_name}`);
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
        try {
            const permissions = await context.octokit.repos.getCollaboratorPermissionLevel({
                owner: owner,
                repo: repo,
                username: issueComment.user.login
            })
            app.log.debug(`Permissions for ${issueComment.user.login} in ${context.payload.repository.full_name} are ${permissions.data.permission}`)
            if (permissions.data.permission !== 'write' && permissions.data.permission !== 'admin') {
                app.log.debug('The comment is from a user without write permissions, ignoring.')
                return
            }
        } catch (e) {
            app.log.error(e, `Failed to get permissions for ${issueComment.user.login} in ${context.payload.repository.full_name}`)
            return
        }
        // check that is not from forked repo
        const prNumber = context.payload.issue.number
        let pr = null
        try {
            const response = await context.octokit.pulls.get({
                owner: context.payload.repository.owner.login,
                repo: context.payload.repository.name,
                pull_number: prNumber
            })
            pr = response.data
        } catch (e) {
            app.log.error(e, `Failed to get PR ${prNumber} from ${context.payload.repository.full_name}`)
            return
        }
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
        try {
            await context.octokit.reactions.createForIssueComment({
                owner: owner,
                repo: repo,
                comment_id: issueComment.id,
                content: 'eyes'
            })
        } catch (e) {
            app.log.error(e, `Failed to add "eyes" reaction to comment ${issueComment.id} in ${context.payload.repository.full_name}`)
        }
        const numOfChangedFiles = pr.changed_files;
        if (numOfChangedFiles > 0) {
            const repo_full_name = context.payload.repository.full_name;
            let changedFilesResp = [];
            try {
                changedFilesResp = await context.octokit.paginate(context.octokit.pulls.listFiles, {
                    owner: owner,
                    repo: repo,
                    pull_number: prNumber
                });
            } catch (e) {
                app.log.error(e, `Failed to get changed files for PR ${prNumber} in repo ${repo_full_name}`);
                return;
            }
            const changedFiles = changedFilesResp.map((file) => file.filename);
            app.log.info(`PR changed files are ${JSON.stringify(changedFiles)}`);
            let merge_commit_sha = pr.merge_commit_sha;
            if (merge_commit_sha === null) {
                merge_commit_sha = pr.head.sha;
            }
            const hookType = "onSlashCommand"
            const prCheck = await checks.createPRCheck(context.octokit, pr, hookType, merge_commit_sha);
            if (prCheck.checkRunId === 0) {
                app.log.warn(`Failed to create PR check for ${hookType} in repo ${repo_full_name} for PR ${prNumber}`);
                return;
            }
            const ghaHooksFileName = await getHooksFileNameFromConfig(context, repo_full_name);
            const hooksChangedInPR = await ghaLoader.loadGhaHooks(context.octokit, ghaHooksFileName, changedFilesResp);
            const baseBranch = pr.base.ref;
            const command = commandTokens[0]
            const triggeredHooks = await hooks.filterTriggeredHooks(repo_full_name, hookType, changedFiles, baseBranch, hooksChangedInPR, command);
            const workflowFileExtension = await getValueFromConfig(context, repo_full_name, "workflow_file_extension");
            const triggeredWorkflows = await hooks.runWorkflow(context.octokit, pr, context.payload.action, triggeredHooks, merge_commit_sha, prCheck.checkRunId, commandTokens, workflowFileExtension);
            for (const triggeredWorkflow of triggeredWorkflows) {
                if (triggeredWorkflow.error) {
                    await checks.createWorkflowRunCheckErrored(context.octokit, pr, hookType, merge_commit_sha, triggeredWorkflow);
                }
            }
            const allTriggeredHasError = triggeredWorkflows.every(workflow => workflow.error);
            if (triggeredWorkflows.length === 0) {
                const checkRunUrl = await checks.updatePRCheckNoPipelinesTriggered(context.octokit, pr, prCheck);
                await reply.replyToCommentWithReactionAndComment(context, `🫤No pipelines triggered. [Check](${checkRunUrl})`, '+1');
            } else if (allTriggeredHasError) {
                const checkRunUrl = await checks.updatePRCheckForAllErroredPipelines(context.octokit, pr, prCheck, triggeredWorkflows);
                await reply.replyToCommentWithReactionAndComment(context, `❌All pipelines errored. [Check](${checkRunUrl})`, 'confused');
            } else {
                const checkRunUrl = await checks.updatePRCheckForTriggeredPipelines(context.octokit, pr, prCheck);
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
