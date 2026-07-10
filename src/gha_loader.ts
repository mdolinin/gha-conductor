import {Logger, ProbotOctokit} from "probot";
import {simpleGit} from "simple-git";
import path from "path";
import * as fs from "fs";
import {glob} from "glob";
import {load} from "js-yaml";
import db, {gha_hooks, sql} from "./db/database.js";
import {TheRootSchema} from "./gha_yaml.js";
import {HookType} from "./__generated__/_enums.js";
import {components} from "@octokit/openapi-types";
import {Ajv} from "ajv";
import {isNode, LineCounter, Node, parseDocument, YAMLSeq} from "yaml";
import {not} from "@databases/pg-typed";
import {Commit} from "@octokit/webhooks-types";
import type {Queryable} from "@databases/pg";
import schema from './schemas/gha_yaml_schema.json' with { type: "json" };

export interface GhaHook {
    repo_full_name: string,
    branch: string,
    branch_head_sha: string | undefined,
    file_changes_matcher: string,
    destination_branch_matcher: string | null,
    hook: HookType,
    hook_name: string,
    path_to_gha_yaml: string | undefined,
    pipeline_unique_prefix: string,
    pipeline_name: string,
    pipeline_ref: string | undefined,
    pipeline_params: any,
    shared_params: any,
    slash_command: string | undefined
}

const ajv = new Ajv({allErrors: true});
const validator = ajv.compile(schema);

export class GhaLoader {

    log: Logger;

    constructor(log: Logger) {
        this.log = log;
    }

    /**
     * Serializes all hook-cache mutations for a given (repo, branch) pair using a Postgres
     * transaction-scoped advisory lock. Without this, a `push` webhook and a `pull_request`
     * (open/merge) event for the same branch - which commonly fire together, since merging a PR
     * both moves the branch ref and closes the PR - can interleave their delete/insert/stamp
     * statements and leave the cache duplicated or stamped with a sha that doesn't reflect what
     * was actually written. The lock is released automatically when the transaction commits or
     * rolls back, so callers never need to unlock explicitly.
     *
     * Note this only serializes calls for the *same* (repo, branch) pair. It does not protect
     * loadAllGhaHooksFromRepo's git clone/checkout against two *different* branches of the same
     * repo being reloaded concurrently - that's what createGit() and the per-branch clone
     * directory below are for.
     */
    private async withBranchLock<T>(repo_full_name: string, branch: string, fn: (tx: Queryable) => Promise<T>): Promise<T | undefined> {
        try {
            return await db.tx(async (tx) => {
                await tx.query(sql`SELECT pg_advisory_xact_lock(hashtext(${repo_full_name}), hashtext(${branch}))`);
                return fn(tx);
            });
        } catch (e) {
            this.log.error(e, `Error acquiring hooks cache lock for branch ${branch} in repo ${repo_full_name}`);
            return undefined;
        }
    }

    // Overridable in tests. A fresh instance per call is required because each call gets its own
    // clone directory (see loadAllGhaHooksFromRepo) - a shared instance's cwd would otherwise be
    // mutated out from under concurrent calls for different branches of the same repo.
    private createGit() {
        return simpleGit();
    }

