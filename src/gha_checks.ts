import {
    CheckRunRerequestedEvent,
    WorkflowJobCompletedEvent,
    WorkflowJobInProgressEvent,
    WorkflowJobQueuedEvent
} from "@octokit/webhooks-types";
import {Logger, ProbotOctokit} from "probot";
import {
    RestEndpointMethodTypes
} from "@octokit/plugin-rest-endpoint-methods/dist-types/generated/parameters-and-response-types";
import db, {gha_workflow_runs} from "./db/database";
import {GhaWorkflowRuns} from "./__generated__";
import {anyOf, not} from "@databases/pg-typed";
import {TriggeredWorkflow} from "./hooks";

const GITHUB_CHECK_TEXT_LIMIT = 65535;
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
    ReRunFailed = "re-run-failed"
}

export interface ReRunPayload {
    owner: string,
    repo: string,
    check_run_id: number,
    requested_action_identifier: PRCheckAction
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
        const resp = await octokit.checks.create(params);
        if (resp.status === 201) {
            const check = resp.data;
            // update workflow run in db
            await gha_workflow_runs(db).update({pipeline_run_name: erroredWorkflow.name, workflow_job_id: null}, {
                status: check.status,
                check_run_id: check.id,
                workflow_run_url: `https://github.com/${pull_request.base.repo.owner.login}/${pull_request.base.repo.name}/pull/${pull_request.number}/checks?check_run_id=${check.id}`
            });
        } else {
            this.log.error(`Failed to create ${checkName} check for PR #${pull_request.number}`);
        }
    }

    async createPRCheckNoPipelinesTriggered(octokit: InstanceType<typeof ProbotOctokit>, pull_request: {
        number: number,
        head: { sha: string },
        base: {
            repo: {
                name: string,
                owner: { login: string }
            },
        },
    }, hookType: "onBranchMerge" | "onPullRequest" | "onPullRequestClose" | "onSlashCommand", merge_commit_sha: string) {
        const checkName = this.hookToCheckName(hookType);
        this.log.info(`Creating ${checkName} check for ${pull_request.base.repo.owner.login}/${pull_request.base.repo.name}#${pull_request.number}`);
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
        const checkRunUrl = `https://github.com/${pull_request.base.repo.owner.login}/${pull_request.base.repo.name}/pull/${pull_request.number}/checks?check_run_id=${checkRunId}`
        if (resp.status === 201) {
            this.log.info(`${checkName} check with id ${checkRunId} for PR #${pull_request.number} created`);
        } else {
            this.log.error(`Failed to create ${checkName} check for PR #${pull_request.number}`);
        }
        return checkRunUrl;
    }

    async createPRCheckWithAnnotations(octokit: InstanceType<typeof ProbotOctokit>, pull_request: {
        number: number;
        head: { sha: string };
        base: { repo: { name: string; owner: { login: string } } }
    }, hookType: "onBranchMerge" | "onPullRequest" | "onPullRequestClose" | "onSlashCommand", annotationsForCheck: {
        annotation_level: "failure" | "notice" | "warning";
        message: string;
        path: string;
        start_line: number;
        end_line: number
    }[]) {
        const checkName = this.hookToCheckName(hookType);
        this.log.info(`Creating ${checkName} check for ${pull_request.base.repo.owner.login}/${pull_request.base.repo.name}#${pull_request.number}`);
        const sha = pull_request.head.sha;
        const params: RestEndpointMethodTypes["checks"]["create"]["parameters"] = {
            owner: pull_request.base.repo.owner.login,
            repo: pull_request.base.repo.name,
            name: checkName,
            head_sha: sha,
            status: "completed",
            conclusion: "failure",
            completed_at: new Date().toISOString(),
            output: {
                title: "Issues found in .gha.yml files",
                summary: "Issues found in .gha.yml files",
                annotations: annotationsForCheck,
            }
        };
        const resp = await octokit.checks.create(params);
        const checkRunId = resp.data.id;
        const checkRunUrl = `https://github.com/${pull_request.base.repo.owner.login}/${pull_request.base.repo.name}/pull/${pull_request.number}/checks?check_run_id=${checkRunId}`
        if (resp.status === 201) {
            this.log.info(`${checkName} check with id ${checkRunId} for PR #${pull_request.number} created`);
        } else {
            this.log.error(`Failed to create ${checkName} check for PR #${pull_request.number}`);
        }
        return checkRunUrl;
    }


    async createPRCheckForAllErroredPipelines(octokit: InstanceType<typeof ProbotOctokit>, pull_request: {
        number: number;
        head: { sha: string };
        base: { repo: { name: string; owner: { login: string } } }
    }, hookType: "onBranchMerge" | "onPullRequest" | "onPullRequestClose" | "onSlashCommand", merge_commit_sha: string, erroredWorkflows: TriggeredWorkflow[]) {
        const checkName = this.hookToCheckName(hookType);
        this.log.info(`Creating ${checkName} check for ${pull_request.base.repo.owner.login}/${pull_request.base.repo.name}#${pull_request.number}`);
        const sha = hookType === "onBranchMerge" ? merge_commit_sha : pull_request.head.sha;
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
        const params: RestEndpointMethodTypes["checks"]["create"]["parameters"] = {
            owner: pull_request.base.repo.owner.login,
            repo: pull_request.base.repo.name,
            name: checkName,
            head_sha: sha,
            status: "completed",
            conclusion: "failure",
            completed_at: new Date().toISOString(),
            output: {
                title: "All workflows errored. Nothing to do",
                summary: summary
            }
        };
        const resp = await octokit.checks.create(params);
        const checkRunId = resp.data.id;
        const checkRunUrl = `https://github.com/${pull_request.base.repo.owner.login}/${pull_request.base.repo.name}/pull/${pull_request.number}/checks?check_run_id=${checkRunId}`
        if (resp.status === 201) {
            this.log.info(`${checkName} check with id ${checkRunId} for PR #${pull_request.number} created`);
            await gha_workflow_runs(db).update({pr_number: pull_request.number, pr_check_id: null, hook: hookType}, {
                pr_check_id: checkRunId,
                pr_conclusion: "failure"
            });
        } else {
            this.log.error(`Failed to create ${checkName} check for PR #${pull_request.number}`);
        }
        return checkRunUrl;
    }

    async createPRCheckForTriggeredPipelines(octokit: InstanceType<typeof ProbotOctokit>, pull_request: {
        number: number,
        head: { sha: string },
        base: {
            repo: {
                name: string,
                owner: { login: string }
            },
        },
    }, hookType: "onBranchMerge" | "onPullRequest" | "onPullRequestClose" | "onSlashCommand", merge_commit_sha: string) {
        const checkName = this.hookToCheckName(hookType);
        this.log.info(`Creating ${checkName} check for ${pull_request.base.repo.owner.login}/${pull_request.base.repo.name}#${pull_request.number}`);
        const sha = hookType === "onBranchMerge" ? merge_commit_sha : pull_request.head.sha;
        const workflowRuns = await gha_workflow_runs(db).find({
            pr_number: pull_request.number,
            pr_check_id: null,
            hook: hookType
        }).all();
        const summary = await this.formatGHCheckSummaryAll(octokit, pull_request.base.repo.owner.login, pull_request.base.repo.name, workflowRuns);
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
        const checkRunUrl = `https://github.com/${pull_request.base.repo.owner.login}/${pull_request.base.repo.name}/pull/${pull_request.number}/checks?check_run_id=${checkRunId}`
        this.log.info(`Updating ${checkName} check with id ${checkRunId} for PR #${pull_request.number} in progress`);
        if (resp.status === 201) {
            await gha_workflow_runs(db).update({pr_number: pull_request.number, pr_check_id: null, hook: hookType}, {
                pr_check_id: checkRunId
            });
        }
        return checkRunUrl;
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
            workflow_job_id: workflowJob.id,
            conclusion: null
        });
        if (!workflowRun) {
            this.log.warn(`Workflow run ${workflowJob.name} is not exist in db`);
        } else {
            const checkRunId = workflowRun.check_run_id;
            if (!checkRunId) {
                this.log.warn(`Check run id is not exist for workflow run ${workflowJob.name}`);
                return;
            }
            const params: RestEndpointMethodTypes["checks"]["update"]["parameters"] = {
                owner: payload.repository.owner.login,
                repo: payload.repository.name,
                check_run_id: Number(checkRunId),
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
                await gha_workflow_runs(db).update({
                    pipeline_run_name: workflowJob.name,
                    workflow_job_id: workflowJob.id,
                    check_run_id: check.id
                }, {
                    status: check.status,
                });
            }
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
            const log_max_size = GITHUB_CHECK_TEXT_LIMIT - 2000;
            const workflowJobLog = await this.getWorkflowJobLog(octokit, payload.repository.owner.login, payload.repository.name, workflowJob.id, log_max_size);
            const summary = this.formatGHCheckSummary(workflowRun, payload.workflow_job.conclusion, "completed", workflowJobLog);
            const checkRunId = workflowRun.check_run_id;
            if (!checkRunId) {
                this.log.warn(`Check run id is not exist for workflow run ${workflowJob.name}`);
                return;
            }
            const params: RestEndpointMethodTypes["checks"]["update"]["parameters"] = {
                owner: payload.repository.owner.login,
                repo: payload.repository.name,
                check_run_id: Number(checkRunId),
                status: "completed",
                conclusion: payload.workflow_job.conclusion,
                completed_at: new Date().toISOString(),
                output: {
                    title: "Workflow run completed",
                    summary: summary
                }
            };
            const resp = await octokit.checks.update(params);
            if (resp.status === 200) {
                const check = resp.data;
                // update workflow run in db
                await gha_workflow_runs(db).update({
                    pipeline_run_name: workflowJob.name,
                    workflow_job_id: workflowJob.id,
                    check_run_id: check.id
                }, {
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
                }
            };
            const resp = await octokit.checks.update(params);
            if (resp.status === 200) {
                this.log.info(`Updating pr-status check with id ${workflowRun.pr_check_id} for PR #${workflowRun.pr_number}` + " in progress");
            } else {
                this.log.error("Failed to update pr-status check with id " + workflowRun.pr_check_id + " for PR #" + workflowRun.pr_number + " in progress");
            }
        }
    }

    private stripAnsi(text: string) {
        return text.replace(ansiRegex, '');
    }

    private async getWorkflowJobLog(octokit: InstanceType<typeof ProbotOctokit>, owner: string, repo: string, jobId: number, log_max_size: number) {
        const workflowJobLogResp = await octokit.actions.downloadJobLogsForWorkflowRun({
            owner: owner,
            repo: repo,
            job_id: Number(jobId)
        });
        let workflowJobLog = null;
        // @ts-ignore
        if (workflowJobLogResp.status === 200) {
            const data = String(workflowJobLogResp.data);
            workflowJobLog = data.slice(-log_max_size);
        } else {
            this.log.warn(`Failed to get workflow job log for ${jobId} with ${JSON.stringify(workflowJobLogResp)}`);
        }
        if (workflowJobLog === null) {
            return null;
        }
        return this.stripAnsi(workflowJobLog);
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
            `${JSON.stringify(workflow.workflow_run_inputs, null, 2)} \n` +
            `\n` +
            `\`\`\`\n` +
            `\n` +
            `</p>\n` +
            `</details>`;
        return summary;
    }

    private async formatGHCheckSummaryAll(octokit: InstanceType<typeof ProbotOctokit>, owner: string, repo: string, workflowRuns: GhaWorkflowRuns[], status: string = "") {
        let summary = "";
        const log_max_size = (GITHUB_CHECK_TEXT_LIMIT / workflowRuns.length) - 2000;
        for (const workflowRun of workflowRuns) {
            const workflowRunConclusion = workflowRun.conclusion ? workflowRun.conclusion : "";
            const workflowRunStatus = workflowRun.status ? workflowRun.status : status;
            let workflowJobLog: string | null = null;
            if (workflowRun.workflow_job_id !== null) {
                workflowJobLog = await this.getWorkflowJobLog(octokit, owner, repo, workflowRun.workflow_job_id, log_max_size);
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
                this.log.info("All jobs finished for pr #" + allPRWorkflowRuns[0].pr_number);
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
                const resp = await octokit.checks.update(params);
                if (resp.status === 200) {
                    this.log.info(`Updating pr-status check with id ${allPRWorkflowRuns[0].pr_check_id} for PR #${allPRWorkflowRuns[0].pr_number}` + " completed");
                    await gha_workflow_runs(db).update({pr_check_id: allPRWorkflowRuns[0].pr_check_id}, {
                        pr_conclusion: conclusion,
                    });
                    await this.createPRCommentWithCheckUrlAfterMergeIfFailed(octokit, owner, repo, prNumber, allPRWorkflowRuns[0], conclusion, summary);
                } else {
                    this.log.error("Failed to update pr-status check with id " + allPRWorkflowRuns[0].pr_check_id + " for PR #" + allPRWorkflowRuns[0].pr_number + " completed");
                }
            } else {
                this.log.info("Some jobs not finished for pr #" + allPRWorkflowRuns[0].pr_number);
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
        await octokit.issues.createComment({
            owner: owner,
            repo: repo,
            issue_number: prNumber,
            body: prComment
        });
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
            started_at: new Date().toISOString()
        };
        const resp = await octokit.checks.create(params);
        const newPRcheckRunId = resp.data.id;
        if (resp.status === 201) {
            this.log.info(`${checkName} check with id ${newPRcheckRunId} for PR #${prRelatedWorkflowRun.pr_number} created`);
            await gha_workflow_runs(db).update({pr_check_id: pr_check_id}, {
                pr_check_id: newPRcheckRunId,
                pr_conclusion: null
            });
        } else {
            this.log.error(`Failed to create ${checkName} check for PR #${prRelatedWorkflowRun.pr_number}`);
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
                const resp = await octokit.actions.reRunWorkflow(params);
                if (resp.status === 201) {
                    this.log.info(`Re-run workflow ${workflowRun.pipeline_run_name} with id ${workflowRun.workflow_run_id} for PR #${workflowRun.pr_number} created`);
                }
            } catch (e) {
                this.log.error(`Failed to re-run workflow ${workflowRun.pipeline_run_name} with id ${workflowRun.workflow_run_id} for PR #${workflowRun.pr_number} with error ${e}`);
            }
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