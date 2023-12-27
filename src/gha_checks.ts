import {
    CheckRunRerequestedEvent,
    PullRequest,
    WorkflowJobCompletedEvent,
    WorkflowJobInProgressEvent,
    WorkflowJobQueuedEvent
} from "@octokit/webhooks-types";
import {ProbotOctokit} from "probot";
import {
    RestEndpointMethodTypes
} from "@octokit/plugin-rest-endpoint-methods/dist-types/generated/parameters-and-response-types";
import db, {gha_workflow_runs} from "./db/database";
import {GhaWorkflowRuns} from "./__generated__";
import pino from "pino";
import {getTransformStream} from "@probot/pino";
import {anyOf, not} from "@databases/pg-typed";
import {TriggeredPipeline} from "./hooks";

const transform = getTransformStream();
transform.pipe(pino.destination(1));
const log = pino(
    {
        name: "gha-checks",
    },
    transform
);

export enum PRCheckName {
    PRStatus = "pr-status",
    PRMerge = "pr-merge",
    PRClose = "pr-close"
}

export enum PRCheckAction {
    ReRun = "re-run",
    ReRunFailed = "re-run-failed"
}

export interface ReRunPayload {
    owner: string,
    repo: string,
    check_run_id: number,
    requested_action_identifier: PRCheckAction
}

export class GhaChecks {

    async createNewRun(pipeline: TriggeredPipeline, pull_request: (PullRequest & {
        state: "closed";
        closed_at: string;
        merged: boolean
    }) | PullRequest | (PullRequest & {
        closed_at: null;
        merged_at: null;
        draft: true;
        merged: false;
        merged_by: null
    }) | (PullRequest & {
        state: "open";
        closed_at: null;
        merged_at: null;
        merge_commit_sha: null;
        active_lock_reason: null;
        merged_by: null
    }) | (PullRequest & {
        state: "open";
        closed_at: null;
        merged_at: null;
        draft: false;
        merged: boolean;
        merged_by: null
    }) | (PullRequest & {
        state: "open";
        closed_at: null;
        merged_at: null;
        merged: boolean;
        merged_by: null
    }), hookType: "onBranchMerge" | "onPullRequest" | "onPullRequestClose", merge_commit_sha: string) {
        const {headSha, checkName} = this.parseHeadShaFromJobName(pipeline.name);
        if (headSha) {
            await gha_workflow_runs(db).insert({
                name: checkName,
                head_sha: headSha,
                merge_commit_sha: merge_commit_sha,
                pipeline_run_name: pipeline.name,
                workflow_run_inputs: pipeline.inputs,
                pr_number: pull_request.number,
                hook: hookType,
            });
        } else {
            log.error("Failed to parse head sha from pipeline name " + pipeline);
        }
    }

    private hookToCheckName(hookType: "onBranchMerge" | "onPullRequest" | "onPullRequestClose") {
        switch (hookType) {
            case "onPullRequest":
                return PRCheckName.PRStatus;
            case "onBranchMerge":
                return PRCheckName.PRMerge;
            case "onPullRequestClose":
                return PRCheckName.PRClose;
        }
    }

    async createPRCheckNoPipelinesTriggered(octokit: InstanceType<typeof ProbotOctokit>, pull_request: (PullRequest & {
        state: "closed";
        closed_at: string;
        merged: boolean
    }) | PullRequest | (PullRequest & {
        closed_at: null;
        merged_at: null;
        draft: true;
        merged: false;
        merged_by: null
    }) | (PullRequest & {
        state: "open";
        closed_at: null;
        merged_at: null;
        merge_commit_sha: null;
        active_lock_reason: null;
        merged_by: null
    }) | (PullRequest & {
        state: "open";
        closed_at: null;
        merged_at: null;
        draft: false;
        merged: boolean;
        merged_by: null
    }) | (PullRequest & {
        state: "open";
        closed_at: null;
        merged_at: null;
        merged: boolean;
        merged_by: null
    }), hookType: "onBranchMerge" | "onPullRequest" | "onPullRequestClose", merge_commit_sha: string) {
        const checkName = this.hookToCheckName(hookType);
        log.info(`Creating ${checkName} check for ${pull_request.base.repo.owner.login}/${pull_request.base.repo.name}#${pull_request.number}`);
        const sha = hookType === "onBranchMerge" ? merge_commit_sha : pull_request.head.sha;
        const params: RestEndpointMethodTypes["checks"]["create"]["parameters"] = {
            owner: pull_request.base.repo.owner.login,
            repo: pull_request.base.repo.name,
            name: checkName,
            head_sha: sha,
            status: "completed",
            conclusion: "success",
            completed_at: new Date().toISOString(),
            output: {
                title: "No workflows to run",
                summary: `No workflows to run for hook ${hookType}`
            }
        };
        const resp = await octokit.checks.create(params);
        const checkRunId = resp.data.id;
        if (resp.status === 201) {
            log.info(`${checkName} check with id ${checkRunId} for PR #${pull_request.number} created`);
        } else {
            log.error(`Failed to create ${checkName} check for PR #${pull_request.number}`);
        }
    }

