import {
    CheckRunRerequestedEvent,
    WorkflowJobCompletedEvent,
    WorkflowJobInProgressEvent,
    WorkflowJobQueuedEvent
} from "@octokit/webhooks-types";
import {Logger, ProbotOctokit} from "probot";
import {
    RestEndpointMethodTypes
} from "@octokit/plugin-rest-endpoint-methods/dist-types/generated/parameters-and-response-types.js";
import db, {gha_workflow_runs} from "./db/database.js";
import {GhaWorkflowRuns} from "./__generated__/index.js";
import {anyOf, not} from "@databases/pg-typed";
import {TriggeredWorkflow} from "./hooks.js";

export const GITHUB_CHECK_BYTESIZE_LIMIT = 65535;
const ansiPattern = [
    '[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)',
    '(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))'
].join('|');
const ansiRegex = new RegExp(ansiPattern, 'g');

export enum PRCheckName {
    PRStatus = "pr-status",
    PRMerge = "pr-merge",
    PRClose = "pr-close",
    PRSlashCommand = "pr-slash-command"
}

export enum PRCheckAction {
    ReRun = "re-run",
    ReRunFailed = "re-run-failed",
    SyncStatus = "sync-status"
}

export interface ReRunPayload {
    owner: string,
    repo: string,
    check_run_id: number,
    requested_action_identifier: PRCheckAction
}

export interface SyncStatusPayload {
    owner: string,
    repo: string,
    check_run_id: number
}

export class GhaChecks {

    log: Logger;

    constructor(log: Logger) {
        this.log = log;
    }

    private hookToCheckName(hookType: "onBranchMerge" | "onPullRequest" | "onPullRequestClose" | "onSlashCommand") {
        switch (hookType) {
            case "onPullRequest":
                return PRCheckName.PRStatus;
            case "onBranchMerge":
                return PRCheckName.PRMerge;
            case "onPullRequestClose":
                return PRCheckName.PRClose;
            case "onSlashCommand":
                return PRCheckName.PRSlashCommand;
        }
    }

    async createPRCheck(octokit: InstanceType<typeof ProbotOctokit>, pull_request: {
        number: number;
        head: { sha: string };
        base: { repo: { name: string; owner: { login: string } } }
    }, hookType: "onBranchMerge" | "onPullRequest" | "onPullRequestClose" | "onSlashCommand", merge_commit_sha: string) {
        const checkName = this.hookToCheckName(hookType);
        this.log.info(`Creating ${checkName} check for ${pull_request.base.repo.owner.login}/${pull_request.base.repo.name}#${pull_request.number}`);
        const sha = hookType === "onBranchMerge" ? merge_commit_sha : pull_request.head.sha;
        const params: RestEndpointMethodTypes["checks"]["create"]["parameters"] = {
            owner: pull_request.base.repo.owner.login,
            repo: pull_request.base.repo.name,
            name: checkName,
            head_sha: sha,
            status: "queued",
            started_at: new Date().toISOString(),
            output: {
                title: "Processing hooks",
                summary: `Processing hooks for ${hookType} to determine workflows to run`
            }
        }
        let checkRunUrl = `https://github.com/${pull_request.base.repo.owner.login}/${pull_request.base.repo.name}/pull/${pull_request.number}/checks`;
        let checkRunId = 0;
        try {
            const resp = await octokit.checks.create(params);
            checkRunId = resp.data.id;
            checkRunUrl = `${checkRunUrl}?check_run_id=${checkRunId}`
            this.log.info(`${checkName} check with id ${checkRunId} for PR #${pull_request.number} created`);
        } catch (error) {
            this.log.error(error, `Failed to create ${checkName} check for PR #${pull_request.number}`);
        }
        return {checkRunId, checkName, checkRunUrl, hookType};
    }

    async createWorkflowRunCheckErrored(octokit: InstanceType<typeof ProbotOctokit>, pull_request: {
        number: number;
        head: { sha: string };
        base: { repo: { name: string; owner: { login: string } } }
    }, hookType: "onBranchMerge" | "onPullRequest" | "onPullRequestClose" | "onSlashCommand", merge_commit_sha: string, erroredWorkflow: TriggeredWorkflow) {
        const {checkName} = this.parseHeadShaFromJobName(erroredWorkflow.name);
        this.log.info(`Creating ${checkName} check for ${pull_request.base.repo.owner.login}/${pull_request.base.repo.name}#${pull_request.number}`);
        const sha = hookType === "onBranchMerge" ? merge_commit_sha : pull_request.head.sha;
        const summary = `<details><summary>❌: ${checkName}</summary><p>\n` +
            `\n` +
            `\n` +
            `### Error\n` +
            `\n` +
            `\`\`\`console\n` +
            `${erroredWorkflow.error}\n` +
            `\`\`\`\n` +
            `\n` +
            `\n` +
            `### Workflow run arguments\n` +
            `\n` +
            `\`\`\`json\n` +
            `\n` +
            `${JSON.stringify(erroredWorkflow.inputs, null, 2)} \n` +
            `\n` +
            `\`\`\`\n` +
            `\n` +
            `</p>\n` +
            `</details>`;
        const params: RestEndpointMethodTypes["checks"]["create"]["parameters"] = {
            owner: pull_request.base.repo.owner.login,
            repo: pull_request.base.repo.name,
            name: checkName,
            head_sha: sha,
            status: "completed",
            conclusion: "failure",
            completed_at: new Date().toISOString(),
            output: {
                title: "Workflow run errored",
                summary: summary
            }
        };
        try {
            const resp = await octokit.checks.create(params);
            const check = resp.data;
            // update workflow run in db
            await gha_workflow_runs(db).update({pipeline_run_name: erroredWorkflow.name, workflow_job_id: null}, {
                status: check.status,
                check_run_id: check.id,
                workflow_run_url: `https://github.com/${pull_request.base.repo.owner.login}/${pull_request.base.repo.name}/pull/${pull_request.number}/checks?check_run_id=${check.id}`
            });
        } catch (error) {
            this.log.error(error, `Failed to create ${checkName} check for PR #${pull_request.number}`);
        }
    }

