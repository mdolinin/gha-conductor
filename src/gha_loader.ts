import {ProbotOctokit} from "probot";
import {DeprecatedLogger} from "probot/lib/types";
import simpleGit from "simple-git";
import path from "path";
import * as fs from "fs";
import {glob} from "glob";
import {load} from "js-yaml";
import db, {gha_hooks} from "./db/database";
import {TheRootSchema} from "./gha_yaml";
import {HookType} from "./__generated__/_enums";

export class GhaLoader {

    git = simpleGit();

    async loadAllGhaYaml(octokit: InstanceType<typeof ProbotOctokit>, full_name: string, log: DeprecatedLogger) {
        const {token} = await octokit.auth({type: "installation"}) as Record<string, string>;
        log.info("Token is " + token);
        log.info("Full name is " + full_name);
        // create temp dir
        const target = path.join(process.env.TMPDIR || '/tmp/', full_name);
        log.info("Temp dir is " + target);
        if (fs.existsSync(target)) {
            fs.rm(target, {recursive: true, force: true}, (err) => {
                if (err) {
                    log.info("Error deleting temp dir " + err);
                } else {
                    log.info("Temp dir deleted");
                }
            });
        }
        fs.mkdirSync(target, {recursive: true});
        // clone repo
        let remote = `https://x-access-token:${token}@github.com/${full_name}.git`;
        log.info("Repo path is " + remote);
        const resp = await this.git.clone(remote, target).cwd({path: target});
        if (resp === undefined || resp !== target) {
            log.info("Clone failed");
            return;
        }
        // find all .gha.yaml files in repo using glob lib
        const ghaYamlFiles = await glob("**/.gha.yaml", {cwd: target});
        // parse yaml
        // delete all hooks for db before upserting
        await gha_hooks(db).delete({repo_full_name: full_name});
        for (const ghaYamlFilePath of ghaYamlFiles) {
            log.info("Found .gha.yaml file " + ghaYamlFilePath);
            const ghaFileYaml = load(fs.readFileSync(path.join(target, ghaYamlFilePath), "utf8"));
            log.info("Parsed yaml of " + ghaYamlFilePath + " is " + JSON.stringify(ghaFileYaml));
            await this.upsertGHAHooks(full_name, <TheRootSchema>ghaFileYaml);
        }
    }

    private async upsertGHAHooks(full_name: string, ghaFileYaml: TheRootSchema) {
        // iterate over onPullRequest hooks and store in db
        for (const onPR of ghaFileYaml.onPullRequest) {
            for (const fileChangesMatch of onPR.triggerConditions.fileChangesMatchAny) {
                const hook = {
                    repo_full_name: full_name,
                    file_changes_matcher: fileChangesMatch,
                    destination_branch_matcher: null,
                    hook: 'onPullRequest' as HookType,
                    hook_name: onPR.name,
                    pipeline_unique_prefix: `${ghaFileYaml.teamNamespace}-${ghaFileYaml.moduleName}-${onPR.name}`,
                    pipeline_name: onPR.pipelineRef.name,
                    pipeline_ref: null,
                    pipeline_params: onPR.pipelineRunValues.params,
                    shared_params: ghaFileYaml.sharedParams
                }
                await gha_hooks(db).insert(hook);
            }
        }
        // iterate over onBranchMerge hooks and store in db
        for (const onBranchMerge of ghaFileYaml.onBranchMerge) {
            for (const fileChangesMatch of onBranchMerge.triggerConditions.fileChangesMatchAny) {
                for(const destinationBranchMatch of onBranchMerge.triggerConditions.destinationBranchMatchesAny) {
                    const hook = {
                        repo_full_name: full_name,
                        file_changes_matcher: fileChangesMatch,
                        destination_branch_matcher: destinationBranchMatch,
                        hook: 'onBranchMerge' as HookType,
                        hook_name: onBranchMerge.name,
                        pipeline_unique_prefix: `${ghaFileYaml.teamNamespace}-${ghaFileYaml.moduleName}-${onBranchMerge.name}`,
                        pipeline_name: onBranchMerge.pipelineRef.name,
                        pipeline_ref: null,
                        pipeline_params: onBranchMerge.pipelineRunValues.params,
                        shared_params: ghaFileYaml.sharedParams
                    }
                    await gha_hooks(db).insert(hook);
                }
            }
        }
    }
}