    async createPRCheckForTriggeredPipelines(octokit: InstanceType<typeof ProbotOctokit>, pull_request: (PullRequest & {
        state: "closed";
        closed_at: string;
        merged: boolean
    }) | PullRequest | (PullRequest & {
        closed_at: null;
        merged_at: null;
        draft: true;
        merged: false;
        merged_by: null
    }) | (PullRequest & {
        state: "open";
        closed_at: null;
        merged_at: null;
        merge_commit_sha: null;
        active_lock_reason: null;
        merged_by: null
    }) | (PullRequest & {
        state: "open";
        closed_at: null;
        merged_at: null;
        draft: false;
        merged: boolean;
        merged_by: null
    }) | (PullRequest & {
        state: "open";
        closed_at: null;
        merged_at: null;
        merged: boolean;
        merged_by: null
    }), hookType: "onBranchMerge" | "onPullRequest" | "onPullRequestClose", merge_commit_sha: string) {
        const checkName = this.hookToCheckName(hookType);
        log.info(`Creating ${checkName} check for ${pull_request.base.repo.owner.login}/${pull_request.base.repo.name}#${pull_request.number}`);
        const sha = hookType === "onBranchMerge" ? merge_commit_sha : pull_request.head.sha;
        const workflowRuns = await gha_workflow_runs(db).find({pr_number: pull_request.number, pr_check_id: null, hook: hookType}).all();
        const summary = this.formatGHCheckSummaryAll(workflowRuns);
        const params: RestEndpointMethodTypes["checks"]["create"]["parameters"] = {
            owner: pull_request.base.repo.owner.login,
            repo: pull_request.base.repo.name,
            name: checkName,
            head_sha: sha,
            status: "queued",
            started_at: new Date().toISOString(),
            output: {
                title: "Workflow runs are queued",
                summary: summary
            }
        };
        const resp = await octokit.checks.create(params);
        const checkRunId = resp.data.id;
        log.info(`Updating ${checkName} check with id ${checkRunId} for PR #${pull_request.number} in progress`);
        if (resp.status === 201) {
            await gha_workflow_runs(db).update({pr_number: pull_request.number, pr_check_id: null, hook: hookType}, {
                pr_check_id: checkRunId
            });
        }
    }

    private parseHeadShaFromJobName(jobName: string): { headSha: string | undefined, checkName: string } {
        // parse head sha from job name %s-%s-%s last part is sha
        const headSha = jobName.split("-").pop();
        // get check name from job name %s-%s-%s all parts except last one
        const checkName = jobName.split("-").slice(0, -1).join("-");
        return {headSha, checkName};
    }