    async updatePRCheckNoPipelinesTriggered(octokit: InstanceType<typeof ProbotOctokit>, pull_request: {
        number: number,
        head: { sha: string },
        base: {
            repo: {
                name: string,
                owner: { login: string }
            },
        },
    }, prCheck: {
        checkRunId: number;
        checkName: string,
        checkRunUrl: string,
        hookType: "onBranchMerge" | "onPullRequest" | "onPullRequestClose" | "onSlashCommand"
    }) {
        this.log.info(`Update ${prCheck.checkName} check for ${pull_request.base.repo.owner.login}/${pull_request.base.repo.name}#${pull_request.number}`);
        const params: RestEndpointMethodTypes["checks"]["update"]["parameters"] = {
            owner: pull_request.base.repo.owner.login,
            repo: pull_request.base.repo.name,
            check_run_id: Number(prCheck.checkRunId),
            status: "completed",
            conclusion: "success",
            completed_at: new Date().toISOString(),
            output: {
                title: "No workflows to run",
                summary: `No workflows to run for hook ${prCheck.hookType}`
            }
        };
        try {
            const resp = await octokit.checks.update(params);
            const checkRunId = resp.data.id;
            this.log.info(`${prCheck.checkName} check with id ${checkRunId} for PR #${pull_request.number} created`);
        } catch (error) {
            this.log.error(error, `Failed to create ${prCheck.checkName} check for PR #${pull_request.number}`);
        }
        return prCheck.checkRunUrl;
    }

    async updatePRCheckWithAnnotations(octokit: InstanceType<typeof ProbotOctokit>, pull_request: {
        number: number;
        head: { sha: string };
        base: { repo: { name: string; owner: { login: string } } }
    }, prCheck: { checkRunId: number; checkName: string, checkRunUrl: string }, annotationsForCheck: {
        annotation_level: "failure" | "notice" | "warning";
        message: string;
        path: string;
        start_line: number;
        end_line: number
    }[]) {
        this.log.info(`Update  ${prCheck.checkName} check for ${pull_request.base.repo.owner.login}/${pull_request.base.repo.name}#${pull_request.number}`);
        const params: RestEndpointMethodTypes["checks"]["update"]["parameters"] = {
            owner: pull_request.base.repo.owner.login,
            repo: pull_request.base.repo.name,
            check_run_id: Number(prCheck.checkRunId),
            status: "completed",
            conclusion: "failure",
            completed_at: new Date().toISOString(),
            output: {
                title: "Issues found in .gha.yml files",
                summary: "Issues found in .gha.yml files",
                annotations: annotationsForCheck,
            }
        };
        try {
            const resp = await octokit.checks.update(params);
            const checkRunId = resp.data.id;
            this.log.info(`${prCheck.checkName} check with id ${checkRunId} for PR #${pull_request.number} created`);
        } catch (error) {
            this.log.error(error, `Failed to create ${prCheck.checkName} check for PR #${pull_request.number}`);
        }
        return prCheck.checkRunUrl;
    }

