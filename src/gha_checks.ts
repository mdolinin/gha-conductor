import {
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

const transform = getTransformStream();
transform.pipe(pino.destination(1));
const log = pino(
    {
        name: "gha-checks",
    },
    transform
);

export class GhaChecks {

    async createNewRun(pipelineName: any, pull_request: (PullRequest & {
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
    }) | (PullRequest & { state: "open"; closed_at: null; merged_at: null; merged: boolean; merged_by: null })) {
        const {headSha, checkName} = this.parseHeadShaFromJobName(pipelineName);
        if (headSha) {
            await gha_workflow_runs(db).insert({
                name: checkName,
                head_sha: headSha,
                pipeline_run_name: pipelineName,
                pr_number: pull_request.number,
            });
        } else {
            log.error("Failed to parse head sha from pipeline name " + pipelineName);
        }
    }

    async createPRCheckNoPipelinesTriggered(octokit: InstanceType<typeof ProbotOctokit>, pull_request: (PullRequest & {
        state: "closed"; closed_at: string; merged: boolean
    }) | PullRequest | (PullRequest & {
        closed_at: null; merged_at: null; draft: true; merged: false; merged_by: null
    }) | (PullRequest & {
        state: "open";
        closed_at: null;
        merged_at: null;
        merge_commit_sha: null;
        active_lock_reason: null;
        merged_by: null
    }) | (PullRequest & {
        state: "open"; closed_at: null; merged_at: null; draft: false; merged: boolean; merged_by: null
    }) | (PullRequest & {
        state: "open"; closed_at: null; merged_at: null; merged: boolean; merged_by: null
    })) {
        if (!pull_request.merged && pull_request.state !== "closed") {
            log.info(`Creating pr-status check for ${pull_request.base.repo.owner.login}/${pull_request.base.repo.name}#${pull_request.number}`);
            const params: RestEndpointMethodTypes["checks"]["create"]["parameters"] = {
                owner: pull_request.base.repo.owner.login,
                repo: pull_request.base.repo.name,
                name: "pr-status",
                head_sha: pull_request.head.sha,
                status: "completed",
                conclusion: "success",
                completed_at: new Date().toISOString(),
                output: {
                    title: "No pipelines to run",
                    summary: "No pipelines to run"
                }
            };
            const resp = await octokit.checks.create(params);
            const checkRunId = resp.data.id;
            if (resp.status === 201) {
                log.info(`Pr-status check with id ${checkRunId} for PR #${pull_request.number} created`);
            } else {
                log.error("Failed to create pr-status check for PR #" + pull_request.number);
            }
        }
    }

    async createPRCheckForTriggeredPipelines(octokit: InstanceType<typeof ProbotOctokit>, pull_request: (PullRequest & {
        state: "closed"; closed_at: string; merged: boolean
    }) | PullRequest | (PullRequest & {
        closed_at: null; merged_at: null; draft: true; merged: false; merged_by: null
    }) | (PullRequest & {
        state: "open";
        closed_at: null;
        merged_at: null;
        merge_commit_sha: null;
        active_lock_reason: null;
        merged_by: null
    }) | (PullRequest & {
        state: "open"; closed_at: null; merged_at: null; draft: false; merged: boolean; merged_by: null
    }) | (PullRequest & { state: "open"; closed_at: null; merged_at: null; merged: boolean; merged_by: null })) {
        if (!pull_request.merged && pull_request.state !== "closed") {
            log.info(`Creating pr-status check for ${pull_request.base.repo.owner.login}/${pull_request.base.repo.name}#${pull_request.number}`);
            const params: RestEndpointMethodTypes["checks"]["create"]["parameters"] = {
                owner: pull_request.base.repo.owner.login,
                repo: pull_request.base.repo.name,
                name: "pr-status",
                head_sha: pull_request.head.sha,
                status: "queued",
                started_at: new Date().toISOString()
            };
            const resp = await octokit.checks.create(params);
            const checkRunId = resp.data.id;
            log.info(`Updating pr-status check with id ${checkRunId} for PR #${pull_request.number} in progress`);
            if (resp.status === 201) {
                await gha_workflow_runs(db).update({pr_number: pull_request.number, pr_status_check_id: null}, {
                    pr_status_check_id: checkRunId
                });
            }
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
        const knownWorkflowRuns = await gha_workflow_runs(db).count({pipeline_run_name: workflowJob.name});
        if (knownWorkflowRuns === 0) {
            log.warn(`Workflow run ${workflowJob.name} is not exist in db`);
        } else {
            const {headSha, checkName} = this.parseHeadShaFromJobName(workflowJob.name);
            let params: RestEndpointMethodTypes["checks"]["create"]["parameters"] = {
                owner: payload.repository.owner.login,
                repo: payload.repository.name,
                name: checkName,
                head_sha: headSha,
                details_url: `https://github.com/${payload.repository.full_name}/actions/runs/${workflowJob.run_id}`,
                status: "queued",
                started_at: new Date().toISOString(),
            };
            const resp = await octokit.checks.create(params);
            if (resp.status === 201) {
                const check = resp.data;
                // update workflow run in db
                await gha_workflow_runs(db).update({pipeline_run_name: workflowJob.name, workflow_job_id: null}, {
                    workflow_run_id: workflow_run_id,
                    workflow_job_id: workflowJob.id,
                    status: check.status,
                    check_run_id: check.id
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
                    title: "Pipelines in progress",
                    summary: "Pipelines are running"
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
                    title: "Pipelines completed",
                    summary: "Pipelines completed"
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
            const params: RestEndpointMethodTypes["checks"]["update"]["parameters"] = {
                owner: payload.repository.owner.login,
                repo: payload.repository.name,
                check_run_id: workflowRun.pr_status_check_id?.toString(),
                status: "in_progress",
                output: {
                    title: "Pipelines in progress",
                    summary: "Pipelines are running"
                }
            };
            const resp = await octokit.checks.update(params);
            if (resp.status === 200) {
                log.info(`Updating pr-status check with id ${workflowRun.pr_status_check_id} for PR #${workflowRun.pr_number}` + " in progress");
            } else {
                log.error("Failed to update pr-status check with id " + workflowRun.pr_status_check_id + " for PR #" + workflowRun.pr_number + " in progress");
            }
        }
    }

    async updatePRStatusCheckCompleted(octokit: InstanceType<typeof ProbotOctokit>, payload: WorkflowJobCompletedEvent) {
        // find all workflow runs for this with same workflow_job_id
        const workflowJob = payload.workflow_job;
        const workflowRun = await gha_workflow_runs(db).findOne({
            pipeline_run_name: workflowJob.name,
            pr_status_conclusion: null
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
            pr_status_conclusion: null
        }).all();
        if (allPRWorkflowRuns.length === 0) {
            log.warn(`No workflow runs for pr #${prNumber} found with pr_status_conclusion is null in db`);
        } else {
            const finished = allPRWorkflowRuns.every((run) => run.status === "completed");
            if (finished) {
                log.info("All jobs finished for pr #" + allPRWorkflowRuns[0].pr_number);
                const conclusion = this.getConclusion(allPRWorkflowRuns);
                const params: RestEndpointMethodTypes["checks"]["update"]["parameters"] = {
                    owner: payload.repository.owner.login,
                    repo: payload.repository.name,
                    check_run_id: allPRWorkflowRuns[0].pr_status_check_id?.toString(),
                    status: "completed",
                    conclusion: conclusion,
                    completed_at: new Date().toISOString(),
                    output: {
                        title: "All pipelines completed",
                        summary: "All pipelines completed"
                    }
                };
                const resp = await octokit.checks.update(params);
                if (resp.status === 200) {
                    log.info(`Updating pr-status check with id ${allPRWorkflowRuns[0].pr_status_check_id} for PR #${allPRWorkflowRuns[0].pr_number}` + " completed");
                    await gha_workflow_runs(db).update({pr_status_check_id: allPRWorkflowRuns[0].pr_status_check_id}, {
                        pr_status_conclusion: conclusion,
                    });
                } else {
                    log.error("Failed to update pr-status check with id " + allPRWorkflowRuns[0].pr_status_check_id + " for PR #" + allPRWorkflowRuns[0].pr_number + " completed");
                }
            } else {
                log.info("Some jobs not finished for pr #" + allPRWorkflowRuns[0].pr_number);
            }
        }
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
}