    async updateWorkflowRunCheckQueued(octokit: InstanceType<typeof ProbotOctokit>, payload: WorkflowJobQueuedEvent, workflow_run_id: number) {
        // check if workflow run is exist in db
        const workflowJob = payload.workflow_job;
        const knownWorkflowRuns = await gha_workflow_runs(db).find({pipeline_run_name: workflowJob.name}).all();
        if (knownWorkflowRuns.length === 0) {
            log.warn(`Workflow run ${workflowJob.name} is not exist in db`);
        } else {
            const {headSha, checkName} = this.parseHeadShaFromJobName(workflowJob.name);
            const sha = knownWorkflowRuns[0].hook === "onBranchMerge" ? knownWorkflowRuns[0].merge_commit_sha : headSha;
            const summary = this.formatGHCheckSummaryAll(knownWorkflowRuns);
            let params: RestEndpointMethodTypes["checks"]["create"]["parameters"] = {
                owner: payload.repository.owner.login,
                repo: payload.repository.name,
                name: checkName,
                head_sha: sha,
                details_url: `https://github.com/${payload.repository.full_name}/actions/runs/${workflowJob.run_id}`,
                status: "queued",
                started_at: new Date().toISOString(),
                output: {
                    title: "Workflow runs are queued",
                    summary: summary
                }
            };
            const resp = await octokit.checks.create(params);
            if (resp.status === 201) {
                const check = resp.data;
                // update workflow run in db
                await gha_workflow_runs(db).update({pipeline_run_name: workflowJob.name, workflow_job_id: null}, {
                    workflow_run_id: workflow_run_id,
                    workflow_job_id: workflowJob.id,
                    status: check.status,
                    check_run_id: check.id,
                    workflow_run_url: check.details_url
                });
            }
        }
    }

    async updateWorkflowRunCheckInProgress(octokit: InstanceType<typeof ProbotOctokit>, payload: WorkflowJobInProgressEvent) {
        const workflowJob = payload.workflow_job;
        const workflowRun = await gha_workflow_runs(db).findOne({
            pipeline_run_name: workflowJob.name,
            conclusion: null
        });
        if (!workflowRun) {
            log.warn(`Workflow run ${workflowJob.name} is not exist in db`);
        } else {
            const params: RestEndpointMethodTypes["checks"]["update"]["parameters"] = {
                owner: payload.repository.owner.login,
                repo: payload.repository.name,
                check_run_id: workflowRun.check_run_id?.toString(),
                status: "in_progress",
                output: {
                    title: "Workflow runs in progress",
                    summary: this.formatGHCheckSummary(workflowRun, "", "in_progress", null)
                }
            };
            const resp = await octokit.checks.update(params);
            if (resp.status === 200) {
                const check = resp.data;
                // update workflow run in db
                await gha_workflow_runs(db).update({pipeline_run_name: workflowJob.name, check_run_id: check.id}, {
                    status: check.status,
                });
            }
        }
    }

    async updateWorkflowRunCheckCompleted(octokit: InstanceType<typeof ProbotOctokit>, payload: WorkflowJobCompletedEvent) {
        const workflowJob = payload.workflow_job;
        const workflowRun = await gha_workflow_runs(db).findOne({
            pipeline_run_name: workflowJob.name,
            conclusion: null
        });
        if (!workflowRun) {
            log.warn(`Workflow run ${workflowJob.name} is not exist in db`);
        } else {
            const params: RestEndpointMethodTypes["checks"]["update"]["parameters"] = {
                owner: payload.repository.owner.login,
                repo: payload.repository.name,
                check_run_id: workflowRun.check_run_id?.toString(),
                status: "completed",
                conclusion: payload.workflow_job.conclusion,
                completed_at: new Date().toISOString(),
                output: {
                    title: "Workflow runs completed",
                    summary: this.formatGHCheckSummary(workflowRun, payload.workflow_job.conclusion, "completed", null)
                }
            };
            const resp = await octokit.checks.update(params);
            if (resp.status === 200) {
                const check = resp.data;
                // update workflow run in db
                await gha_workflow_runs(db).update({pipeline_run_name: workflowJob.name, check_run_id: check.id}, {
                    status: check.status,
                    conclusion: check.conclusion,
                });
            }
        }
    }