    async loadAllGhaHooksFromRepo(octokit: InstanceType<typeof ProbotOctokit>, full_name: string, branch: string, hooksFileName: string, tx?: Queryable): Promise<void> {
        if (!tx) {
            return this.withBranchLock(full_name, branch, (lockedTx) => this.loadAllGhaHooksFromRepo(octokit, full_name, branch, hooksFileName, lockedTx));
        }
        try {
            const git = this.createGit();
            const {token} = await octokit.auth({type: "installation"}) as Record<string, string>;
            this.log.debug(`Repo full name is ${full_name}`);
            // create temp dir, scoped per-branch so concurrent full-reloads for different
            // branches of the same repo don't clobber each other's clone
            const target = path.join(process.env.TMPDIR || '/tmp/', full_name, branch);
            this.log.debug(`Temp dir is ${target}`);
            if (fs.existsSync(target)) {
                fs.rmSync(target, {recursive: true, force: true});
            }
            fs.mkdirSync(target, {recursive: true});
            // clone repo
            let remote = `https://x-access-token:${token}@github.com/${full_name}.git`;
            const redactedRemote = `https://x-access-token:***@github.com/${full_name}.git`;
            this.log.debug(`Repo path is ${redactedRemote}`);
            const cloneResp = await git.clone(remote, target);
            if (cloneResp !== "") {
                this.log.error(`Error cloning ${redactedRemote} repo ${cloneResp}`);
                return;
            }
            // then set the working directory of this call's own instance - you want all future
            // tasks run through `git` to be from the new directory, rather than just tasks
            // chained off this task
            await git.cwd({path: target, root: true});
            if (branch !== "master" && branch !== "main") {
                const checkoutResp = await git.checkoutBranch(branch, `origin/${branch}`);
                this.log.debug("Checkout response is " + JSON.stringify(checkoutResp));
            }
            const branchHeadSha = (await git.revparse("HEAD")).trim();
            // find all hooks files in repo using glob lib
            const ghaYamlFiles = await glob(`**/${hooksFileName}`, {cwd: target});
            // parse yaml
            let newHooks: GhaHook[] = [];
            for (const ghaYamlFilePath of ghaYamlFiles) {
                this.log.info(`Found ${hooksFileName} file ${ghaYamlFilePath}`);
                const ghaFileYaml = load(fs.readFileSync(path.join(target, ghaYamlFilePath), "utf8"));
                this.log.debug(`Parsed yaml of ${ghaYamlFilePath} is ${JSON.stringify(ghaFileYaml)}`);
                const hooksFromFile = this.getGhaHooks(<TheRootSchema>ghaFileYaml, ghaYamlFilePath, full_name, branch, branchHeadSha);
                newHooks = newHooks.concat(hooksFromFile);
            }
            this.log.debug(`Reinserting all ${newHooks.length} hooks`);
            await gha_hooks(tx).delete({repo_full_name: full_name, branch: branch});
            await Promise.all(newHooks.map(hook => gha_hooks(tx).insert(hook)));
        } catch (e) {
            this.log.error(e, `Error loading hooks for repo ${full_name} branch ${branch}`);
        }
    }

