import {Logger, ProbotOctokit} from "probot";
import simpleGit from "simple-git";
import path from "path";
import * as fs from "fs";
import {glob} from "glob";
import {load} from "js-yaml";
import db, {gha_hooks} from "./db/database";
import {TheRootSchema} from "./gha_yaml";
import {HookType} from "./__generated__/_enums";
import {components} from "@octokit/openapi-types";

export interface GhaHook {
    repo_full_name: string,
    branch: string,
    file_changes_matcher: string,
    destination_branch_matcher: string | null,
    hook: HookType,
    hook_name: string,
    pipeline_unique_prefix: string,
    pipeline_name: string,
    pipeline_ref: string | undefined,
    pipeline_params: any,
    shared_params: any,
    slash_command: string | undefined
}

export class GhaLoader {

    private git = simpleGit();

    log: Logger;

    constructor(log: Logger) {
        this.log = log;
    }

    async loadAllGhaYaml(octokit: InstanceType<typeof ProbotOctokit>, full_name: string, branch: string) {
        const {token} = await octokit.auth({type: "installation"}) as Record<string, string>;
        this.log.debug(`Repo full name is ${full_name}`);
        // create temp dir
        const target = path.join(process.env.TMPDIR || '/tmp/', full_name);
        this.log.debug(`Temp dir is ${target}`);
        if (fs.existsSync(target)) {
            fs.rmSync(target, {recursive: true, force: true});
        }
        fs.mkdirSync(target, {recursive: true});
        // clone repo
        let remote = `https://x-access-token:${token}@github.com/${full_name}.git`;
        this.log.debug(`Repo path is ${remote}`);
        const cloneResp = await this.git.clone(remote, target);
        if (cloneResp !== "") {
            this.log.error(`Error cloning ${remote} repo ${cloneResp}`);
            return;
        }
        // then set the working directory of the root instance - you want all future
        // tasks run through `git` to be from the new directory, rather than just tasks
        // chained off this task
        await this.git.cwd({path: target, root: true});
        if (branch !== "master" && branch !== "main") {
            const checkoutResp = await this.git.checkoutBranch(branch, `origin/${branch}`);
            this.log.debug("Checkout response is " + JSON.stringify(checkoutResp));
        }
        // find all .gha.yaml files in repo using glob lib
        const ghaYamlFiles = await glob("**/.gha.yaml", {cwd: target});
        // parse yaml
        // delete all hooks for db before upserting
        await gha_hooks(db).delete({repo_full_name: full_name, branch: branch});
        for (const ghaYamlFilePath of ghaYamlFiles) {
            this.log.info("Found .gha.yaml file " + ghaYamlFilePath);
            const ghaFileYaml = load(fs.readFileSync(path.join(target, ghaYamlFilePath), "utf8"));
            this.log.debug(`Parsed yaml of ${ghaYamlFilePath} is ${JSON.stringify(ghaFileYaml)}`);
            await this.upsertGHAHooks(full_name, branch, <TheRootSchema>ghaFileYaml);
        }
    }