    async updatePRStatusCheckInProgress(octokit: InstanceType<typeof ProbotOctokit>, payload: WorkflowJobInProgressEvent) {
        // find pr_status check run id in db
        const workflowJob = payload.workflow_job;
        const workflowRun = await gha_workflow_runs(db).findOne({
            pipeline_run_name: workflowJob.name,
            conclusion: null
        });
        // update pr_status check run
        if (!workflowRun) {
            log.warn(`Workflow run ${workflowJob.name} is not exist in db`);
        } else {
            const summary = this.formatGHCheckSummary(workflowRun, "", "in_progress", null);
            const params: RestEndpointMethodTypes["checks"]["update"]["parameters"] = {
                owner: payload.repository.owner.login,
                repo: payload.repository.name,
                check_run_id: workflowRun.pr_check_id?.toString(),
                status: "in_progress",
                output: {
                    title: "Workflow runs in progress",
                    summary: summary
                }
            };
            const resp = await octokit.checks.update(params);
            if (resp.status === 200) {
                log.info(`Updating pr-status check with id ${workflowRun.pr_check_id} for PR #${workflowRun.pr_number}` + " in progress");
            } else {
                log.error("Failed to update pr-status check with id " + workflowRun.pr_check_id + " for PR #" + workflowRun.pr_number + " in progress");
            }
        }
    }

    private formatGHCheckSummary(workflow: GhaWorkflowRuns, conclusion: string, status: string, log: string | null) {
        let workflowRunStatusIcon: string;
        if (conclusion === "failure") {
            workflowRunStatusIcon = "❌";
        } else if (conclusion === "success") {
            workflowRunStatusIcon = "✅";
        } else if (status === "in_progress") {
            workflowRunStatusIcon = "\uD83D\uDD04";
        } else {
            workflowRunStatusIcon = "⏸️";
        }
        let summary = `<details><summary>${workflowRunStatusIcon}: ${workflow.name}</summary><p>\n` +
            `\n` +
            `\n` +
            `**[View Workflow Run](${workflow.workflow_run_url})**` +
            `\n` +
            `\n`;
        if (log) {
            summary += `### Workflow logs tail\n` +
                `    \n` +
                `\`\`\`console\n` +
                `${log}\`\`\`\n`;
        }
        summary += `### Workflow run arguments\n` +
            `\n` +
            `\`\`\`json\n` +
            `\n` +
            `${JSON.stringify(workflow.workflow_run_inputs,  null, 2)} \n` +
            `\n` +
            `\`\`\`\n` +
            `\n` +
            `</p>\n` +
            `</details>`;
        return summary;
    }

    private formatGHCheckSummaryAll(workflowRuns: GhaWorkflowRuns[], status: string = "") {
        let summary = "";
        for (const workflowRun of workflowRuns) {
            const workflowRunConclusion = workflowRun.conclusion ? workflowRun.conclusion : "";
            const workflowRunStatus = workflowRun.status ? workflowRun.status : status;
            summary += this.formatGHCheckSummary(workflowRun, workflowRunConclusion, workflowRunStatus, null);
            summary += "\n";
        }
        return summary;
    }


    async updatePRStatusCheckCompleted(octokit: InstanceType<typeof ProbotOctokit>, payload: WorkflowJobCompletedEvent) {
        // find all workflow runs for this with same workflow_job_id
        const workflowJob = payload.workflow_job;
        const workflowRun = await gha_workflow_runs(db).findOne({
            pipeline_run_name: workflowJob.name,
            pr_conclusion: null
        });
        if (!workflowRun) {
            log.warn(`Workflow run ${workflowJob.name} is not exist in db`);
            return;
        }
        const prNumber = workflowRun.pr_number;
        if (prNumber === null) {
            log.warn(`Workflow run ${workflowJob.name} does not have pr_number`);
            return;
        }
        const allPRWorkflowRuns = await gha_workflow_runs(db).find({
            pr_number: prNumber,
            pr_conclusion: null
        }).all();
        if (allPRWorkflowRuns.length === 0) {
            log.warn(`No workflow runs for pr #${prNumber} found with pr_status_conclusion is null in db`);
        } else {
            const finished = allPRWorkflowRuns.every((run) => run.status === "completed");
            if (finished) {
                log.info("All jobs finished for pr #" + allPRWorkflowRuns[0].pr_number);
                const conclusion = this.getConclusion(allPRWorkflowRuns);
                const actions = this.getAvailableActions(conclusion);
                const summary = this.formatGHCheckSummaryAll(allPRWorkflowRuns, "completed");
                const params: RestEndpointMethodTypes["checks"]["update"]["parameters"] = {
                    owner: payload.repository.owner.login,
                    repo: payload.repository.name,
                    check_run_id: allPRWorkflowRuns[0].pr_check_id?.toString(),
                    status: "completed",
                    conclusion: conclusion,
                    completed_at: new Date().toISOString(),
                    output: {
                        title: "All workflow runs completed",
                        summary: summary
                    },
                    actions: actions
                };
                const resp = await octokit.checks.update(params);
                if (resp.status === 200) {
                    log.info(`Updating pr-status check with id ${allPRWorkflowRuns[0].pr_check_id} for PR #${allPRWorkflowRuns[0].pr_number}` + " completed");
                    await gha_workflow_runs(db).update({pr_check_id: allPRWorkflowRuns[0].pr_check_id}, {
                        pr_conclusion: conclusion,
                    });
                } else {
                    log.error("Failed to update pr-status check with id " + allPRWorkflowRuns[0].pr_check_id + " for PR #" + allPRWorkflowRuns[0].pr_number + " completed");
                }
            } else {
                log.info("Some jobs not finished for pr #" + allPRWorkflowRuns[0].pr_number);
            }
        }
    }

