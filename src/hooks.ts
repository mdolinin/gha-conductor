import minimatch from "minimatch";
import {ProbotOctokit} from "probot";
import {PullRequest} from "@octokit/webhooks-types";
import {
    RestEndpointMethodTypes
} from "@octokit/plugin-rest-endpoint-methods/dist-types/generated/parameters-and-response-types";
import {HookType} from "./__generated__/_enums";
import db, {gha_hooks} from "./db/database";
import pino from "pino";
import {getTransformStream} from "@probot/pino";
import {GhaHook} from "./gha_loader";

const transform = getTransformStream();
transform.pipe(pino.destination(1));
const log = pino(
    {
        name: "gha-hooks",
    },
    transform
);

type workflowDispatchEventParameters = RestEndpointMethodTypes["actions"]["createWorkflowDispatch"]["parameters"];


export interface TriggeredWorkflow {
    name: string,
    inputs: any
}

export class Hooks {
    async filterTriggeredHooks(repo_full_name: string, hookType: HookType,
                               files_changed: string[], baseBranch: string, hooksChangedInPR: GhaHook[]): Promise<Set<string>> {
        log.info(`Filtering hooks for ${hookType} on branch ${baseBranch} in repo ${repo_full_name}`);
        const triggeredHookNames = new Set<string>();
        const all_matchers = new Map<string, string>();
        if (hookType === "onBranchMerge") {
            const main_matchers = await gha_hooks(db).find({
                repo_full_name: repo_full_name,
                hook: hookType,
                destination_branch_matcher: baseBranch
            }).select('file_changes_matcher', 'pipeline_unique_prefix').all();
            const pr_matchers = hooksChangedInPR.filter((hook) => hook.hook === hookType &&
                hook.destination_branch_matcher === baseBranch)
                .map((hook) => {
                    return {
                        file_changes_matcher: hook.file_changes_matcher,
                        pipeline_unique_prefix: hook.pipeline_unique_prefix
                    }
                });
            for (const matcher of main_matchers) {
                all_matchers.set(matcher.pipeline_unique_prefix, matcher.file_changes_matcher);
            }
            for (const matcher of pr_matchers) {
                all_matchers.set(matcher.pipeline_unique_prefix, matcher.file_changes_matcher);
            }
        } else {
            const main_matchers = await gha_hooks(db).find({
                repo_full_name: repo_full_name,
                hook: hookType
            }).select('file_changes_matcher', 'pipeline_unique_prefix').all();
            const pr_matchers = hooksChangedInPR.filter((hook) => hook.hook === hookType)
                .map((hook) => {
                    return {
                        file_changes_matcher: hook.file_changes_matcher,
                        pipeline_unique_prefix: hook.pipeline_unique_prefix
                    }
                });
            for (const matcher of main_matchers) {
                all_matchers.set(matcher.pipeline_unique_prefix, matcher.file_changes_matcher);
            }
            for (const matcher of pr_matchers) {
                all_matchers.set(matcher.pipeline_unique_prefix, matcher.file_changes_matcher);
            }
        }
        for (const file of files_changed) {
            all_matchers.forEach((file_changes_matcher, pipeline_unique_prefix) => {
                if (!file_changes_matcher.startsWith("!") && minimatch(file, file_changes_matcher)) {
                    log.info(`File ${file} matches matcher ${file_changes_matcher}`);
                    triggeredHookNames.add(pipeline_unique_prefix);
                }
            });
        }
        return triggeredHookNames
    }

    async runWorkflow(octokit: InstanceType<typeof ProbotOctokit>,
                      pull_request: (PullRequest & {
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
                      }),
                      action: string,
                      triggeredHooks: string[], hookType: HookType, merge_commit_sha: string): Promise<TriggeredWorkflow[]> {
        let pr_action = action;
        if (pull_request.merged) {
            pr_action = "merged";
        } else if (action === "reopened") {
            pr_action = "opened";
        } else if (action === "synchronize") {
            pr_action = "opened";
        }
        const common_serialized_variables = {
            'PR_HEAD_REF': pull_request.head.ref,
            'PR_HEAD_SHA': pull_request.head.sha,
            'PR_BASE_REF': pull_request.base.ref,
            'PR_BASE_SHA': pull_request.base.sha,
            'PR_MERGE_SHA': merge_commit_sha,
            'PR_NUMBER': pull_request.number,
            'PR_ACTION': pr_action,
        }
        log.info(`Searching for workflow to run for PR #${pull_request.number} with action ${action}`);
        const triggeredPipelines: TriggeredWorkflow[] = [];
        for (const pipeline_run_name of triggeredHooks) {
            let pipelines: any;
            if (hookType === "onBranchMerge") {
                pipelines = await gha_hooks(db).findOne({
                    pipeline_unique_prefix: pipeline_run_name,
                    hook: hookType,
                    destination_branch_matcher: pull_request.base.ref
                });
            } else {
                pipelines = await gha_hooks(db).findOne({
                    pipeline_unique_prefix: pipeline_run_name,
                    hook: hookType
                });
            }
            const owner = pull_request.base.repo.owner.login;
            const repo = pull_request.base.repo.name;
            const pipeline_ref = pipelines.pipeline_ref ? pipelines.pipeline_ref : pull_request.base.repo.default_branch;
            const workflow_id = `${pipelines.pipeline_name}.yaml`;
            const pipeline_name = `${pipeline_run_name}-${pull_request.head.sha}`;
            const inputs = {
                PIPELINE_NAME: pipeline_name,
                ...pipelines.shared_params,
                ...pipelines.pipeline_params,
                SERIALIZED_VARIABLES: JSON.stringify(common_serialized_variables)
            };
            const workflowDispatch: workflowDispatchEventParameters = {
                owner: owner,
                repo: repo,
                workflow_id: workflow_id,
                ref: pipeline_ref,
                inputs: inputs
            };
            const resp = await octokit.rest.actions.createWorkflowDispatch(workflowDispatch);
            log.info("Trigger workflow " + pipeline_run_name + " for PR#" + pull_request.number);
            if (resp.status === 204) {
                log.info("Workflow " + pipeline_run_name + " triggered successfully");
            }
            triggeredPipelines.push({name: pipeline_name, inputs: inputs});
        }
        return triggeredPipelines;
    }

    static mapEventTypeToHook(
        eventType: "closed" | "opened" | "reopened" | "synchronize",
        merged: null | boolean): HookType {
        switch (eventType) {
            case "closed":
                if (merged) {
                    return "onBranchMerge";
                }
                return "onPullRequestClose";
            case "opened":
            case "reopened":
            case "synchronize":
                return "onPullRequest";
        }
    }
}
