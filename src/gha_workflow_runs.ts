import {PullRequest} from "@octokit/webhooks-types";
import db, {gha_workflow_runs} from "./db/database";

export class GhaWorkflowRuns {

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
        // parse head sha from job name %s-%s-%s last part is sha
        const headSha = pipelineName.split("-").pop();
        // get check name from job name %s-%s-%s all parts except last one
        const checkName = pipelineName.split("-").slice(0, -1).join("-");
        // save initial info about workflow run
        await gha_workflow_runs(db).insert({
            name: checkName,
            head_sha: headSha,
            pipeline_run_name: pipelineName,
            pr_number: pull_request.number,
        });
    }
}