    private getAvailableActions(conclusion: string) {
        const reRunAction = {
            label: "Re-run",
            description: "Re-run all workflows",
            identifier: PRCheckAction.ReRun
        };
        const reRunFailedAction = {
            label: "Re-run failed",
            description: "Re-run failed workflows",
            identifier: PRCheckAction.ReRunFailed
        };
        const actions = [
            reRunAction
        ];
        if (conclusion !== "success") {
            actions.push(reRunFailedAction);
        }
        return actions;
    }

    private getConclusion(workflowRuns: GhaWorkflowRuns[]) {
        // get conclusion from workflow runs
        // conclusion values | "success" | "failure" | "cancelled"  | "skipped" | "action_required" | "neutral" | "stale" | "timed_out";
        // if all the jobs are success, then the conclusion is success
        if (workflowRuns.every((r) => r.conclusion === "success")) {
            return "success";
        } else if (workflowRuns.some((r) => r.conclusion === "failure")) {
            // if any of the jobs failed, then the conclusion is failure
            return "failure";
        } else if (workflowRuns.some((r) => r.conclusion === "cancelled")) {
            return "cancelled";
        } else if (workflowRuns.some((r) => r.conclusion === "skipped")) {
            return "skipped";
        } else if (workflowRuns.some((r) => r.conclusion === "action_required")) {
            return "action_required";
        } else if (workflowRuns.some((r) => r.conclusion === "neutral")) {
            return "neutral";
        } else if (workflowRuns.some((r) => r.conclusion === "stale")) {
            return "stale";
        } else if (workflowRuns.some((r) => r.conclusion === "timed_out")) {
            return "timed_out";
        } else {
            return "failure";
        }
    }

    async triggerReRunPRCheck(octokit: InstanceType<typeof ProbotOctokit>, payload: ReRunPayload) {
        let prRelatedWorkflowRuns: string | GhaWorkflowRuns[] = []
        const actionIdentifier = payload.requested_action_identifier;
        const checkId = payload.check_run_id;
        if (actionIdentifier === PRCheckAction.ReRun) {
            log.info(`Find all workflow runs that match check id ${checkId}`);
            prRelatedWorkflowRuns = await gha_workflow_runs(db).find({
                pr_check_id: checkId,
                pr_conclusion: not(null),
            }).all();
        } else if (actionIdentifier === PRCheckAction.ReRunFailed) {
            log.info(`Find all workflow runs that match check id ${checkId} and conclusion is not success`);
            prRelatedWorkflowRuns = await gha_workflow_runs(db).find({
                pr_check_id: checkId,
                pr_conclusion: not(null),
                conclusion: anyOf(["failure", "cancelled", "skipped", "action_required", "neutral", "stale", "timed_out"])
            }).all();
        }
        // find all workflow runs for this with same pr_check_id
        if (prRelatedWorkflowRuns.length === 0) {
            log.warn(`No workflow runs for check id ${checkId} found in db`);
        } else {
            await this.cleanupPreviousResultFor(prRelatedWorkflowRuns);
            await this.reCreatePrCheck(prRelatedWorkflowRuns[0], octokit, checkId, payload.owner, payload.repo);
            await this.triggerReRunFor(prRelatedWorkflowRuns, octokit, payload.owner, payload.repo);
        }
    }