    private async upsertGHAHooks(full_name: string, branch: string, ghaFileYaml: TheRootSchema) {
        // iterate over onPullRequest hooks and store in db
        for (const onPR of ghaFileYaml.onPullRequest) {
            for (const fileChangesMatch of onPR.triggerConditions.fileChangesMatchAny) {
                const hook = {
                    repo_full_name: full_name,
                    branch: branch,
                    file_changes_matcher: fileChangesMatch,
                    destination_branch_matcher: null,
                    hook: 'onPullRequest' as HookType,
                    hook_name: onPR.name,
                    pipeline_unique_prefix: `${ghaFileYaml.teamNamespace}-${ghaFileYaml.moduleName}-${onPR.name}`,
                    pipeline_name: onPR.pipelineRef.name,
                    pipeline_ref: onPR.pipelineRef.ref,
                    pipeline_params: onPR.pipelineRunValues.params,
                    shared_params: ghaFileYaml.sharedParams
                }
                await gha_hooks(db).insert(hook);
            }
        }
        // iterate over onBranchMerge hooks and store in db
        for (const onBranchMerge of ghaFileYaml.onBranchMerge) {
            for (const fileChangesMatch of onBranchMerge.triggerConditions.fileChangesMatchAny) {
                for (const destinationBranchMatch of onBranchMerge.triggerConditions.destinationBranchMatchesAny) {
                    const hook = {
                        repo_full_name: full_name,
                        branch: branch,
                        file_changes_matcher: fileChangesMatch,
                        destination_branch_matcher: destinationBranchMatch,
                        hook: 'onBranchMerge' as HookType,
                        hook_name: onBranchMerge.name,
                        pipeline_unique_prefix: `${ghaFileYaml.teamNamespace}-${ghaFileYaml.moduleName}-${onBranchMerge.name}`,
                        pipeline_name: onBranchMerge.pipelineRef.name,
                        pipeline_ref: onBranchMerge.pipelineRef.ref,
                        pipeline_params: onBranchMerge.pipelineRunValues.params,
                        shared_params: ghaFileYaml.sharedParams
                    }
                    await gha_hooks(db).insert(hook);
                }
            }
        }
        if (ghaFileYaml.onPullRequestClose !== undefined) {
            // iterate over onPullRequestClose hooks and store in db
            for (const onPRClose of ghaFileYaml.onPullRequestClose) {
                for (const fileChangesMatch of onPRClose.triggerConditions.fileChangesMatchAny) {
                    const hook = {
                        repo_full_name: full_name,
                        branch: branch,
                        file_changes_matcher: fileChangesMatch,
                        destination_branch_matcher: null,
                        hook: 'onPullRequestClose' as HookType,
                        hook_name: onPRClose.name,
                        pipeline_unique_prefix: `${ghaFileYaml.teamNamespace}-${ghaFileYaml.moduleName}-${onPRClose.name}`,
                        pipeline_name: onPRClose.pipelineRef.name,
                        pipeline_ref: onPRClose.pipelineRef.ref,
                        pipeline_params: onPRClose.pipelineRunValues.params,
                        shared_params: ghaFileYaml.sharedParams
                    }
                    await gha_hooks(db).insert(hook);
                }
            }
        }
        if (ghaFileYaml.onSlashCommand !== undefined) {
            // iterate over onSlashCommand hooks and store in db
            for (const onSlashCommand of ghaFileYaml.onSlashCommand) {
                for (const fileChangesMatch of onSlashCommand.triggerConditions.fileChangesMatchAny) {
                    for (const slashCommand of onSlashCommand.triggerConditions.slashCommands) {
                        const hook = {
                            repo_full_name: full_name,
                            branch: branch,
                            file_changes_matcher: fileChangesMatch,
                            destination_branch_matcher: null,
                            hook: 'onSlashCommand' as HookType,
                            hook_name: onSlashCommand.name,
                            pipeline_unique_prefix: `${ghaFileYaml.teamNamespace}-${ghaFileYaml.moduleName}-${onSlashCommand.name}`,
                            pipeline_name: onSlashCommand.pipelineRef.name,
                            pipeline_ref: onSlashCommand.pipelineRef.ref,
                            pipeline_params: onSlashCommand.pipelineRunValues.params,
                            shared_params: ghaFileYaml.sharedParams,
                            slash_command: slashCommand
                        }
                        await gha_hooks(db).insert(hook);
                    }
                }
            }
        }
    }

    async loadGhaHooks(octokit: InstanceType<typeof ProbotOctokit>, data: components["schemas"]["diff-entry"][]): Promise<GhaHook[]> {
        let hooks: GhaHook[] = [];
        for (const file of data) {
            if (!file.filename.endsWith(".gha.yaml")) {
                continue;
            }
            this.log.info(`Loading hooks for file ${file.filename}`);
            const resp = await octokit.request(file.contents_url);
            if (resp.status !== 200) {
                this.log.error(`Error loading file ${file.filename}`);
                continue;
            }
            const ghaFileContent = Buffer.from(resp.data.content, "base64").toString();
            const ghaFileYaml = load(ghaFileContent);
            hooks = hooks.concat(this.getGhaHooks(<TheRootSchema>ghaFileYaml));
        }
        return hooks;
    }