    async validateGhaYamlFiles(octokit: InstanceType<typeof ProbotOctokit>, hooksFileName: string, data: components["schemas"]["diff-entry"][]) {
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
            if (!file.filename.endsWith(hooksFileName)) {
                continue;
            }
            this.log.info(`Validating file ${file.filename}`);
            try {
                const resp = await octokit.request(file.contents_url);
                const ghaFileContent = Buffer.from(resp.data.content, "base64").toString();
                const lineCounter = new LineCounter()
                try {
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
                            validator.errors?.forEach((error) => {
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
                                    const samePrefixHooks = await gha_hooks(db).find({
                                        pipeline_unique_prefix: pipelineUniquePrefix,
                                        path_to_gha_yaml: not(file.filename)
                                    }).all();
                                    if (samePrefixHooks.length > 0 || names.has(name)) {
                                        const {line, col} = this.getPosition(nameNode, lineCounter);
                                        let message = `Pipeline unique prefix ${pipelineUniquePrefix} is not unique`;
                                        if (names.has(name)) {
                                            message = message + " (duplicate name in the same file)";
                                        }
                                        if (samePrefixHooks.length > 0) {
                                            message = message + ` (same name used in ${samePrefixHooks.map((value: { path_to_gha_yaml: any; }) => value.path_to_gha_yaml).join(',')} files)`;
                                        }
                                        annotationsForCheck.push({
                                            annotation_level: "failure",
                                            message: message,
                                            path: file.filename,
                                            start_line: line,
                                            end_line: line,
                                            start_column: col,
                                            end_column: col
                                        });
                                    } else {
                                        names.add(name);
                                        this.log.debug(`Pipeline unique prefix ${pipelineUniquePrefix} is unique`);
                                    }
                                }
                            }
                            this.log.info(`Validation passed for file ${file.filename}`);
                        }
                    }
                } catch (e) {
                    this.log.warn(e, `Error during validation of file ${file.filename}`);
                    annotationsForCheck.push({
                        annotation_level: "failure",
                        message: String(e),
                        path: file.filename,
                        start_line: 1,
                        end_line: 1,
                        start_column: 1,
                        end_column: 1
                    })
                }
            } catch (e) {
                this.log.error(e, `Error loading file from url ${file.contents_url}`);
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

    async loadGhaHooksFromCommits(octokit: InstanceType<typeof ProbotOctokit>, repoFullName: string, branchName: string, ghaHooksFileName: string, commits: Commit[], headSha?: string, tx?: Queryable): Promise<void> {
        if (!tx) {
            return this.withBranchLock(repoFullName, branchName, (lockedTx) => this.loadGhaHooksFromCommits(octokit, repoFullName, branchName, ghaHooksFileName, commits, headSha, lockedTx));
        }
        for (const commit of commits) {
            for (const removedFile of commit.removed) {
                if (removedFile.endsWith(ghaHooksFileName)) {
                    this.log.info(`Removing hooks for file ${removedFile}`);
                    await gha_hooks(tx).delete({
                        repo_full_name: repoFullName,
                        branch: branchName,
                        path_to_gha_yaml: removedFile
                    });
                }
            }
            for (const addedFile of commit.added) {
                if (addedFile.endsWith(ghaHooksFileName)) {
                    this.log.info(`Adding hooks for file ${addedFile}`);
                    try {
                        const resp = await octokit.repos.getContent({
                            owner: repoFullName.split("/")[0],
                            repo: repoFullName.split("/")[1],
                            path: addedFile,
                            ref: branchName
                        });
                        if ("content" in resp.data) {
                            const ghaFileContent = Buffer.from(resp.data.content, "base64").toString();
                            const ghaFileYaml = load(ghaFileContent);
                            const hooks = this.getGhaHooks(<TheRootSchema>ghaFileYaml, addedFile, repoFullName, branchName, headSha);
                            this.log.debug(`Inserting ${hooks.length} hooks for file ${addedFile}`);
                            await Promise.all(hooks.map(hook => gha_hooks(tx).insert(hook)));
                        }
                    } catch (e) {
                        this.log.error(e, `Error loading file ${addedFile} from repo ${repoFullName} branch ${branchName}`);
                    }
                }
            }
            for (const modifiedFile of commit.modified) {
                if (modifiedFile.endsWith(ghaHooksFileName)) {
                    this.log.info(`Modifying hooks for file ${modifiedFile}`);
                    try {
                        const resp = await octokit.repos.getContent({
                            owner: repoFullName.split("/")[0],
                            repo: repoFullName.split("/")[1],
                            path: modifiedFile,
                            ref: branchName
                        });
                        if ("content" in resp.data) {
                            const ghaFileContent = Buffer.from(resp.data.content, "base64").toString();
                            const ghaFileYaml = load(ghaFileContent);
                            const hooks = this.getGhaHooks(<TheRootSchema>ghaFileYaml, modifiedFile, repoFullName, branchName, headSha);
                            this.log.debug(`Deleting and inserting ${hooks.length} hooks for file ${modifiedFile}`);
                            await gha_hooks(tx).delete({
                                repo_full_name: repoFullName,
                                branch: branchName,
                                path_to_gha_yaml: modifiedFile
                            });
                            await Promise.all(hooks.map(hook => gha_hooks(tx).insert(hook)));
                        }
                    } catch (e) {
                        this.log.error(e, `Error loading file ${modifiedFile} from repo ${repoFullName} branch ${branchName}`);
                    }
                }
            }
        }
        if (headSha) {
            // Stamp every cached row for this branch with the push's resulting HEAD sha, not just the
            // files touched above, so a later staleness check (comparing a single cached sha against the
            // branch's current HEAD) reflects this push even for files it didn't touch.
            await gha_hooks(tx).update({repo_full_name: repoFullName, branch: branchName}, {branch_head_sha: headSha});
        }
    }

    async loadGhaHooks(octokit: InstanceType<typeof ProbotOctokit>, hooksFileName: string, data: components["schemas"]["diff-entry"][]): Promise<{
        hooks: GhaHook[];
        hookFilesModified: Set<string>
    }> {
        let hooks: GhaHook[] = [];
        const hookFilesModified = new Set<string>();
        for (const file of data) {
            // if file was renamed check if previous name ends with hooksFileName
            if (file.status === "renamed") {
                const previousFileName = file.previous_filename;
                if (previousFileName && previousFileName.endsWith(hooksFileName)) {
                    this.log.debug(`File ${file.filename} was renamed from ${previousFileName}`);
                    hookFilesModified.add(previousFileName);
                    continue;
                }
            }
            if (!file.filename.endsWith(hooksFileName)) {
                continue;
            }
            if (file.status === "removed") {
                this.log.debug(`File ${file.filename} with hooks was removed`);
                hookFilesModified.add(file.filename);
                continue;
            }
            this.log.info(`Loading hooks for file ${file.filename}`);
            try {
                const resp = await octokit.request(file.contents_url);
                const ghaFileContent = Buffer.from(resp.data.content, "base64").toString();
                const ghaFileYaml = load(ghaFileContent);
                hooks = hooks.concat(this.getGhaHooks(<TheRootSchema>ghaFileYaml, file.filename));
                hookFilesModified.add(file.filename);
            } catch (e) {
                this.log.error(e, `Error loading file from url ${file.contents_url}`);
            }
        }
        return {hooks, hookFilesModified};
    }

    private getGhaHooks(ghaFileYaml: TheRootSchema, ghaYamlFilePath: string, repoFullName: string = "", branch: string = "", branchHeadSha: string | undefined = undefined): GhaHook[] {
        const hooks: GhaHook[] = [];
        if (ghaFileYaml.onPullRequest !== undefined) {
            for (const onPR of ghaFileYaml.onPullRequest) {
                for (const fileChangesMatch of onPR.triggerConditions.fileChangesMatchAny) {
                    const hook = {
                        repo_full_name: repoFullName,
                        branch: branch,
                        branch_head_sha: branchHeadSha,
                        file_changes_matcher: fileChangesMatch,
                        destination_branch_matcher: null,
                        hook: 'onPullRequest' as HookType,
                        hook_name: onPR.name,
                        path_to_gha_yaml: ghaYamlFilePath,
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
        }
        if (ghaFileYaml.onBranchMerge !== undefined) {
            for (const onBranchMerge of ghaFileYaml.onBranchMerge) {
                for (const fileChangesMatch of onBranchMerge.triggerConditions.fileChangesMatchAny) {
                    for (const destinationBranchMatch of onBranchMerge.triggerConditions.destinationBranchMatchesAny) {
                        const hook = {
                            repo_full_name: repoFullName,
                            branch: branch,
                            branch_head_sha: branchHeadSha,
                            file_changes_matcher: fileChangesMatch,
                            destination_branch_matcher: destinationBranchMatch,
                            hook: 'onBranchMerge' as HookType,
                            hook_name: onBranchMerge.name,
                            path_to_gha_yaml: ghaYamlFilePath,
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
        }
        if (ghaFileYaml.onPullRequestClose !== undefined) {
            for (const onPRClose of ghaFileYaml.onPullRequestClose) {
                for (const fileChangesMatch of onPRClose.triggerConditions.fileChangesMatchAny) {
                    const hook = {
                        repo_full_name: repoFullName,
                        branch: branch,
                        branch_head_sha: branchHeadSha,
                        file_changes_matcher: fileChangesMatch,
                        destination_branch_matcher: null,
                        hook: 'onPullRequestClose' as HookType,
                        hook_name: onPRClose.name,
                        path_to_gha_yaml: ghaYamlFilePath,
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
                            branch_head_sha: branchHeadSha,
                            file_changes_matcher: fileChangesMatch,
                            destination_branch_matcher: null,
                            hook: 'onSlashCommand' as HookType,
                            hook_name: onSlashCommand.name,
                            path_to_gha_yaml: ghaYamlFilePath,
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

    async loadAllGhaYamlForBranchIfNew(octokit: InstanceType<typeof ProbotOctokit>, repo_full_name: string, baseBranch: string, hooksFileName: string): Promise<void> {
        return this.withBranchLock(repo_full_name, baseBranch, async (tx) => {
            const branchHooksCount = await gha_hooks(tx).count({repo_full_name, branch: baseBranch});
            if (branchHooksCount === 0) {
                this.log.info(`Branch ${baseBranch} does not exist in db for repo ${repo_full_name}`);
                await this.loadAllGhaHooksFromRepo(octokit, repo_full_name, baseBranch, hooksFileName, tx);
                return;
            }
            this.log.debug(`Branch ${baseBranch} exists in db for repo ${repo_full_name} with ${branchHooksCount} hooks. Checking if cache is stale`);
            await this.reconcileStaleBranchHooks(octokit, repo_full_name, baseBranch, hooksFileName, tx);
        });
    }

    /**
     * A cached branch's hooks can go stale if a webhook for a direct push to that branch is ever
     * missed or fails to process (e.g. a delivery outage) - there is no other signal that would tell
     * us the cache no longer matches the branch's actual .gha-conductor.yaml content. Rather than
     * trusting the cache forever once a branch is "known", compare the sha it was last synced at
     * against the branch's current HEAD and, on a mismatch, reconcile just the hook files that
     * changed in between (or do a full reload if we have no baseline to diff from).
     */
    private async reconcileStaleBranchHooks(octokit: InstanceType<typeof ProbotOctokit>, repo_full_name: string, branch: string, hooksFileName: string, tx: Queryable) {
        const [owner, repo] = repo_full_name.split("/");
        let currentHeadSha: string;
        try {
            const {data} = await octokit.repos.getBranch({owner, repo, branch});
            currentHeadSha = data.commit.sha;
        } catch (e) {
            this.log.error(e, `Failed to fetch current HEAD for branch ${branch} in repo ${repo_full_name}. Skipping staleness check`);
            return;
        }
        const cachedSha = await this.getCachedBranchHeadSha(repo_full_name, branch, tx);
        if (cachedSha === currentHeadSha) {
            this.log.debug(`Branch ${branch} hooks cache in repo ${repo_full_name} is up to date at ${currentHeadSha}`);
            return;
        }
        if (!cachedSha) {
            this.log.warn(`Branch ${branch} in repo ${repo_full_name} has cached hooks with no recorded commit sha (predates staleness tracking). Forcing full reload to establish a baseline`);
            await this.loadAllGhaHooksFromRepo(octokit, repo_full_name, branch, hooksFileName, tx);
            return;
        }
        this.log.info(`Branch ${branch} hooks cache in repo ${repo_full_name} is stale (cached at ${cachedSha}, current HEAD is ${currentHeadSha}). Reconciling`);
        await this.reconcileGhaHooksBetweenCommits(octokit, repo_full_name, branch, hooksFileName, cachedSha, currentHeadSha, tx);
    }

    private async getCachedBranchHeadSha(repo_full_name: string, branch: string, tx: Queryable): Promise<string | undefined> {
        // There can be thousands of rows for a single branch; we only need any one of them since
        // loadAllGhaHooksFromRepo/loadGhaHooksFromCommits/reconcileGhaHooksBetweenCommits all stamp
        // every row for a branch with the same sha. orderByAsc().first() avoids pg-typed's "multiple
        // results" error that .one() would throw given more than one matching row.
        const row = await gha_hooks(tx).find({repo_full_name, branch}).select("branch_head_sha").orderByAsc("branch_head_sha").first();
        return row?.branch_head_sha ?? undefined;
    }

    private async reconcileGhaHooksBetweenCommits(octokit: InstanceType<typeof ProbotOctokit>, repo_full_name: string, branch: string, hooksFileName: string, baseSha: string, headSha: string, tx: Queryable) {
        const [owner, repo] = repo_full_name.split("/");
        try {
            const {data} = await octokit.repos.compareCommitsWithBasehead({owner, repo, basehead: `${baseSha}...${headSha}`});
            const changedFiles = (data.files ?? []).filter(file =>
                file.filename.endsWith(hooksFileName) ||
                (file.status === "renamed" && file.previous_filename?.endsWith(hooksFileName))
            );
            for (const file of changedFiles) {
                const renamedFromHooksFile = file.status === "renamed" && file.previous_filename?.endsWith(hooksFileName);
                if (file.status === "removed" || renamedFromHooksFile) {
                    const stalePath = renamedFromHooksFile ? file.previous_filename! : file.filename;
                    this.log.info(`Removing hooks for file ${stalePath} on branch ${branch} in repo ${repo_full_name} (reconciliation)`);
                    await gha_hooks(tx).delete({repo_full_name, branch, path_to_gha_yaml: stalePath});
                }
                if (file.status === "removed" || !file.filename.endsWith(hooksFileName)) {
                    continue;
                }
                this.log.info(`Reloading hooks for file ${file.filename} on branch ${branch} in repo ${repo_full_name} (reconciliation)`);
                try {
                    const resp = await octokit.repos.getContent({owner, repo, path: file.filename, ref: headSha});
                    if ("content" in resp.data) {
                        const ghaFileContent = Buffer.from(resp.data.content, "base64").toString();
                        const ghaFileYaml = load(ghaFileContent);
                        const hooks = this.getGhaHooks(<TheRootSchema>ghaFileYaml, file.filename, repo_full_name, branch, headSha);
                        await gha_hooks(tx).delete({repo_full_name, branch, path_to_gha_yaml: file.filename});
                        await Promise.all(hooks.map(hook => gha_hooks(tx).insert(hook)));
                    }
                } catch (e) {
                    this.log.error(e, `Error reconciling hooks for file ${file.filename} on branch ${branch} in repo ${repo_full_name}`);
                }
            }
            // Stamp every row for this branch with the new head sha, including files untouched by this
            // diff, so the next staleness check has a single consistent baseline to compare against.
            await gha_hooks(tx).update({repo_full_name, branch}, {branch_head_sha: headSha});
            this.log.info(`Reconciled ${changedFiles.length} hook file(s) for branch ${branch} in repo ${repo_full_name} up to ${headSha}`);
        } catch (e) {
            this.log.error(e, `Error comparing commits ${baseSha}...${headSha} for branch ${branch} in repo ${repo_full_name}. Falling back to full reload`);
            await this.loadAllGhaHooksFromRepo(octokit, repo_full_name, branch, hooksFileName, tx);
        }
    }

    async countHooksForBranch(repo_full_name: string, branch: string): Promise<number> {
        return await gha_hooks(db).count({repo_full_name: repo_full_name, branch: branch});
    }

    async deleteAllGhaHooksForBranch(fullName: string, branchName: string): Promise<void> {
        return this.withBranchLock(fullName, branchName, async (tx) => {
            await gha_hooks(tx).delete({repo_full_name: fullName, branch: branchName});
        });
    }
}