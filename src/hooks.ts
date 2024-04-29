import {minimatch} from "minimatch";
import {ProbotOctokit} from "probot";
import {
    RestEndpointMethodTypes
} from "@octokit/plugin-rest-endpoint-methods/dist-types/generated/parameters-and-response-types";
import {HookType} from "./__generated__/_enums";
import db, {gha_hooks} from "./db/database";
import pino from "pino";
import {getTransformStream} from "@probot/pino";
import {GhaHook} from "./gha_loader";
import {GhaHooks} from "./__generated__";

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
    error?: string
}

export class Hooks {
    async filterTriggeredHooks(repo_full_name: string, hookType: HookType,
                               files_changed: string[], baseBranch: string, hooksChangedInPR: GhaHook[],
                               slashCommand?: string | undefined
    ): Promise<Set<GhaHook>> {
        log.info(`Filtering hooks for ${hookType} on branch ${baseBranch} in repo ${repo_full_name}`);
        const triggeredHooks = new Set<GhaHook>();
        const allHooks = new Map<string, GhaHook>();
        if (hookType === "onBranchMerge") {
            const mainHooks = await gha_hooks(db).find({
                repo_full_name: repo_full_name,
                branch: baseBranch,
                hook: hookType,
                destination_branch_matcher: baseBranch
            }).all()
            const prHooks = hooksChangedInPR.filter((hook) => hook.hook === hookType && hook.destination_branch_matcher === baseBranch)
            for (const hook of mainHooks) {
                allHooks.set(hook.pipeline_unique_prefix, this.mapToHook(hook));
            }
            for (const hook of prHooks) {
                allHooks.set(hook.pipeline_unique_prefix, hook);
            }
        } else if (hookType === "onSlashCommand") {
            if (!slashCommand) {
                log.error("Slash command hook type requires a slash command");
                return triggeredHooks;
            }
            const mainHooks = await gha_hooks(db).find({
                repo_full_name: repo_full_name,
                branch: baseBranch,
                hook: hookType,
                slash_command: slashCommand
            }).all();
            const prHooks = hooksChangedInPR.filter((hook) => hook.hook === hookType && hook.slash_command === slashCommand)
            for (const hook of mainHooks) {
                allHooks.set(hook.pipeline_unique_prefix, this.mapToHook(hook));
            }
            for (const hook of prHooks) {
                allHooks.set(hook.pipeline_unique_prefix, hook);
            }
        } else {
            const mainHooks = await gha_hooks(db).find({
                repo_full_name: repo_full_name,
                branch: baseBranch,
                hook: hookType
            }).all();
            const prHooks = hooksChangedInPR.filter((hook) => hook.hook === hookType)
            for (const hook of mainHooks) {
                allHooks.set(hook.pipeline_unique_prefix, this.mapToHook(hook));
            }
            for (const hook of prHooks) {
                allHooks.set(hook.pipeline_unique_prefix, hook);
            }
        }
        for (const file of files_changed) {
            allHooks.forEach((hook) => {
                if (!hook.file_changes_matcher.startsWith("!") && minimatch(file, hook.file_changes_matcher)) {
                    log.info(`File ${file} matches matcher ${hook.file_changes_matcher}`);
                    triggeredHooks.add(hook);
                }
            });
        }
        return triggeredHooks
    }

    private mapToHook(hook: GhaHooks) {
        return {
            branch: hook.branch,
            destination_branch_matcher: hook.destination_branch_matcher,
            hook_name: hook.hook_name,
            pipeline_name: hook.pipeline_name,
            pipeline_params: hook.pipeline_params,
            pipeline_ref: hook.pipeline_ref ? hook.pipeline_ref : undefined,
            repo_full_name: hook.repo_full_name,
            shared_params: hook.shared_params,
            pipeline_unique_prefix: hook.pipeline_unique_prefix,
            file_changes_matcher: hook.file_changes_matcher,
            slash_command: hook.slash_command ? hook.slash_command : undefined,
            hook: hook.hook
        };
    }