    private getGhaHooks(ghaFileYaml: TheRootSchema): GhaHook[] {
        const hooks: GhaHook[] = [];
        for (const onPR of ghaFileYaml.onPullRequest) {
            for (const fileChangesMatch of onPR.triggerConditions.fileChangesMatchAny) {
                const hook = {
                    repo_full_name: "",
                    branch: "",
                    file_changes_matcher: fileChangesMatch,
                    destination_branch_matcher: null,
                    hook: 'onPullRequest' as HookType,
                    hook_name: onPR.name,
                    pipeline_unique_prefix: `${ghaFileYaml.teamNamespace}-${ghaFileYaml.moduleName}-${onPR.name}`,
                    pipeline_name: onPR.pipelineRef.name,
                    pipeline_ref: onPR.pipelineRef.ref,
                    pipeline_params: onPR.pipelineRunValues.params,
                    shared_params: ghaFileYaml.sharedParams,
                    slash_command: undefined
                }
                hooks.push(hook);
            }
        }
        for (const onBranchMerge of ghaFileYaml.onBranchMerge) {
            for (const fileChangesMatch of onBranchMerge.triggerConditions.fileChangesMatchAny) {
                for (const destinationBranchMatch of onBranchMerge.triggerConditions.destinationBranchMatchesAny) {
                    const hook = {
                        repo_full_name: "",
                        branch: "",
                        file_changes_matcher: fileChangesMatch,
                        destination_branch_matcher: destinationBranchMatch,
                        hook: 'onBranchMerge' as HookType,
                        hook_name: onBranchMerge.name,
                        pipeline_unique_prefix: `${ghaFileYaml.teamNamespace}-${ghaFileYaml.moduleName}-${onBranchMerge.name}`,
                        pipeline_name: onBranchMerge.pipelineRef.name,
                        pipeline_ref: onBranchMerge.pipelineRef.ref,
                        pipeline_params: onBranchMerge.pipelineRunValues.params,
                        shared_params: ghaFileYaml.sharedParams,
                        slash_command: undefined
                    }
                    hooks.push(hook);
                }
            }
        }
        if (ghaFileYaml.onPullRequestClose !== undefined) {
            for (const onPRClose of ghaFileYaml.onPullRequestClose) {
                for (const fileChangesMatch of onPRClose.triggerConditions.fileChangesMatchAny) {
                    const hook = {
                        repo_full_name: "",
                        branch: "",
                        file_changes_matcher: fileChangesMatch,
                        destination_branch_matcher: null,
                        hook: 'onPullRequestClose' as HookType,
                        hook_name: onPRClose.name,
                        pipeline_unique_prefix: `${ghaFileYaml.teamNamespace}-${ghaFileYaml.moduleName}-${onPRClose.name}`,
                        pipeline_name: onPRClose.pipelineRef.name,
                        pipeline_ref: onPRClose.pipelineRef.ref,
                        pipeline_params: onPRClose.pipelineRunValues.params,
                        shared_params: ghaFileYaml.sharedParams,
                        slash_command: undefined
                    }
                    hooks.push(hook);
                }
            }
        }
        if (ghaFileYaml.onSlashCommand !== undefined) {
            for (const onSlashCommand of ghaFileYaml.onSlashCommand) {
                for (const fileChangesMatch of onSlashCommand.triggerConditions.fileChangesMatchAny) {
                    for (const slashCommand of onSlashCommand.triggerConditions.slashCommands) {
                        const hook = {
                            repo_full_name: "",
                            branch: "",
                            file_changes_matcher: fileChangesMatch,
                            destination_branch_matcher: null,
                            hook: 'onSlashCommand' as HookType,
                            hook_name: onSlashCommand.name,
                            pipeline_unique_prefix: `${ghaFileYaml.teamNamespace}-${ghaFileYaml.moduleName}-${onSlashCommand.name}`,
                            pipeline_name: onSlashCommand.pipelineRef.name,
                            pipeline_ref: onSlashCommand.pipelineRef.ref,
                            pipeline_params: onSlashCommand.pipelineRunValues.params,
                            shared_params: ghaFileYaml.sharedParams,
                            slash_command: slashCommand
                        }
                        hooks.push(hook);
                    }
                }
            }
        }
        return hooks;
    }

    async loadAllGhaYamlForBranchIfNew(octokit: InstanceType<typeof ProbotOctokit>, repo_full_name: string, baseBranch: string) {
        const branchHooksCount = await gha_hooks(db).count({repo_full_name: repo_full_name, branch: baseBranch});
        if (branchHooksCount > 0) {
            this.log.info(`Branch ${baseBranch} exists in db for repo ${repo_full_name} with ${branchHooksCount} hooks`);
            return;
        }
        this.log.info(`Branch ${baseBranch} does not exist in db for repo ${repo_full_name}`);
        await this.loadAllGhaYaml(octokit, repo_full_name, baseBranch);
    }

    async deleteAllGhaHooksForBranch(fullName: string, branchName: string) {
        await gha_hooks(db).delete({repo_full_name: fullName, branch: branchName});
    }
}