    async updatePRCheckForAllErroredPipelines(octokit: InstanceType<typeof ProbotOctokit>, pull_request: {
        number: number;
        head: { sha: string };
        base: { repo: { name: string; owner: { login: string } } }
    }, prCheck: {
        checkRunId: number;
        checkName: string,
        checkRunUrl: string,
        hookType: "onBranchMerge" | "onPullRequest" | "onPullRequestClose" | "onSlashCommand"
    }, erroredWorkflows: TriggeredWorkflow[]) {
        this.log.info(`Update ${prCheck.checkName} check for ${pull_request.base.repo.owner.login}/${pull_request.base.repo.name}#${pull_request.number}`);
        let summary = "❌Errored workflows:\n"
        for (const triggeredWorkflow of erroredWorkflows) {
            summary += `## ${triggeredWorkflow.name}\n` +
                '\n' +
                '\n' +
                `### Error\n` +
                `\n` +
                `\`\`\`console\n` +
                `${triggeredWorkflow.error}\n` +
                `\`\`\`\n` +
                `\n` +
                `\n` +
                `### Workflow run arguments\n` +
                `\n` +
                `\`\`\`json\n` +
                `\n` +
                `${JSON.stringify(triggeredWorkflow.inputs, null, 2)} \n` +
                `\n` +
                `\`\`\`\n` +
                `\n` +
                `\n`;

        }
        const params: RestEndpointMethodTypes["checks"]["update"]["parameters"] = {
            owner: pull_request.base.repo.owner.login,
            repo: pull_request.base.repo.name,
            check_run_id: Number(prCheck.checkRunId),
            status: "completed",
            conclusion: "failure",
            completed_at: new Date().toISOString(),
            output: {
                title: "All workflows errored. Nothing to do",
                summary: summary
            }
        };
        try {
            const resp = await octokit.checks.update(params);
            const checkRunId = resp.data.id;
            this.log.info(`${prCheck.checkName} check with id ${checkRunId} for PR #${pull_request.number} created`);
            await gha_workflow_runs(db).update({
                pr_number: pull_request.number,
                pr_check_id: checkRunId,
                hook: prCheck.hookType
            }, {
                pr_conclusion: "failure"
            });
        } catch (error) {
            this.log.error(error, `Failed to create ${prCheck.checkName} check for PR #${pull_request.number}`);
        }
        return prCheck.checkRunUrl;
    }