    private async reCreatePrCheck(prRelatedWorkflowRun: GhaWorkflowRuns, octokit: InstanceType<typeof ProbotOctokit>, pr_check_id: number, owner: string, repo: string) {
        const checkName = this.hookToCheckName(prRelatedWorkflowRun.hook);
        log.info(`Re-creating ${checkName} check for ${owner}/${repo}#${prRelatedWorkflowRun.pr_number}`);
        const sha = prRelatedWorkflowRun.hook === "onBranchMerge" ? prRelatedWorkflowRun.merge_commit_sha : prRelatedWorkflowRun.head_sha;
        const params: RestEndpointMethodTypes["checks"]["create"]["parameters"] = {
            owner: owner,
            repo: repo,
            name: checkName,
            head_sha: sha,
            status: "queued",
            started_at: new Date().toISOString()
        };
        const resp = await octokit.checks.create(params);
        const newPRcheckRunId = resp.data.id;
        if (resp.status === 201) {
            log.info(`${checkName} check with id ${newPRcheckRunId} for PR #${prRelatedWorkflowRun.pr_number} created`);
            await gha_workflow_runs(db).update({pr_check_id: pr_check_id}, {
                pr_check_id: newPRcheckRunId
            });
        } else {
            log.error(`Failed to create ${checkName} check for PR #${prRelatedWorkflowRun.pr_number}`);
        }
    }

    private async triggerReRunFor(workflowRuns: GhaWorkflowRuns[], octokit: InstanceType<typeof ProbotOctokit>, owner: string, repo: string) {
        for (const workflowRun of workflowRuns) {
            const params: RestEndpointMethodTypes["actions"]["reRunWorkflow"]["parameters"] = {
                owner: owner,
                repo: repo,
                run_id: Number(workflowRun.workflow_run_id)
            };
            const resp = await octokit.actions.reRunWorkflow(params);
            if (resp.status === 201) {
                log.info(`Re-run workflow ${workflowRun.pipeline_run_name} with id ${workflowRun.workflow_run_id} for PR #${workflowRun.pr_number} created`);
            } else {
                log.error(`Failed to re-run workflow ${workflowRun.pipeline_run_name} with id ${workflowRun.workflow_run_id} for PR #${workflowRun.pr_number}`);
            }
        }
    }

    private async cleanupPreviousResultFor(workflowRuns: GhaWorkflowRuns[]) {
        for (const workflowRun of workflowRuns) {
            await gha_workflow_runs(db).update({workflow_run_id: workflowRun.workflow_run_id}, {
                workflow_job_id: null,
                conclusion: null,
                pr_conclusion: null,
            });
        }
    }

    async triggerReRunWorkflowRunCheck(octokit: InstanceType<typeof ProbotOctokit>, payload: CheckRunRerequestedEvent) {
        // find all workflow runs with same check_run_id and not in progress
        const checkId = payload.check_run.id;
        const checkRelatedWorkflowRuns = await gha_workflow_runs(db).find({
            check_run_id: checkId,
            pr_conclusion: not(null)
        }).all();
        if (checkRelatedWorkflowRuns.length === 0) {
            log.warn(`No workflow runs for check id ${checkId} and pr_conclusion is not null found in db`);
        } else {
            // create new pr check run
            const checkRelatedWorkflowRun = checkRelatedWorkflowRuns[0];
            const pr_check_id = checkRelatedWorkflowRun.pr_check_id;
            if (pr_check_id === null) {
                log.warn(`Workflow run ${checkRelatedWorkflowRun.pipeline_run_name} does not have pr_check_id`);
                return;
            }
            await this.cleanupPreviousResultFor(checkRelatedWorkflowRuns);
            await this.reCreatePrCheck(checkRelatedWorkflowRun, octokit, pr_check_id, payload.repository.owner.login, payload.repository.name);
            await this.triggerReRunFor(checkRelatedWorkflowRuns, octokit, payload.repository.owner.login, payload.repository.name);
        }
    }
}