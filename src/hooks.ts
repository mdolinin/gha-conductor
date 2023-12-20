import minimatch from "minimatch";
import {ProbotOctokit} from "probot";
import {PullRequest} from "@octokit/webhooks-types";
import {
    RestEndpointMethodTypes
} from "@octokit/plugin-rest-endpoint-methods/dist-types/generated/parameters-and-response-types";
import {HookType} from "./__generated__/_enums";
import db, {gha_hooks} from "./db/database";

type workflowDispatchEventParameters = RestEndpointMethodTypes["actions"]["createWorkflowDispatch"]["parameters"];

export class Hooks {
    async filterTriggeredHooks(repo_full_name: string, hookType: HookType,
                               files_changed: string[], baseBranch: string): Promise<Set<string>> {
        console.log(`Filtering hooks for ${hookType} on branch ${baseBranch} in repo ${repo_full_name}`);
        const triggeredHookNames = new Set<string>();
        let all_matchers;
        if (hookType === "onBranchMerge") {
            all_matchers = await gha_hooks(db).find({
                repo_full_name: repo_full_name,
                hook: hookType,
                destination_branch_matcher: baseBranch
            }).select('file_changes_matcher', 'pipeline_unique_prefix').all();
        } else {
            all_matchers = await gha_hooks(db).find({
                repo_full_name: repo_full_name,
                hook: hookType
            }).select('file_changes_matcher', 'pipeline_unique_prefix').all();
        }
        for (const file of files_changed) {
            // Find all file matchers in hooks for pull request view and check if file matches
            for (const matcher of all_matchers) {
                if (matcher.file_changes_matcher.startsWith("!")) {
                    continue
                }
                if (minimatch(file, matcher.file_changes_matcher)) {
                    console.log("File " + file + " matches " + matcher.file_changes_matcher);
                    triggeredHookNames.add(matcher.pipeline_unique_prefix);
                }
            }
        }
        return triggeredHookNames
    }

    async runPipelines(octokit: InstanceType<typeof ProbotOctokit>,
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
                       triggeredHooks: string[], hookType: HookType, merge_commit_sha: string | null) {
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
        console.log("Searching for pipelines to run for PR " + pull_request.number + " with action " + action);
        const triggeredPipelineNames = [];
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
            const workflowDispatch: workflowDispatchEventParameters = {
                owner: owner,
                repo: repo,
                workflow_id: workflow_id,
                ref: pipeline_ref,
                inputs: {
                    PIPELINE_NAME: pipeline_name,
                    ...pipelines.shared_params,
                    ...pipelines.pipeline_params,
                    SERIALIZED_VARIABLES: JSON.stringify(common_serialized_variables)
                }
            };
            const resp = await octokit.rest.actions.createWorkflowDispatch(workflowDispatch);
            console.log("Trigger pipeline " + pipeline_run_name + " for PR#" + pull_request.number);
            console.log(resp);
            triggeredPipelineNames.push(pipeline_name);
        }
        return triggeredPipelineNames;
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
