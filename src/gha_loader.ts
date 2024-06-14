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
import {GhaHooks} from "./__generated__";
import Ajv from "ajv";
import {isNode, LineCounter, Node, parseDocument, YAMLSeq} from "yaml";

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

const schemaJson = JSON.parse(fs.readFileSync(path.join(__dirname, "gha_yaml_schema.json"), "utf8"));
const ajv = new Ajv({allErrors: true});
const validator = ajv.compile(schemaJson);

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
        let newHooks: GhaHook[] = [];
        for (const ghaYamlFilePath of ghaYamlFiles) {
            this.log.info("Found .gha.yaml file " + ghaYamlFilePath);
            const ghaFileYaml = load(fs.readFileSync(path.join(target, ghaYamlFilePath), "utf8"));
            this.log.debug(`Parsed yaml of ${ghaYamlFilePath} is ${JSON.stringify(ghaFileYaml)}`);
            const hooksFromFile = this.getGhaHooks(<TheRootSchema>ghaFileYaml, full_name, branch);
            newHooks = newHooks.concat(hooksFromFile);
        }
        // reconcile with existing hooks
        const existingHooks = await gha_hooks(db).find({repo_full_name: full_name, branch: branch}).all();
        const hooksToDelete = existingHooks.filter(existingHook => !newHooks.some(hook => hook.pipeline_unique_prefix === existingHook.pipeline_unique_prefix));
        const hooksToUpdate: GhaHooks[] = [];
        existingHooks.forEach(existingHook => {
            const newHook = newHooks.find(hook => hook.pipeline_unique_prefix === existingHook.pipeline_unique_prefix);
            if (newHook !== undefined) {
                hooksToUpdate.push(
                    {
                        ...existingHook,
                        file_changes_matcher: newHook.file_changes_matcher,
                        destination_branch_matcher: newHook.destination_branch_matcher,
                        hook: newHook.hook,
                        hook_name: newHook.hook_name,
                        pipeline_name: newHook.pipeline_name,
                        pipeline_ref: newHook.pipeline_ref || null,
                        pipeline_params: newHook.pipeline_params,
                        shared_params: newHook.shared_params,
                        slash_command: newHook.slash_command || null
                    });
            }
        })
        const hooksToInsert = newHooks.filter(newHook => !existingHooks.some(hook => hook.pipeline_unique_prefix === newHook.pipeline_unique_prefix));

        this.log.debug(`Hooks to delete count: ${hooksToDelete.length}`);
        await Promise.all(hooksToDelete.map(hook => gha_hooks(db).delete({id: hook.id})));
        this.log.debug(`Hooks to update count: ${hooksToUpdate.length}`);
        await Promise.all(hooksToUpdate.map(hook => gha_hooks(db).update({id: hook.id}, hook)));
        this.log.debug(`Hooks to insert count: ${hooksToInsert.length}`);
        await Promise.all(hooksToInsert.map(hook => gha_hooks(db).insert(hook)));
    }

    async validateGhaYamlFiles(octokit: InstanceType<typeof ProbotOctokit>, data: components["schemas"]["diff-entry"][]) {
        const annotationsForCheck: {
            annotation_level: "failure" | "notice" | "warning",
            message: string,
            path: string,
            start_line: number,
            end_line: number
            start_column: number,
            end_column: number
        }[] = [];
        for (const file of data) {
            if (!file.filename.endsWith(".gha.yaml")) {
                continue;
            }
            this.log.info(`Validating file ${file.filename}`);
            const resp = await octokit.request(file.contents_url);
            if (resp.status !== 200) {
                this.log.error(`Error loading file ${file.filename}`);
                continue;
            }
            const ghaFileContent = Buffer.from(resp.data.content, "base64").toString();
            const lineCounter = new LineCounter()
            const ghaFileDoc = parseDocument(ghaFileContent, {lineCounter})
            if (ghaFileDoc.errors.length > 0) {
                ghaFileDoc.errors.forEach(error => {
                    const {line, col} = lineCounter.linePos(error.pos[0]);
                    this.log.warn(`${line}:${col} ${error.message}`);
                    annotationsForCheck.push({
                        annotation_level: "failure",
                        message: error.message,
                        path: file.filename,
                        start_line: line,
                        end_line: line,
                        start_column: col,
                        end_column: col
                    });
                });
            } else {
                validator(ghaFileDoc.toJSON())
                if (validator.errors) {
                    validator.errors?.forEach(error => {
                        const propertyPath = error.instancePath.split("/").slice(1);
                        const node = ghaFileDoc.getIn(propertyPath, true);
                        const {line, col} = this.getPosition(node, lineCounter);
                        annotationsForCheck.push({
                            annotation_level: "failure",
                            message: error.message || "Unknown error",
                            path: file.filename,
                            start_line: line,
                            end_line: line,
                            start_column: col,
                            end_column: col
                        });
                    });
                } else {
                    // validate that pipeline unique prefix is unique `${teamNamespace}-${moduleName}-${name}`
                    const teamNamespaceNode = ghaFileDoc.getIn(["teamNamespace"], true) as Node;
                    const teamNamespace = teamNamespaceNode.toString();
                    const moduleNameNode = ghaFileDoc.getIn(["moduleName"], true) as Node;
                    const moduleName = moduleNameNode.toString();
                    const names = new Set<string>();
                    for (const hook of ["onPullRequest", "onBranchMerge", "onPullRequestClose", "onSlashCommand"]) {
                        const onNode = ghaFileDoc.getIn([hook], true) as YAMLSeq;
                        if (onNode === undefined) {
                            continue;
                        }
                        for (const _ of onNode.items) {
                            const index = onNode.items.indexOf(_);
                            const nameNode = ghaFileDoc.getIn([hook, index, 'name'], true) as Node;
                            const name = nameNode.toString();
                            const pipelineUniquePrefix = `${teamNamespace}-${moduleName}-${name}`;
                            const samePrefixCount = await gha_hooks(db).count({pipeline_unique_prefix: pipelineUniquePrefix})
                            if (samePrefixCount > 0 || names.has(name)) {
                                const {line, col} = this.getPosition(nameNode, lineCounter);
                                annotationsForCheck.push({
                                    annotation_level: "failure",
                                    message: `Pipeline unique prefix ${pipelineUniquePrefix} is not unique`,
                                    path: file.filename,
                                    start_line: line,
                                    end_line: line,
                                    start_column: col,
                                    end_column: col
                                });
                            } else {
                                this.log.debug(`Pipeline unique prefix ${pipelineUniquePrefix} is unique`);
                            }
                        }
                    }
                    this.log.info(`Validation passed for file ${file.filename}`);
                }
            }
        }
        return annotationsForCheck;
    }

    private getPosition(node: any, lineCounter: LineCounter, line: number = 0, col: number = 0) {
        if (isNode(node) && node.range) {
            const linePos = lineCounter.linePos(node.range[0]);
            line = linePos.line;
            col = linePos.col;
        }
        return {line, col};
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

    private getGhaHooks(ghaFileYaml: TheRootSchema, repoFullName: string = "", branch: string = ""): GhaHook[] {
        const hooks: GhaHook[] = [];
        for (const onPR of ghaFileYaml.onPullRequest) {
            for (const fileChangesMatch of onPR.triggerConditions.fileChangesMatchAny) {
                const hook = {
                    repo_full_name: repoFullName,
                    branch: branch,
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
                        repo_full_name: repoFullName,
                        branch: branch,
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
                        repo_full_name: repoFullName,
                        branch: branch,
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
                            repo_full_name: repoFullName,
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