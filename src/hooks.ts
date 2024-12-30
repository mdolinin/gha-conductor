import {minimatch} from "minimatch";
import {Logger, ProbotOctokit} from "probot";
import {
    RestEndpointMethodTypes
} from "@octokit/plugin-rest-endpoint-methods/dist-types/generated/parameters-and-response-types";
import {HookType} from "./__generated__/_enums";
import db, {gha_hooks, gha_workflow_runs} from "./db/database";
import {GhaHook} from "./gha_loader";
import {GhaHooks} from "./__generated__";
import {load} from "js-yaml";
import {anyOf, not} from "@databases/pg-typed";

type workflowDispatchEventParameters = RestEndpointMethodTypes["actions"]["createWorkflowDispatch"]["parameters"];

type WorkflowDefinition = {
    name: string,
    on: {
        workflow_dispatch: {
            inputs: {
                [key: string]: {
                    default?: string,
                    required: boolean
                }
            }
        }
    }
}

export interface TriggeredWorkflow {
    name: string,
    inputs: any
    error?: string
}

export class Hooks {

    log: Logger;

    constructor(log: Logger) {
        this.log = log;
    }

    async filterTriggeredHooks(repo_full_name: string, hookType: HookType,
                               files_changed: string[], baseBranch: string,
                               hooksChangedInPR: { hooks: GhaHook[]; hookFilesModified: Set<string> },
                               slashCommand?: string | undefined
    ): Promise<Set<GhaHook>> {
        this.log.info(`Filtering hooks for ${hookType} on branch ${baseBranch} in repo ${repo_full_name}`);
        const triggeredHooks = new Set<GhaHook>();
        const allHooks = new Map<string, GhaHook[]>();
        const {hooks: hooksFromPR, hookFilesModified} = hooksChangedInPR;
        if (hookType === "onBranchMerge") {
            const mainHooks = await gha_hooks(db).find({
                repo_full_name: repo_full_name,
                branch: baseBranch,
                hook: hookType,
                destination_branch_matcher: baseBranch,
                path_to_gha_yaml: not(anyOf([...hookFilesModified])),
            }).all()
            const prHooks = hooksFromPR.filter((hook) => hook.hook === hookType && hook.destination_branch_matcher === baseBranch)
            this.mergeHooksFromDbWithPRHooksByUniquePrefix(mainHooks, prHooks, allHooks);
        } else if (hookType === "onSlashCommand") {
            if (!slashCommand) {
                this.log.error("Slash command hook type requires a slash command");
                return triggeredHooks;
            }
            const mainHooks = await gha_hooks(db).find({
                repo_full_name: repo_full_name,
                branch: baseBranch,
                hook: hookType,
                slash_command: slashCommand,
                path_to_gha_yaml: not(anyOf([...hookFilesModified])),
            }).all();
            const prHooks = hooksFromPR.filter((hook) => hook.hook === hookType && hook.slash_command === slashCommand)
            this.mergeHooksFromDbWithPRHooksByUniquePrefix(mainHooks, prHooks, allHooks);
        } else {
            const mainHooks = await gha_hooks(db).find({
                repo_full_name: repo_full_name,
                branch: baseBranch,
                hook: hookType,
                path_to_gha_yaml: not(anyOf([...hookFilesModified])),
            }).all();
            const prHooks = hooksFromPR.filter((hook) => hook.hook === hookType)
            this.mergeHooksFromDbWithPRHooksByUniquePrefix(mainHooks, prHooks, allHooks);
        }
        allHooks.forEach((hooks) => {
            let matched = false;
            for (const hook of hooks) {
                if (matched) {
                    break;
                }
                for (const file of files_changed) {
                    if (!hook.file_changes_matcher.startsWith("!") && minimatch(file, hook.file_changes_matcher)) {
                        this.log.info(`File ${file} matches matcher ${hook.file_changes_matcher} for hook ${hook.pipeline_unique_prefix}`);
                        triggeredHooks.add(hook);
                        matched = true;
                    }
                }
            }
        });
        return triggeredHooks
    }