    async updatePRCheckForTriggeredPipelines(octokit: InstanceType<typeof ProbotOctokit>, pull_request: {
        number: number,
        head: { sha: string },
        base: {
            repo: {
                name: string,
                owner: { login: string }
            },
        },
    }, prCheck: {
        checkRunId: number;
        checkName: string,
        checkRunUrl: string,
        hookType: "onBranchMerge" | "onPullRequest" | "onPullRequestClose" | "onSlashCommand"
    }) {
        this.log.info(`Update ${prCheck.checkName} check for ${pull_request.base.repo.owner.login}/${pull_request.base.repo.name}#${pull_request.number}`);
        const workflowRuns = await gha_workflow_runs(db).find({
            pr_number: pull_request.number,
            pr_check_id: prCheck.checkRunId,
            hook: prCheck.hookType
        }).all();
        const summary = await this.formatGHCheckSummaryAll(octokit, pull_request.base.repo.owner.login, pull_request.base.repo.name, workflowRuns);
        const params: RestEndpointMethodTypes["checks"]["update"]["parameters"] = {
            owner: pull_request.base.repo.owner.login,
            repo: pull_request.base.repo.name,
            check_run_id: Number(prCheck.checkRunId),
            status: "queued",
            output: {
                title: "Workflow runs are queued",
                summary: summary
            },
            actions: this.getAvailableActions()
        };
        try {
            const resp = await octokit.checks.update(params);
            const checkRunId = resp.data.id;
            this.log.info(`Updated ${prCheck.checkName} check with id ${checkRunId} for PR #${pull_request.number} in progress`);
        } catch (error) {
            this.log.error(error, `Failed to create ${prCheck.checkName} check for PR #${pull_request.number}`);
        }
        return prCheck.checkRunUrl;
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
            this.log.warn(`Workflow run ${workflowJob.name} is not exist in db`);
        } else {
            const {headSha, checkName} = this.parseHeadShaFromJobName(workflowJob.name);
            if (!headSha) {
                this.log.error("Failed to parse head sha from pipeline name " + workflowJob.name);
                return;
            }
            const sha = knownWorkflowRuns[0].hook === "onBranchMerge" ? knownWorkflowRuns[0].merge_commit_sha : headSha;
            const summary = await this.formatGHCheckSummaryAll(octokit, payload.repository.owner.login, payload.repository.name, knownWorkflowRuns);
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
            try {
                const resp = await octokit.checks.create(params);
                const check = resp.data;
                // update workflow run in db
                await gha_workflow_runs(db).update({pipeline_run_name: workflowJob.name, workflow_job_id: null}, {
                    workflow_run_id: workflow_run_id,
                    workflow_job_id: workflowJob.id,
                    status: check.status,
                    check_run_id: check.id,
                    workflow_run_url: check.details_url
                });
            } catch (error) {
                this.log.error(error, `Failed to create ${checkName} check for workflow run ${workflowJob.name} as queued`);
            }
        }
    }

    /**
     * Updates a GitHub check for a workflow run with current status and logs
     * @param octokit GitHub API client
     * @param owner Repository owner
     * @param repo Repository name
     * @param workflowRun The workflow run data
     * @param status Current workflow status
     * @param conclusion Current workflow conclusion
     * @returns Promise resolving when the check is updated
     */
    async updateWorkflowRunCheck(
        octokit: InstanceType<typeof ProbotOctokit>,
        owner: string,
        repo: string,
        workflowRun: GhaWorkflowRuns,
        status: string | null,
        conclusion: string | null
    ) {
        if (!workflowRun.check_run_id) {
            this.log.warn(`Check run id is not exist for workflow run ${workflowRun.pipeline_run_name}`);
            return;
        }
        if (status === null || status !== "completed" && status !== "in_progress" && status !== "queued") {
            this.log.warn(`${status} is not valid for workflow run ${workflowRun.pipeline_run_name}`);
            return;
        }

        let summary: string;

        if (status === "completed") {
            const textEncoder = new TextEncoder();
            const summaryWithoutLogs = this.formatGHCheckSummary(workflowRun, conclusion || "", status, "-");
            const summaryWithoutLogsByteSize = textEncoder.encode(summaryWithoutLogs).length;

            if (summaryWithoutLogsByteSize >= GITHUB_CHECK_BYTESIZE_LIMIT) {
                summary = `${this.getWorkflowStatusIcon(conclusion || "", status)}: **[${workflowRun.pipeline_run_name}](${workflowRun.workflow_run_url})**`;
            } else {
                const logMaxBytesize = GITHUB_CHECK_BYTESIZE_LIMIT - summaryWithoutLogsByteSize;
                const workflowJobLog = workflowRun.workflow_job_id ?
                    await this.getWorkflowJobLog(octokit, owner, repo, workflowRun.workflow_job_id, logMaxBytesize) :
                    null;
                summary = this.formatGHCheckSummary(workflowRun, conclusion || "", status, workflowJobLog);
            }
        } else {
            summary = this.formatGHCheckSummary(workflowRun, conclusion || "", status, null);
        }

        const checkParams: RestEndpointMethodTypes["checks"]["update"]["parameters"] = {
            owner: owner,
            repo: repo,
            check_run_id: Number(workflowRun.check_run_id),
            status: status,
            output: {
                title: status === "completed" ? "Workflow run completed" :
                    status === "in_progress" ? "Workflow run in progress" :
                        "Workflow run queued",
                summary: summary
            }
        };

        if (status === "completed" && conclusion) {
            if (!["success", "failure", "neutral", "cancelled", "skipped", "timed_out", "action_required"].includes(conclusion)) {
                this.log.warn(`${conclusion} is not valid for workflow run ${workflowRun.pipeline_run_name}`);
                return;
            }
            checkParams.conclusion = conclusion as "success" | "failure" | "neutral" | "cancelled" | "skipped" | "timed_out" | "action_required";
            checkParams.completed_at = new Date().toISOString();
        }

        try {
            const resp = await octokit.checks.update(checkParams);

            // Update workflow run in db
            await gha_workflow_runs(db).update({
                pipeline_run_name: workflowRun.pipeline_run_name,
                check_run_id: workflowRun.check_run_id
            }, {
                status: status,
                conclusion: conclusion,
            });

            this.log.info(`Updated check run with id ${workflowRun.check_run_id} for workflow run ${workflowRun.pipeline_run_name}`);
            return resp.data;
        } catch (error) {
            this.log.error(error, `Failed to update check run with id ${workflowRun.check_run_id} for workflow run ${workflowRun.pipeline_run_name}`);
            return;
        }
    }

    async updateWorkflowRunCheckInProgress(octokit: InstanceType<typeof ProbotOctokit>, payload: WorkflowJobInProgressEvent) {
        const workflowJob = payload.workflow_job;
        const workflowRun = await gha_workflow_runs(db).findOne({
            pipeline_run_name: workflowJob.name,
            workflow_job_id: workflowJob.id,
            conclusion: null
        });

        if (!workflowRun) {
            this.log.warn(`Workflow run ${workflowJob.name} is not exist in db`);
        } else {
            await this.updateWorkflowRunCheck(
                octokit,
                payload.repository.owner.login,
                payload.repository.name,
                workflowRun,
                "in_progress",
                null
            );
        }
    }

    async updateWorkflowRunCheckCompleted(octokit: InstanceType<typeof ProbotOctokit>, payload: WorkflowJobCompletedEvent) {
        const workflowJob = payload.workflow_job;
        const workflowRun = await gha_workflow_runs(db).findOne({
            pipeline_run_name: workflowJob.name,
            workflow_job_id: workflowJob.id,
            conclusion: null
        });

        if (!workflowRun) {
            this.log.warn(`Workflow run ${workflowJob.name} is not exist in db`);
        } else {
            await this.updateWorkflowRunCheck(
                octokit,
                payload.repository.owner.login,
                payload.repository.name,
                workflowRun,
                "completed",
                payload.workflow_job.conclusion
            );
        }
    }

    async updatePRStatusCheckInProgress(octokit: InstanceType<typeof ProbotOctokit>, payload: WorkflowJobInProgressEvent) {
        // find pr_status check run id in db
        const workflowJob = payload.workflow_job;
        const workflowRun = await gha_workflow_runs(db).findOne({
            pipeline_run_name: workflowJob.name,
            workflow_job_id: workflowJob.id,
            conclusion: null
        });
        // update pr_status check run
        if (!workflowRun) {
            this.log.warn(`Workflow run ${workflowJob.name} is not exist in db`);
        } else {
            const allPRWorkflowRuns = await gha_workflow_runs(db).find({
                pr_number: workflowRun.pr_number,
                hook: workflowRun.hook,
                pr_check_id: workflowRun.pr_check_id,
                pr_conclusion: null
            }).all();
            const summary = await this.formatGHCheckSummaryAll(octokit, payload.repository.owner.login, payload.repository.name, allPRWorkflowRuns, "in_progress");
            const params: RestEndpointMethodTypes["checks"]["update"]["parameters"] = {
                owner: payload.repository.owner.login,
                repo: payload.repository.name,
                check_run_id: Number(workflowRun.pr_check_id),
                status: "in_progress",
                output: {
                    title: "Workflow runs in progress",
                    summary: summary
                },
                actions: this.getAvailableActions()
            };
            try {
                await octokit.checks.update(params);
                this.log.info(`Updating pr-status check with id ${workflowRun.pr_check_id} for PR #${workflowRun.pr_number}` + " in progress");
            } catch (error) {
                this.log.error(error, `Failed to update pr-status check with id ${workflowRun.pr_check_id} for PR #${workflowRun.pr_number} in progress`);
            }
        }
    }

    private stripAnsi(text: string) {
        return text.replace(ansiRegex, '');
    }

    private truncateStringToByteLength(str: string, maxLengthBytes: number): string {
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();
        const bytes = encoder.encode(str);
        if (bytes.length <= maxLengthBytes) {
            return str; // No need to truncate
        }
        const truncatedBytes = bytes.slice(bytes.length - maxLengthBytes);
        return decoder.decode(truncatedBytes).replace(/\uFFFD/g, "");
    }

    private async getWorkflowJobLog(octokit: InstanceType<typeof ProbotOctokit>, owner: string, repo: string, jobId: number, logMaxBytesize: number) {
        let workflowJobLog = null;
        try {
            const workflowJobLogResp = await octokit.actions.downloadJobLogsForWorkflowRun({
                owner: owner,
                repo: repo,
                job_id: Number(jobId)
            });
            const data = String(workflowJobLogResp.data);
            workflowJobLog = this.truncateStringToByteLength(data, logMaxBytesize);
        } catch (error) {
            this.log.warn(`Failed to get workflow job log for ${jobId} with`, error);
        }
        if (workflowJobLog === null) {
            return null;
        }
        return this.stripAnsi(workflowJobLog);
    }

    private formatGHCheckSummary(workflow: GhaWorkflowRuns, conclusion: string, status: string, log: string | null) {
        const workflowRunStatusIcon = this.getWorkflowStatusIcon(conclusion, status);
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
            `${JSON.stringify(workflow.workflow_run_inputs, null, 2)} \n` +
            `\n` +
            `\`\`\`\n` +
            `\n` +
            `</p>\n` +
            `</details>`;
        return summary;
    }

    private getWorkflowStatusIcon(conclusion: string, status: string) {
        if (conclusion === "failure") {
            return "❌";
        } else if (conclusion === "success") {
            return "✅";
        } else if (status === "in_progress") {
            return "\uD83D\uDD04";
        } else {
            return "⏸️";
        }
    }

    async formatGHCheckSummaryAll(octokit: InstanceType<typeof ProbotOctokit>, owner: string, repo: string, workflowRuns: GhaWorkflowRuns[], status: string = "") {
        let summaryWithoutLogs = ""
        for (const workflowRun of workflowRuns) {
            const workflowRunConclusion = workflowRun.conclusion ? workflowRun.conclusion : "";
            const workflowRunStatus = workflowRun.status ? workflowRun.status : status;
            summaryWithoutLogs += this.formatGHCheckSummary(workflowRun, workflowRunConclusion, workflowRunStatus, "-");
            summaryWithoutLogs += "\n";
        }
        const textEncoder = new TextEncoder();
        const summaryWithoutLogsByteSize = textEncoder.encode(summaryWithoutLogs).length;
        if (summaryWithoutLogsByteSize >= GITHUB_CHECK_BYTESIZE_LIMIT) {
            // create simplified summary
            let summary = "";
            for (const workflowRun of workflowRuns) {
                const workflowRunConclusion = workflowRun.conclusion ? workflowRun.conclusion : "";
                const workflowRunStatus = workflowRun.status ? workflowRun.status : status;
                const workflowRunStatusIcon = this.getWorkflowStatusIcon(workflowRunConclusion, workflowRunStatus);
                summary += `${workflowRunStatusIcon}: **[${workflowRun.name}](${workflowRun.workflow_run_url})**\n`;
            }
            const summaryByteSize = textEncoder.encode(summary).length;
            if (summaryByteSize >= GITHUB_CHECK_BYTESIZE_LIMIT) {
                return this.truncateStringToByteLength(summary, GITHUB_CHECK_BYTESIZE_LIMIT);
            }
            return summary;
        }
        let summary = "";
        let logMaxBytesize = GITHUB_CHECK_BYTESIZE_LIMIT - summaryWithoutLogsByteSize;
        if (workflowRuns.length > 0) {
            logMaxBytesize = Math.floor(logMaxBytesize / workflowRuns.length);
        }
        for (const workflowRun of workflowRuns) {
            const workflowRunConclusion = workflowRun.conclusion ? workflowRun.conclusion : "";
            const workflowRunStatus = workflowRun.status ? workflowRun.status : status;
            let workflowJobLog: string | null = null;
            if (workflowRun.workflow_job_id !== null && logMaxBytesize > 0) {
                workflowJobLog = await this.getWorkflowJobLog(octokit, owner, repo, workflowRun.workflow_job_id, logMaxBytesize);
            }
            summary += this.formatGHCheckSummary(workflowRun, workflowRunConclusion, workflowRunStatus, workflowJobLog);
            summary += "\n";
        }
        return summary;
    }

    async updatePRStatusCheckCompleted(octokit: InstanceType<typeof ProbotOctokit>, payload: WorkflowJobCompletedEvent) {
        // find all workflow runs for this with same workflow_job_id
        const workflowJob = payload.workflow_job;
        const workflowRun = await gha_workflow_runs(db).findOne({
            pipeline_run_name: workflowJob.name,
            workflow_job_id: workflowJob.id,
            pr_conclusion: null
        });
        if (!workflowRun) {
            this.log.warn(`Workflow run ${workflowJob.name} is not exist in db`);
            return;
        }
        const prNumber = workflowRun.pr_number;
        const prCheckId = workflowRun.pr_check_id;
        if (prNumber === null) {
            this.log.warn(`Workflow run ${workflowJob.name} does not have pr_number`);
            return;
        }
        if (prCheckId === null) {
            this.log.warn(`Workflow run ${workflowJob.name} does not have pr_check_id`);
            return;
        }
        const allPRWorkflowRuns = await gha_workflow_runs(db).find({
            pr_number: prNumber,
            pr_check_id: prCheckId,
            pr_conclusion: null
        }).all();
        if (allPRWorkflowRuns.length === 0) {
            this.log.warn(`No workflow runs for ${payload.repository.full_name} pr #${prNumber} found with pr_check_id ${prCheckId} and pr_status_conclusion is null in db`);
        } else {
            const finished = allPRWorkflowRuns.every((run) => run.status === "completed");
            if (finished) {
                this.log.info("All jobs finished for pr #" + prNumber);
                const conclusion = this.getConclusion(allPRWorkflowRuns);
                const actions = this.getAvailableActions(conclusion);
                const owner = payload.repository.owner.login;
                const repo = payload.repository.name;
                const summary = await this.formatGHCheckSummaryAll(octokit, owner, repo, allPRWorkflowRuns, "completed");
                const prCheckId = allPRWorkflowRuns[0].pr_check_id;
                if (!prCheckId) {
                    this.log.warn(`Check run id is not exist for workflow run ${workflowJob.name}`);
                    return;
                }
                const params: RestEndpointMethodTypes["checks"]["update"]["parameters"] = {
                    owner: owner,
                    repo: repo,
                    check_run_id: Number(prCheckId),
                    status: "completed",
                    conclusion: conclusion,
                    completed_at: new Date().toISOString(),
                    output: {
                        title: "All workflow runs completed",
                        summary: summary
                    },
                    actions: actions
                };
                try {
                    await octokit.checks.update(params);
                    this.log.info(`Updating pr-status check with id ${prCheckId} for PR #${prNumber}` + " completed");
                    await gha_workflow_runs(db).update({pr_check_id: prCheckId}, {
                        pr_conclusion: conclusion,
                    });
                    await this.createPRCommentWithCheckUrlAfterMergeIfFailed(octokit, owner, repo, prNumber, allPRWorkflowRuns[0], conclusion, summary);
                } catch (error) {
                    this.log.error(error, "Failed to update pr-status check with id " + prCheckId + " for PR #" + prNumber + "as completed");
                }
            } else {
                this.log.info("Some jobs not finished for pr #" + prNumber);
            }
        }
    }

    private async createPRCommentWithCheckUrlAfterMergeIfFailed(octokit: InstanceType<typeof ProbotOctokit>, owner: string, repo: string, prNumber: number, prWorkflowRuns: GhaWorkflowRuns, conclusion: string, summary: string) {
        if (conclusion === "success") {
            return;
        }
        if (prWorkflowRuns.hook !== "onBranchMerge") {
            return;
        }
        const checkName = this.hookToCheckName(prWorkflowRuns.hook);
        const checkRunUrl = `https://github.com/${owner}/${repo}/runs/${prWorkflowRuns.pr_check_id}`
        const prComment = `# ${checkName} completed with ${conclusion}\n` +
            `**[Check run](${checkRunUrl})**\n` +
            `${summary}`;
        try {
            await octokit.issues.createComment({
                owner: owner,
                repo: repo,
                issue_number: prNumber,
                body: prComment
            });
        } catch (error) {
            this.log.error(error, `Failed to create comment for PR #${prNumber}`);
        }
    }

    private getAvailableActions(conclusion: string = "") {
        const syncStatusAction = {
            label: "Sync status",
            description: "Sync current workflow status",
            identifier: PRCheckAction.SyncStatus
        };
        // if no conclusion, then only sync status is available
        if (conclusion === "") {
            return [syncStatusAction];
        } else {
            const reRunAction = {
                label: "Re-run",
                description: "Re-run all workflows",
                identifier: PRCheckAction.ReRun
            };
            const actions = [
                reRunAction,
                syncStatusAction
            ];
            if (conclusion !== "success") {
                actions.push({
                    label: "Re-run failed",
                    description: "Re-run failed workflows",
                    identifier: PRCheckAction.ReRunFailed
                });
            }
            return actions;
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

    private getStatus(workflowRuns: GhaWorkflowRuns[]) {
        // get status from workflow runs
        // status values | "queued" | "in_progress" | "completed";
        if (workflowRuns.every((r) => r.status === "completed")) {
            return "completed";
        } else if (workflowRuns.some((r) => r.status === "in_progress")) {
            return "in_progress";
        } else {
            return "queued";
        }
    }

    async triggerReRunPRCheck(octokit: InstanceType<typeof ProbotOctokit>, payload: ReRunPayload) {
        let prRelatedWorkflowRuns: GhaWorkflowRuns[] = []
        const actionIdentifier = payload.requested_action_identifier;
        const checkId = payload.check_run_id;
        if (actionIdentifier === PRCheckAction.ReRun) {
            this.log.info(`Find all workflow runs that match check id ${checkId}`);
            prRelatedWorkflowRuns = await gha_workflow_runs(db).find({
                pr_check_id: checkId,
                pr_conclusion: not(null),
            }).all();
        } else if (actionIdentifier === PRCheckAction.ReRunFailed) {
            this.log.info(`Find all workflow runs that match check id ${checkId} and conclusion is not success`);
            prRelatedWorkflowRuns = await gha_workflow_runs(db).find({
                pr_check_id: checkId,
                pr_conclusion: not(null),
                conclusion: anyOf(["failure", "cancelled", "skipped", "action_required", "neutral", "stale", "timed_out"])
            }).all();
        }
        // find all workflow runs for this with same pr_check_id
        if (prRelatedWorkflowRuns.length === 0) {
            this.log.warn(`No workflow runs for check id ${checkId} found in db`);
        } else {
            const nothingToReRun = prRelatedWorkflowRuns.every((run) => run.workflow_run_id === null);
            if (nothingToReRun) {
                this.log.warn(`All workflow runs for check id ${checkId} does not have workflow_run_id, nothing to re-run`);
                return;
            }
            await this.cleanupPreviousResultFor(prRelatedWorkflowRuns);
            await this.reCreatePrCheck(prRelatedWorkflowRuns[0], octokit, checkId, payload.owner, payload.repo);
            await this.triggerReRunFor(prRelatedWorkflowRuns, octokit, payload.owner, payload.repo);
        }
    }

    private async reCreatePrCheck(prRelatedWorkflowRun: GhaWorkflowRuns, octokit: InstanceType<typeof ProbotOctokit>, pr_check_id: number, owner: string, repo: string) {
        const checkName = this.hookToCheckName(prRelatedWorkflowRun.hook);
        this.log.info(`Re-creating ${checkName} check for ${owner}/${repo}#${prRelatedWorkflowRun.pr_number}`);
        const sha = prRelatedWorkflowRun.hook === "onBranchMerge" ? prRelatedWorkflowRun.merge_commit_sha : prRelatedWorkflowRun.head_sha;
        const params: RestEndpointMethodTypes["checks"]["create"]["parameters"] = {
            owner: owner,
            repo: repo,
            name: checkName,
            head_sha: sha,
            status: "queued",
            started_at: new Date().toISOString(),
            output: {
                title: "Workflows re-run in progress",
                summary: "All workflows that belong to this check are re-run",
            },
            actions: this.getAvailableActions(),
        };
        try {
            const resp = await octokit.checks.create(params);
            const newPRcheckRunId = resp.data.id;
            this.log.info(`${checkName} check with id ${newPRcheckRunId} for PR #${prRelatedWorkflowRun.pr_number} created`);
            await gha_workflow_runs(db).update({pr_check_id: pr_check_id}, {
                pr_check_id: newPRcheckRunId,
                pr_conclusion: null
            });
        } catch (error) {
            this.log.error(error, `Failed to create ${checkName} check for PR #${prRelatedWorkflowRun.pr_number}`);
        }
    }

    private async triggerReRunFor(workflowRuns: GhaWorkflowRuns[], octokit: InstanceType<typeof ProbotOctokit>, owner: string, repo: string) {
        for (const workflowRun of workflowRuns) {
            if (workflowRun.workflow_run_id === null) {
                this.log.warn(`Workflow run ${workflowRun.pipeline_run_name} does not have workflow_run_id`);
                continue;
            }
            try {
                const params: RestEndpointMethodTypes["actions"]["reRunWorkflow"]["parameters"] = {
                    owner: owner,
                    repo: repo,
                    run_id: Number(workflowRun.workflow_run_id)
                };
                await octokit.actions.reRunWorkflow(params);
                this.log.info(`Re-run workflow ${workflowRun.pipeline_run_name} with id ${workflowRun.workflow_run_id} for PR #${workflowRun.pr_number} created`);
            } catch (error) {
                this.log.error(error, `Failed to re-run workflow ${workflowRun.pipeline_run_name} with id ${workflowRun.workflow_run_id} for PR #${workflowRun.pr_number}`);
            }
        }
    }

    private getTitleFrom(status: string) {
        if (status === "completed") {
            return "All workflow runs completed";
        } else if (status === "in_progress") {
            return "Workflow runs in progress";
        } else {
            return "Workflow runs are queued";
        }
    }

    async syncPRCheckStatus(octokit: InstanceType<typeof ProbotOctokit>, payload: SyncStatusPayload) {
        const checkId = payload.check_run_id;
        const owner = payload.owner;
        const repo = payload.repo;
        // Find all workflow runs associated with this check
        const prRelatedWorkflowRuns = await gha_workflow_runs(db).find({
            pr_check_id: checkId,
        }).all();

        if (prRelatedWorkflowRuns.length === 0) {
            this.log.warn(`No workflow runs for check id ${checkId} found in db`);
            return;
        }

        // Update status for each workflow run
        for (const workflowRun of prRelatedWorkflowRuns) {
            if (workflowRun.workflow_run_id) {
                try {
                    const response = await octokit.actions.getWorkflowRun({
                        owner: owner,
                        repo: repo,
                        run_id: Number(workflowRun.workflow_run_id)
                    });

                    const currentStatus = response.data.status;
                    const currentConclusion = response.data.conclusion;

                    // Update workflow run status in database
                    await gha_workflow_runs(db).update(
                        {workflow_run_id: workflowRun.workflow_run_id},
                        {
                            status: currentStatus,
                            conclusion: currentConclusion
                        }
                    );

                    // Update the individual check for this workflow run
                    if (workflowRun.check_run_id) {
                        await this.updateWorkflowRunCheck(
                            octokit,
                            owner,
                            repo,
                            workflowRun,
                            currentStatus,
                            currentConclusion
                        );
                    }
                } catch (error) {
                    this.log.error(error, `Failed to get current status for workflow run ${workflowRun.workflow_run_id}`);
                }
            }
        }

        // Refresh workflow runs data after updates
        const updatedWorkflowRuns = await gha_workflow_runs(db).find({
            pr_check_id: checkId,
        }).all();

        // Get current status for all workflow runs
        const status = this.getStatus(updatedWorkflowRuns);
        const conclusion = this.getConclusion(updatedWorkflowRuns);

        const title = this.getTitleFrom(status);
        const actions = this.getAvailableActions(conclusion);
        const summary = await this.formatGHCheckSummaryAll(octokit, owner, repo, updatedWorkflowRuns);

        // Update the check run with current status
        const params: RestEndpointMethodTypes["checks"]["update"]["parameters"] = {
            owner: owner,
            repo: repo,
            check_run_id: checkId,
            status: status,
            output: {
                title: title,
                summary: summary
            },
            actions: actions
        };

        // Only add conclusion and completed_at if all workflows are done
        if (status === "completed") {
            params.conclusion = conclusion;
            params.completed_at = new Date().toISOString();
        }

        try {
            await octokit.checks.update(params);
            this.log.info(`Successfully synced status for check id ${checkId}`);
        } catch (error) {
            this.log.error(error, `Failed to sync status for check id ${checkId}`);
        }
    }

    private async cleanupPreviousResultFor(workflowRuns: GhaWorkflowRuns[]) {
        for (const workflowRun of workflowRuns) {
            if (workflowRun.workflow_run_id !== null) {
                await gha_workflow_runs(db).update({workflow_run_id: workflowRun.workflow_run_id}, {
                    workflow_job_id: null,
                    conclusion: null,
                    pr_conclusion: null,
                });
            } else {
                this.log.warn(`Workflow run ${workflowRun.pipeline_run_name} does not have workflow_run_id`);
            }
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
            this.log.warn(`No workflow runs for check id ${checkId} and pr_conclusion is not null found in db`);
        } else {
            // create new pr check run
            const checkRelatedWorkflowRun = checkRelatedWorkflowRuns[0];
            const pr_check_id = checkRelatedWorkflowRun.pr_check_id;
            if (pr_check_id === null) {
                this.log.warn(`Workflow run ${checkRelatedWorkflowRun.pipeline_run_name} does not have pr_check_id`);
                return;
            }
            if (checkRelatedWorkflowRun.workflow_run_id === null) {
                this.log.warn(`Workflow run ${checkRelatedWorkflowRun.pipeline_run_name} does not have workflow_run_id, nothing to re-run`);
                return;
            }
            await this.cleanupPreviousResultFor(checkRelatedWorkflowRuns);
            await this.reCreatePrCheck(checkRelatedWorkflowRun, octokit, pr_check_id, payload.repository.owner.login, payload.repository.name);
            await this.triggerReRunFor(checkRelatedWorkflowRuns, octokit, payload.repository.owner.login, payload.repository.name);
        }
    }
}