    async runWorkflow(octokit: InstanceType<typeof ProbotOctokit>,
                      pull_request: {
                          number: number,
                          head: { ref: string, sha: string },
                          base: {
                              ref: string,
                              repo: {
                                  default_branch: string,
                                  name: string,
                                  owner: { login: string }
                              },
                              sha: string
                          },
                          merged: boolean | null
                      },
                      action: string,
                      triggeredHooks: Set<GhaHook>, merge_commit_sha: string,
                      commandTokens?: string[] | undefined
    ): Promise<TriggeredWorkflow[]> {
        const prNumber = pull_request.number;
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
            'PR_NUMBER': prNumber,
            'PR_ACTION': pr_action,
        }
        log.info(`Searching for workflow to run for PR #${prNumber} with action ${action}`);
        const triggeredPipelines: TriggeredWorkflow[] = [];
        for (const hook of triggeredHooks) {
            const owner = pull_request.base.repo.owner.login;
            const repo = pull_request.base.repo.name;
            const pipeline_ref = hook.pipeline_ref ? hook.pipeline_ref : pull_request.base.repo.default_branch;
            const workflow_id = `${hook.pipeline_name}.yaml`;
            const pipeline_name = `${hook.pipeline_unique_prefix}-${pull_request.head.sha}`;
            // verify workflow exists and is active
            try {
                const resp = await octokit.rest.actions.getWorkflow({
                    owner: owner,
                    repo: repo,
                    workflow_id: workflow_id
                });
                if (resp.status !== 200) {
                    log.warn(`Workflow ${workflow_id} does not exist in repo ${owner}/${repo}`);
                    triggeredPipelines.push({
                        name: pipeline_name,
                        inputs: {},
                        error: `Workflow ${workflow_id} does not exist`
                    });
                    continue;
                }
                if (resp.data.state !== "active") {
                    log.warn(`Workflow ${workflow_id} is not active in repo ${owner}/${repo}`);
                    triggeredPipelines.push({
                        name: pipeline_name,
                        inputs: {},
                        error: `Workflow ${workflow_id} is not active`
                    });
                    continue;
                }
            } catch (e) {
                log.warn(`Failed to get workflow ${workflow_id} in repo ${owner}/${repo} with error ${e}`);
                triggeredPipelines.push({
                    name: pipeline_name,
                    inputs: {},
                    error: `Failed to get workflow ${workflow_id}, probably does not exist in repo ${owner}/${repo}`
                });
                continue;
            }
            let sharedParams = hook.shared_params;
            let pipelineParams = hook.pipeline_params;
            if (hook.hook === "onSlashCommand") {
                if (!commandTokens) {
                    log.error("Slash command hook type requires a slash command");
                    triggeredPipelines.push({
                        name: pipeline_name,
                        inputs: {},
                        error: `Slash command hook type requires a slash command`
                    });
                    continue;
                } else {
                    const command = commandTokens[0];
                    if (hook.slash_command !== command) {
                        log.info(`Slash command ${command} does not match hook slash command ${hook.slash_command}`);
                        triggeredPipelines.push({
                            name: pipeline_name,
                            inputs: {},
                            error: `Slash command ${command} does not match hook slash command ${hook.slash_command}`
                        });
                        continue;
                    }
                    const args = commandTokens.slice(1);
                    // substitute ${command} and ${args} if defined in shared and pipeline params that is json string
                    sharedParams = JSON.parse(JSON.stringify(sharedParams).replace("${command}", command).replace("${args}", args.join(" ")));
                    pipelineParams = JSON.parse(JSON.stringify(pipelineParams).replace("${command}", command).replace("${args}", args.join(" ")));
                }
            }
            // merge all shared and pipeline params and common_serialized_variables
            const serialized_variables = {
                ...common_serialized_variables,
                ...sharedParams,
                ...pipelineParams
            }
            const inputs = {
                PIPELINE_NAME: pipeline_name,
                SERIALIZED_VARIABLES: JSON.stringify(serialized_variables)
            };
            const workflowDispatch: workflowDispatchEventParameters = {
                owner: owner,
                repo: repo,
                workflow_id: workflow_id,
                ref: pipeline_ref,
                inputs: inputs
            };
            const resp = await octokit.rest.actions.createWorkflowDispatch(workflowDispatch);
            log.info("Trigger workflow " + hook.pipeline_unique_prefix + " for PR#" + prNumber);
            if (resp.status === 204) {
                log.info("Workflow " + hook.pipeline_unique_prefix + " triggered successfully");
                triggeredPipelines.push({name: pipeline_name, inputs: inputs});
            } else {
                log.error("Failed to trigger workflow " + hook.pipeline_unique_prefix + " for PR#" + prNumber);
                triggeredPipelines.push({
                    name: pipeline_name,
                    inputs: inputs,
                    error: `Failed to trigger workflow ${workflow_id} for PR#${prNumber}, with status ${resp.status} and error ${resp.data}`
                });
            }
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

    async verifyAllHooksRefsExist(octokit: InstanceType<typeof ProbotOctokit>,
                                  owner: string, repo: string, default_branch: string,
                                  triggeredHooks: Set<GhaHook>): Promise<GhaHook[]> {
        const hooksWithNotExistingRef: GhaHook[] = [];
        for (const hook of triggeredHooks) {
            const pipeline_ref = hook.pipeline_ref ? hook.pipeline_ref : default_branch;
            try {
                await octokit.rest.repos.getBranch({
                    owner: owner,
                    repo: repo,
                    branch: pipeline_ref
                });
            } catch (e) {
                hook.pipeline_ref = pipeline_ref;
                hooksWithNotExistingRef.push(hook);
                log.warn(`Ref ${pipeline_ref} does not exist in repo ${owner}/${repo}`);
            }
        }
        return hooksWithNotExistingRef;
    }
}