    private mergeHooksFromDbWithPRHooksByUniquePrefix(mainHooks: GhaHooks[], prHooks: GhaHook[], allHooks: Map<string, GhaHook[]>) {
        const groupedMainHooks = new Map<string, GhaHook[]>();
        for (const hook of mainHooks) {
            if (!groupedMainHooks.has(hook.pipeline_unique_prefix)) {
                groupedMainHooks.set(hook.pipeline_unique_prefix, [this.mapToHook(hook)]);
            } else {
                groupedMainHooks.get(hook.pipeline_unique_prefix)?.push(this.mapToHook(hook));
            }
        }
        const groupedPrHooks = new Map<string, GhaHook[]>();
        for (const hook of prHooks) {
            if (!groupedPrHooks.has(hook.pipeline_unique_prefix)) {
                groupedPrHooks.set(hook.pipeline_unique_prefix, [hook]);
            } else {
                groupedPrHooks.get(hook.pipeline_unique_prefix)?.push(hook);
            }
        }
        for (const [pipeline_unique_prefix, hooks] of groupedMainHooks) {
            allHooks.set(pipeline_unique_prefix, hooks);
        }
        for (const [pipeline_unique_prefix, hooks] of groupedPrHooks) {
            allHooks.set(pipeline_unique_prefix, hooks);
        }
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
            path_to_gha_yaml: hook.path_to_gha_yaml ? hook.path_to_gha_yaml : undefined,
            pipeline_unique_prefix: hook.pipeline_unique_prefix,
            file_changes_matcher: hook.file_changes_matcher,
            slash_command: hook.slash_command ? hook.slash_command : undefined,
            hook: hook.hook
        };
    }

    async runWorkflow(octokit: InstanceType<typeof ProbotOctokit>,
                      pull_request: {
                          number: number;
                          head: { ref: string; sha: string };
                          base: {
                              ref: string;
                              repo: { default_branch: string; name: string; owner: { login: string } };
                              sha: string
                          };
                          merged: boolean | null
                      },
                      action: string,
                      triggeredHooks: Set<GhaHook>, merge_commit_sha: string, prCheckId: number,
                      commandTokens?: string[] | undefined,
                      workflowFileExtension: string = ".yaml"
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
        const headSha = pull_request.head.sha;
        const common_serialized_variables = {
            'PR_HEAD_REF': pull_request.head.ref,
            'PR_HEAD_SHA': headSha,
            'PR_BASE_REF': pull_request.base.ref,
            'PR_BASE_SHA': pull_request.base.sha,
            'PR_MERGE_SHA': merge_commit_sha,
            'PR_NUMBER': prNumber,
            'PR_ACTION': pr_action,
        }
        this.log.info(`Searching for workflow to run for PR #${prNumber} with action ${action}`);
        const triggeredPipelines: TriggeredWorkflow[] = [];
        for (const hook of triggeredHooks) {
            const owner = pull_request.base.repo.owner.login;
            const repo = pull_request.base.repo.name;
            const pipeline_ref = hook.pipeline_ref ? hook.pipeline_ref : pull_request.base.repo.default_branch;
            const workflow_id = `${hook.pipeline_name}${workflowFileExtension}`;
            const pipelineUniquePrefix = hook.pipeline_unique_prefix;
            const pipeline_name = `${pipelineUniquePrefix}-${headSha}`;
            let sharedParams = hook.shared_params;
            let pipelineParams = hook.pipeline_params;
            // merge all shared and pipeline params and common_serialized_variables
            let serialized_variables = {
                ...common_serialized_variables,
                ...sharedParams,
                ...pipelineParams
            }
            let inputs: Record<string, string> = {
                PIPELINE_NAME: pipeline_name,
                SERIALIZED_VARIABLES: JSON.stringify(serialized_variables)
            };
            const workflowInputsMap = new Map<string, { required: boolean, default?: string }>();
            // verify workflow exists and is active
            try {
                const resp = await octokit.rest.actions.getWorkflow({
                    owner: owner,
                    repo: repo,
                    workflow_id: workflow_id
                });
                if (resp.data.state !== "active") {
                    this.log.warn(`Workflow ${workflow_id} is not active in repo ${owner}/${repo}`);
                    await this.createNewRun(pipelineUniquePrefix, headSha, merge_commit_sha, pipeline_name, inputs, prNumber, prCheckId, hook.hook, true);
                    triggeredPipelines.push({
                        name: pipeline_name,
                        inputs: inputs,
                        error: `Workflow ${workflow_id} is not active`
                    });
                    continue;
                }
                // download the workflow file to get the inputs
                try {
                    const workflowFileResp = await octokit.rest.repos.getContent({
                        owner: owner,
                        repo: repo,
                        path: resp.data.path,
                        ref: pipeline_ref
                    });
                    if ("content" in workflowFileResp.data) {
                        const workflowFileContent = Buffer.from(workflowFileResp.data.content, 'base64').toString();
                        const workflowYaml = load(workflowFileContent) as WorkflowDefinition;
                        const workflowInputs = workflowYaml.on.workflow_dispatch.inputs
                        for (const [key, value] of Object.entries(workflowInputs)) {
                            workflowInputsMap.set(key, value);
                        }
                        // check if PIPELINE_NAME and SERIALIZED_VARIABLES are required
                        if (!workflowInputsMap.has("PIPELINE_NAME") || !workflowInputsMap.has("SERIALIZED_VARIABLES")) {
                            this.log.warn(`Workflow ${workflow_id} does not have required inputs PIPELINE_NAME and SERIALIZED_VARIABLES`);
                            await this.createNewRun(pipelineUniquePrefix, headSha, merge_commit_sha, pipeline_name, inputs, prNumber, prCheckId, hook.hook, true);
                            triggeredPipelines.push({
                                name: pipeline_name,
                                inputs: inputs,
                                error: `Workflow ${workflow_id} does not have required inputs PIPELINE_NAME and SERIALIZED_VARIABLES`
                            });
                            continue;
                        }
                        workflowInputsMap.delete("PIPELINE_NAME");
                        workflowInputsMap.delete("SERIALIZED_VARIABLES");
                        // add required inputs to inputs, if missing and no default value return error
                        let missingInputs = false;
                        for (const [key, value] of workflowInputsMap) {
                            if (value.required) {
                                if (serialized_variables[key] === undefined) {
                                    if (!value.default) {
                                        this.log.warn(`Workflow ${workflow_id} requires input ${key} which is missing in SERIALIZED_VARIABLES and has no default value`);
                                        await this.createNewRun(pipelineUniquePrefix, headSha, merge_commit_sha, pipeline_name, inputs, prNumber, prCheckId, hook.hook, true);
                                        triggeredPipelines.push({
                                            name: pipeline_name,
                                            inputs: inputs,
                                            error: `Workflow ${workflow_id} requires input ${key} which is missing in SERIALIZED_VARIABLES and has no default value`
                                        });
                                        missingInputs = true;
                                    }
                                }
                            }
                        }
                        if (missingInputs) {
                            continue;
                        }
                    } else {
                        this.log.warn(`Failed to get workflow ${workflow_id} content in repo ${owner}/${repo}`);
                        await this.createNewRun(pipelineUniquePrefix, headSha, merge_commit_sha, pipeline_name, inputs, prNumber, prCheckId, hook.hook, true);
                        triggeredPipelines.push({
                            name: pipeline_name,
                            inputs: inputs,
                            error: `Failed to get workflow ${workflow_id} content in repo ${owner}/${repo}`
                        });
                        continue;
                    }
                } catch (e) {
                    this.log.warn(e, `Failed to get workflow ${workflow_id} content in repo ${owner}/${repo}`);
                    await this.createNewRun(pipelineUniquePrefix, headSha, merge_commit_sha, pipeline_name, inputs, prNumber, prCheckId, hook.hook, true);
                    triggeredPipelines.push({
                        name: pipeline_name,
                        inputs: inputs,
                        error: `Failed to get workflow ${workflow_id} content in repo ${owner}/${repo} with error ${e}`
                    });
                    continue;
                }
            } catch (e) {
                this.log.warn(e, `Failed to get workflow ${workflow_id} in repo ${owner}/${repo}`);
                await this.createNewRun(pipelineUniquePrefix, headSha, merge_commit_sha, pipeline_name, inputs, prNumber, prCheckId, hook.hook, true);
                triggeredPipelines.push({
                    name: pipeline_name,
                    inputs: inputs,
                    error: `Failed to get workflow ${workflow_id}, probably does not exist in repo ${owner}/${repo}`
                });
                continue;
            }
            if (hook.hook === "onSlashCommand") {
                if (!commandTokens) {
                    this.log.error("Slash command hook type requires a slash command");
                    await this.createNewRun(pipelineUniquePrefix, headSha, merge_commit_sha, pipeline_name, inputs, prNumber, prCheckId, hook.hook, true);
                    triggeredPipelines.push({
                        name: pipeline_name,
                        inputs: inputs,
                        error: `Slash command hook type requires a slash command`
                    });
                    continue;
                } else {
                    const command = commandTokens[0];
                    if (hook.slash_command !== command) {
                        this.log.info(`Slash command ${command} does not match hook slash command ${hook.slash_command}`);
                        await this.createNewRun(pipelineUniquePrefix, headSha, merge_commit_sha, pipeline_name, inputs, prNumber, prCheckId, hook.hook, true);
                        triggeredPipelines.push({
                            name: pipeline_name,
                            inputs: inputs,
                            error: `Slash command ${command} does not match hook slash command ${hook.slash_command}`
                        });
                        continue;
                    }
                    const args = commandTokens.slice(1);
                    // substitute ${command} and ${args} if defined in shared and pipeline params that is json string
                    sharedParams = JSON.parse(JSON.stringify(sharedParams).replace("${command}", command).replace("${args}", args.join(" ")));
                    pipelineParams = JSON.parse(JSON.stringify(pipelineParams).replace("${command}", command).replace("${args}", args.join(" ")));
                    serialized_variables = {
                        ...common_serialized_variables,
                        ...sharedParams,
                        ...pipelineParams
                    }
                    inputs = {
                        PIPELINE_NAME: pipeline_name,
                        SERIALIZED_VARIABLES: JSON.stringify(serialized_variables)
                    }
                }
            }
            // add extra workflow inputs to inputs
            for (const [key, _] of workflowInputsMap) {
                if (serialized_variables[key] !== undefined) {
                    inputs[key] = serialized_variables[key]
                }
            }
            const workflowDispatch: workflowDispatchEventParameters = {
                owner: owner,
                repo: repo,
                workflow_id: workflow_id,
                ref: pipeline_ref,
                inputs: inputs
            };
            try {
                await octokit.rest.actions.createWorkflowDispatch(workflowDispatch);
                this.log.info(`Workflow ${pipelineUniquePrefix} triggered successfully for PR#${prNumber}`);
                await this.createNewRun(pipelineUniquePrefix, headSha, merge_commit_sha, pipeline_name, inputs, prNumber, prCheckId, hook.hook);
                triggeredPipelines.push({name: pipeline_name, inputs: inputs});
            } catch (e) {
                this.log.error(e, "Failed to trigger workflow " + pipelineUniquePrefix + " for PR#" + prNumber);
                await this.createNewRun(pipelineUniquePrefix, headSha, merge_commit_sha, pipeline_name, inputs, prNumber, prCheckId, hook.hook, true);
                triggeredPipelines.push({
                    name: pipeline_name,
                    inputs: inputs,
                    error: `Failed to trigger workflow ${workflow_id} for ref ${pipeline_ref}, with error ${e}`
                });
            }
        }
        return triggeredPipelines;
    }

    async createNewRun(workflowRunName: string,
                       headSha: string,
                       mergeCommitSha: string,
                       pipelineRunName: string,
                       workflowRunInputs: Record<string, string>,
                       prNumber: number,
                       prCheckId: number,
                       hookType: "onBranchMerge" | "onPullRequest" | "onPullRequestClose" | "onSlashCommand",
                       withError: boolean = false
    ) {
        let workflowRun = {
            name: workflowRunName,
            head_sha: headSha,
            merge_commit_sha: mergeCommitSha,
            pipeline_run_name: pipelineRunName,
            workflow_run_inputs: workflowRunInputs,
            pr_number: prNumber,
            pr_check_id: prCheckId,
            hook: hookType,
        }
        if (withError) {
            workflowRun = Object.assign(workflowRun, {
                status: "completed",
                conclusion: "failure"
            });
        }
        await gha_workflow_runs(db).insert(workflowRun);
    }

    static mapEventTypeToHook(
        eventType: "closed" | "opened" | "reopened" | "synchronize" | "edited",
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
            case "edited":
                return "onPullRequest";
        }
    }
}
