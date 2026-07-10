import {vi, describe, beforeEach, afterEach, expect, it} from "vitest";
import {GhaLoader} from "../src/gha_loader.js";
import {Logger} from "probot";
import * as fs from "fs";

const cloneMock = vi.fn().mockReturnValue(Promise.resolve(""));
const cwdMock = vi.fn();
const checkoutBranchMock = vi.fn();
const revparseMock = vi.fn().mockReturnValue(Promise.resolve("branchheadsha1234567890\n"));
const globMock = vi.fn().mockImplementation(() => {
    return ["folder1/.gha.yaml", "folder2/.gha.yaml"];
});
const findAllMock = vi.fn().mockReturnValue([
    {
        repo_full_name: "repo_full_name",
        branch: "branch",
        hook: "onPullRequest",
        hook_name: "build",
        pipeline_name: "common-job",
        pipeline_ref: "main",
        pipeline_run_values: {params: {COMMAND: "make build"}},
        trigger_conditions: {fileChangesMatchAny: ["namespaces/domain-b/projects/example-c/**"]},
        shared_params: {ROOT_DIR: "namespaces/domain-b/projects/example-c"},
        pipeline_unique_prefix: "domain-b-example-c-build",
        path_to_gha_yaml: "folder1/.gha.yaml"
    },
    {
        repo_full_name: "repo_full_name",
        branch: "branch",
        hook: "onPullRequest",
        hook_name: "remove",
        pipeline_name: "common-job",
        pipeline_ref: "main",
        pipeline_run_values: {params: {COMMAND: "make remove"}},
        trigger_conditions: {fileChangesMatchAny: ["namespaces/domain-b/projects/example-c/**"]},
        shared_params: {ROOT_DIR: "namespaces/domain-b/projects/example-c"},
        pipeline_unique_prefix: "domain-b-example-c-remove",
        path_to_gha_yaml: "folder2/.gha.yaml"
    }
]);
const firstMock = vi.fn().mockReturnValue(Promise.resolve(null));
const orderByAscMock = vi.fn().mockImplementation(() => {
    return {
        first: firstMock
    }
});
const selectMock = vi.fn().mockImplementation(() => {
    return {
        orderByAsc: orderByAscMock
    }
});
const findMock = vi.fn().mockImplementation(() => {
    return {
        all: findAllMock,
        select: selectMock
    }
});
const deleteMock = vi.fn();
const updateMock = vi.fn();
const insertMock = vi.fn();
const countMock = vi.fn().mockReturnValue(0);
// gha_hooks(x) below ignores whatever connection/transaction object it's given and always
// returns the same set of mocks, so the fake "tx" handed to callers here can be a bare stub -
// it only needs enough shape to satisfy withBranchLock's advisory-lock query.
const txQueryMock = vi.fn().mockReturnValue(Promise.resolve([]));
const dbTxMock = vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => {
    return fn({query: txQueryMock});
});

vi.mock('glob', () => {
    return {
        glob: () => globMock()
    }
});

vi.mock('../src/db/database', async (importOriginal) => {
    const mod = await importOriginal();
    return {
        // @ts-ignore
        ...mod,
        default: {tx: (fn: (tx: unknown) => unknown) => dbTxMock(fn)},
        gha_hooks: vi.fn(() => {
            return {
                find: findMock,
                delete: deleteMock,
                update: updateMock,
                insert: insertMock,
                count: countMock
            };
        })
    }
});

const ghaYamlExample = `
moduleName: example-c
teamNamespace: domain-b

sharedParams:
  ROOT_DIR: "namespaces/domain-b/projects/example-c"

defaultFileChangeTrigger: &defaultFileChangeTrigger
  - "namespaces/domain-b/projects/example-c/**"

onPullRequest:
  - name: build
    pipelineRef:
      name: common-job
      ref: main
    pipelineRunValues:
      params:
        COMMAND: make build
    triggerConditions:
      fileChangesMatchAny: *defaultFileChangeTrigger

  - name: test
    pipelineRef:
      name: common-job
    pipelineRunValues:
      params:
        COMMAND: make test
    triggerConditions:
      fileChangesMatchAny:
        - "namespaces/domain-b/projects/example-c/tests/test.sh"

onBranchMerge:
  - name: release
    pipelineRef:
      name: common-job
    pipelineRunValues:
      params:
        COMMAND: >-
          make release
    triggerConditions:
      destinationBranchMatchesAny:
        - 'main'
      fileChangesMatchAny: *defaultFileChangeTrigger

onPullRequestClose:
  - name: cleanup
    pipelineRef:
      name: common-job
    pipelineRunValues:
      params:
        COMMAND: >-
          make clean
    triggerConditions:
      destinationBranchMatchesAny:
        - 'main'
      fileChangesMatchAny: *defaultFileChangeTrigger

onSlashCommand:
  - name: validate-before-merge
    pipelineRef:
      name: generic-job
    pipelineRunValues:
      params:
        COMMAND: make \${command} \${args}
    triggerConditions:
      slashCommands:
        - "validate"
      fileChangesMatchAny: *defaultFileChangeTrigger
`;

let readFileSyncMockCounter = 0;

vi.mock('fs', async (importOriginal) => {
    const mod = await importOriginal();
    return {
        // @ts-ignore
        ...mod,
        existsSync: vi.fn().mockReturnValue(true),
        rmSync: vi.fn(),
        mkdirSync: vi.fn(),
        readFileSync: vi.fn().mockImplementation((path: string, options: string) => {
            readFileSyncMockCounter++;
            if (path.includes(".gha.yaml")) {
                return ghaYamlExample;
            }
            // @ts-ignore
            return mod.readFileSync(path, options);
        }),
        statSync: vi.fn().mockImplementation(() => {
            return {
                isFile: vi.fn().mockReturnValue(false),
                isDirectory: vi.fn().mockReturnValue(true)
            }
        })
    }
});

const logMock = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
};

describe('gha loader', () => {
    const ghaLoader = new GhaLoader(logMock as unknown as Logger);

    beforeEach(() => {
        // @ts-ignore
        ghaLoader.createGit = () => ({
            clone: cloneMock,
            cwd: cwdMock,
            checkoutBranch: checkoutBranchMock,
            revparse: revparseMock
        });
    });

    afterEach(() => {
        readFileSyncMockCounter = 0;
        vi.clearAllMocks();
    });

    it('should load all gha yaml files from github repo and reinsert all hooks into db, when repo and branch provided to loader', async () => {
        const octokit = {
            auth: vi.fn().mockImplementation(() => {
                return {
                    token: "sekret-installation-token"
                }
            }),
        };
        // @ts-ignore
        await ghaLoader.loadAllGhaHooksFromRepo(octokit, "repo_full_name", "branch", ".gha.yaml");
        expect(octokit.auth).toHaveBeenCalledWith({type: "installation"});
        expect(cloneMock).toHaveBeenCalledWith("https://x-access-token:sekret-installation-token@github.com/repo_full_name.git", expect.stringMatching(RegExp('.*repo_full_name')));
        expect(cwdMock).toHaveBeenCalledWith({path: expect.stringMatching(RegExp('.*repo_full_name')), root: true});
        expect(checkoutBranchMock).toHaveBeenCalledWith("branch", "origin/branch");
        expect(globMock).toHaveBeenCalled();
        expect(readFileSyncMockCounter).toBe(2);
        expect(deleteMock).toHaveBeenCalledTimes(1)
        expect(insertMock).toHaveBeenCalledTimes(10);
        for (const mockFn of [logMock.debug, logMock.info, logMock.warn, logMock.error]) {
            for (const call of mockFn.mock.calls) {
                expect(call.join(' ')).not.toContain("sekret-installation-token");
            }
        }
    });

    it('should not leak the installation token in logs, when cloning the repo fails', async () => {
        const octokit = {
            auth: vi.fn().mockImplementation(() => {
                return {
                    token: "sekret-clone-failure-token"
                }
            }),
        };
        cloneMock.mockReturnValueOnce(Promise.resolve("fatal: could not clone"));
        // @ts-ignore
        await ghaLoader.loadAllGhaHooksFromRepo(octokit, "repo_full_name", "branch", ".gha.yaml");
        expect(logMock.error).toHaveBeenCalledWith("Error cloning https://x-access-token:***@github.com/repo_full_name.git repo fatal: could not clone");
        for (const mockFn of [logMock.debug, logMock.info, logMock.warn, logMock.error]) {
            for (const call of mockFn.mock.calls) {
                expect(call.join(' ')).not.toContain("sekret-clone-failure-token");
            }
        }
    });

    it('should check yaml is valid, when gha yaml file is changed in PR', async () => {
        const ghaYamlNotValid = `
        moduleName: 
        -example-c
        teamNamespace: domain-b
        
        sharedParams:
          ROOT_DIR: "namespaces/domain-b/projects/example-c"
        
        defaultFileChangeTrigger: &defaultFileChangeTrigger
          - "namespaces/domain-b/projects/example-c/**"
        
        onPullRequest:
          - name: build
            pipelineRef:
              name: common-job
              ref: main
            pipelineRunValues:
              params:
                COMMAND: make build
            triggerConditions:
              fileChangesMatchAny: *defaultFileChangeTrigger
        
        onBranchMerge: []
        `;
        const octokit = {
            request: vi.fn().mockImplementation(() => {
                return {
                    data: {
                        content: Buffer.from(ghaYamlNotValid).toString('base64'),
                    },
                    status: 200
                }
            }),
        };
        const diffEntries = [
            {
                filename: ".gha.yaml",
                contents_url: "contents_url",
            },
            {
                filename: "test.sh",
                contents_url: "contents_url1",
            }
        ];
        // @ts-ignore
        const annotationsForCheck = await ghaLoader.validateGhaYamlFiles(octokit, ".gha.yaml", diffEntries);
        expect(annotationsForCheck).toEqual([
            {
                annotation_level: "failure",
                end_column: 9,
                end_line: 3,
                message: "Implicit keys need to be on a single line at line 3, column 9:\n\n        moduleName: \n        -example-c\n        ^\n",
                path: ".gha.yaml",
                start_column: 9,
                start_line: 3
            }
        ]);
        expect(octokit.request).toHaveBeenCalledWith("contents_url");
        expect(findMock).not.toHaveBeenCalled();
        expect(findAllMock).not.toHaveBeenCalled();
    });

    it('should validate against json schema, when gha yaml file is changed in PR', async () => {
        const ghaYamlMissingRequiredParam = `
        moduleName: example-c
        teamNamespace: domain-b
        
        sharedParams:
          ROOT_DIR: "namespaces/domain-b/projects/example-c"
        
        defaultFileChangeTrigger: &defaultFileChangeTrigger
          - "namespaces/domain-b/projects/example-c/**"
        
        onPullRequest:
          - name: build
            pipelineRef:
              name: common-job
              ref: main
            pipelineRunValues:
              params:
                COMMAND: make build
            trigger2Conditions:
              fileChangesMatchAny: *defaultFileChangeTrigger
        
        onBranchMerge: []
        `;
        const octokit = {
            request: vi.fn().mockImplementation(() => {
                return {
                    data: {
                        content: Buffer.from(ghaYamlMissingRequiredParam).toString('base64'),
                    },
                    status: 200
                }
            }),
        };
        const diffEntries = [
            {
                filename: ".gha.yaml",
                contents_url: "contents_url",
            },
            {
                filename: "test.sh",
                contents_url: "contents_url1",
            }
        ];
        // @ts-ignore
        const annotationsForCheck = await ghaLoader.validateGhaYamlFiles(octokit, ".gha.yaml", diffEntries);
        expect(annotationsForCheck).toEqual([
            {
                annotation_level: "failure",
                end_column: 13,
                end_line: 12,
                message: "must have required property 'triggerConditions'",
                path: ".gha.yaml",
                start_column: 13,
                start_line: 12,
            },
            {
                annotation_level: "failure",
                end_column: 13,
                end_line: 12,
                message: "must match a schema in anyOf",
                path: ".gha.yaml",
                start_column: 13,
                start_line: 12,
            }
        ]);
        expect(octokit.request).toHaveBeenCalledWith("contents_url");
        expect(findMock).not.toHaveBeenCalled();
        expect(findAllMock).not.toHaveBeenCalled();
    });

    it('should validate that pipeline unique prefix is unique, when gha yaml file is changed in PR', async () => {
        const ghaYamlWithNonUniqueNames = `
        moduleName: example-c
        teamNamespace: domain-b
        
        sharedParams:
          ROOT_DIR: "namespaces/domain-b/projects/example-c"
        
        defaultFileChangeTrigger: &defaultFileChangeTrigger
          - "namespaces/domain-b/projects/example-c/**"
        
        onPullRequest:
          - name: build
            pipelineRef:
              name: common-job
              ref: main
            pipelineRunValues:
              params:
                COMMAND: make build
            triggerConditions:
              fileChangesMatchAny: *defaultFileChangeTrigger
        
        onBranchMerge: []
        `;
        const octokit = {
            request: vi.fn().mockImplementation(() => {
                return {
                    data: {
                        content: Buffer.from(ghaYamlWithNonUniqueNames).toString('base64'),
                    },
                    status: 200
                }
            }),
        };
        const diffEntries = [
            {
                filename: ".gha.yaml",
                contents_url: "contents_url",
            },
            {
                filename: "test.sh",
                contents_url: "contents_url1",
            }
        ];
        // @ts-ignore
        const annotationsForCheck = await ghaLoader.validateGhaYamlFiles(octokit, ".gha.yaml", diffEntries);
        expect(annotationsForCheck).toEqual([
            {
                annotation_level: "failure",
                end_column: 19,
                end_line: 12,
                message: "Pipeline unique prefix domain-b-example-c-build is not unique (same name used in folder1/.gha.yaml,folder2/.gha.yaml files)",
                path: ".gha.yaml",
                start_column: 19,
                start_line: 12,
            }
        ]);
        expect(octokit.request).toHaveBeenCalledWith("contents_url");
        expect(findMock).toHaveBeenCalledWith({
            pipeline_unique_prefix: "domain-b-example-c-build",
            path_to_gha_yaml: expect.objectContaining({
                "__query": expect.anything(),
                "__special": {
                    query: ".gha.yaml",
                    type: "not",
                }
            })
        });
        expect(findAllMock).toHaveBeenCalled();
    });

    it('should load all hooks, when at least one of gha yaml changes in commit', async () => {
        const octokit = {
            repos: {
                getContent: vi.fn().mockImplementation(() => {
                    return {
                        data: {
                            content: Buffer.from(ghaYamlExample).toString('base64'),
                        },
                        status: 200
                    }
                })
            }
        };
        const commits = [
            {
                added: ["folder1/.gha.yaml"],
                modified: [],
                removed: ["folder2/.gha.yaml"],
            },
            {
                added: [],
                modified: ["folder1/subfolder1/.gha.yaml"],
                removed: [],
            }
        ];
        // @ts-ignore
        await ghaLoader.loadGhaHooksFromCommits(octokit, "repo/full_name", "branch", ".gha.yaml", commits);
        expect(octokit.repos.getContent).toHaveBeenNthCalledWith(1, {
            owner: "repo",
            path: "folder1/.gha.yaml",
            ref: "branch",
            repo: "full_name"
        });
        expect(octokit.repos.getContent).toHaveBeenNthCalledWith(2, {
            owner: "repo",
            path: "folder1/subfolder1/.gha.yaml",
            ref: "branch",
            repo: "full_name"
        });
        expect(deleteMock).toHaveBeenNthCalledWith(1, {
            repo_full_name: "repo/full_name",
            branch: "branch",
            path_to_gha_yaml: "folder2/.gha.yaml"
        });
        expect(deleteMock).toHaveBeenNthCalledWith(2, {
            repo_full_name: "repo/full_name",
            branch: "branch",
            path_to_gha_yaml: "folder1/subfolder1/.gha.yaml"
        });
        expect(insertMock).toHaveBeenCalledTimes(10);
    });

    it('should load all hooks, when one of gha yaml changes in the PR', async () => {
        const octokit = {
            request: vi.fn().mockImplementation(() => {
                return {
                    data: {
                        content: Buffer.from(ghaYamlExample).toString('base64'),
                    },
                    status: 200
                }
            })
        };
        const diffEntries = [
            {
                filename: "file1",
                contents_url: "file1_contents_url",
                status: "added"
            },
            {
                filename: ".gha.yaml",
                contents_url: "modified_contents_url",
                status: "modified"
            },
            {
                filename: "remove/.gha.yaml",
                contents_url: "remove_contents_url",
                status: "removed"
            },
            {
                filename: "rename/.gha.yaml.disabled",
                previous_filename: "rename/.gha.yaml",
                contents_url: "rename_contents_url",
                status: "renamed"
            }
        ];
        // @ts-ignore
        const hooks = await ghaLoader.loadGhaHooks(octokit, ".gha.yaml", diffEntries);
        expect(hooks).toEqual({
            hookFilesModified: new Set([".gha.yaml", "remove/.gha.yaml", "rename/.gha.yaml"]), hooks: [
                {
                    "branch": "",
                    "destination_branch_matcher": null,
                    "file_changes_matcher": "namespaces/domain-b/projects/example-c/**",
                    "hook": "onPullRequest",
                    "hook_name": "build",
                    "path_to_gha_yaml": ".gha.yaml",
                    "pipeline_name": "common-job",
                    "pipeline_params": {"COMMAND": "make build"},
                    "pipeline_ref": "main",
                    "pipeline_unique_prefix": "domain-b-example-c-build",
                    "repo_full_name": "",
                    "shared_params": {"ROOT_DIR": "namespaces/domain-b/projects/example-c"},
                    "slash_command": undefined
                }, {
                    "branch": "",
                    "destination_branch_matcher": null,
                    "file_changes_matcher": "namespaces/domain-b/projects/example-c/tests/test.sh",
                    "hook": "onPullRequest",
                    "hook_name": "test",
                    "path_to_gha_yaml": ".gha.yaml",
                    "pipeline_name": "common-job",
                    "pipeline_params": {"COMMAND": "make test"},
                    "pipeline_ref": undefined,
                    "pipeline_unique_prefix": "domain-b-example-c-test",
                    "repo_full_name": "",
                    "shared_params": {"ROOT_DIR": "namespaces/domain-b/projects/example-c"},
                    "slash_command": undefined
                }, {
                    "branch": "",
                    "destination_branch_matcher": "main",
                    "file_changes_matcher": "namespaces/domain-b/projects/example-c/**",
                    "hook": "onBranchMerge",
                    "hook_name": "release",
                    "path_to_gha_yaml": ".gha.yaml",
                    "pipeline_name": "common-job",
                    "pipeline_params": {"COMMAND": "make release"},
                    "pipeline_ref": undefined,
                    "pipeline_unique_prefix": "domain-b-example-c-release",
                    "repo_full_name": "",
                    "shared_params": {"ROOT_DIR": "namespaces/domain-b/projects/example-c"},
                    "slash_command": undefined
                }, {
                    "branch": "",
                    "destination_branch_matcher": null,
                    "file_changes_matcher": "namespaces/domain-b/projects/example-c/**",
                    "hook": "onPullRequestClose",
                    "hook_name": "cleanup",
                    "path_to_gha_yaml": ".gha.yaml",
                    "pipeline_name": "common-job",
                    "pipeline_params": {"COMMAND": "make clean"},
                    "pipeline_ref": undefined,
                    "pipeline_unique_prefix": "domain-b-example-c-cleanup",
                    "repo_full_name": "",
                    "shared_params": {"ROOT_DIR": "namespaces/domain-b/projects/example-c"},
                    "slash_command": undefined
                },
                {
                    "branch": "",
                    "destination_branch_matcher": null,
                    "file_changes_matcher": "namespaces/domain-b/projects/example-c/**",
                    "hook": "onSlashCommand",
                    "hook_name": "validate-before-merge",
                    "path_to_gha_yaml": ".gha.yaml",
                    "pipeline_name": "generic-job",
                    "pipeline_params": {
                        "COMMAND": "make ${command} ${args}"
                    },
                    "pipeline_unique_prefix": "domain-b-example-c-validate-before-merge",
                    "repo_full_name": "",
                    "shared_params": {
                        "ROOT_DIR": "namespaces/domain-b/projects/example-c"
                    },
                    "slash_command": "validate"
                }]
        });
        expect(octokit.request).toHaveBeenCalledTimes(1);
        expect(octokit.request).toHaveBeenCalledWith("modified_contents_url");
    });

    it('should load gha yaml files for the branch, when there is no existing hooks for the branch', async () => {
        const octokit = {
            auth: vi.fn().mockImplementation(() => {
                return {
                    token: "token2"
                }
            }),
        };
        // @ts-ignore
        await ghaLoader.loadAllGhaYamlForBranchIfNew(octokit, "repo_full_name2", "branch");
        expect(countMock).toHaveBeenCalledWith({repo_full_name: "repo_full_name2", branch: "branch"});
        expect(octokit.auth).toHaveBeenCalledWith({type: "installation"});
        expect(cloneMock).toHaveBeenCalledWith("https://x-access-token:token2@github.com/repo_full_name2.git", expect.stringMatching(RegExp('.*repo_full_name2')));
        expect(cwdMock).toHaveBeenCalledWith({path: expect.stringMatching(RegExp('.*repo_full_name2')), root: true});
        expect(checkoutBranchMock).toHaveBeenCalledWith("branch", "origin/branch");
        expect(globMock).toHaveBeenCalled();
        expect(deleteMock).toHaveBeenCalledTimes(1)
        expect(readFileSyncMockCounter).toBe(2);
        expect(insertMock).toHaveBeenCalledTimes(10);
    });

    it('should acquire a per-branch advisory lock before touching the hooks cache', async () => {
        const octokit = {
            auth: vi.fn().mockImplementation(() => {
                return {token: "token5"}
            }),
        };
        // @ts-ignore
        await ghaLoader.loadAllGhaYamlForBranchIfNew(octokit, "org/repo_locked", "branch");
        expect(dbTxMock).toHaveBeenCalledTimes(1);
        expect(txQueryMock).toHaveBeenCalledTimes(1);
        const lockQuery = txQueryMock.mock.calls[0][0];
        const {text, values} = lockQuery.format({
            escapeIdentifier: (s: string) => `"${s}"`,
            formatValue: (v: unknown, i: number) => ({placeholder: `$${i + 1}`, value: v})
        });
        expect(text).toContain("pg_advisory_xact_lock");
        expect(values).toEqual(["org/repo_locked", "branch"]);
    });

    it('should not throw and should log, when acquiring the branch lock fails', async () => {
        dbTxMock.mockImplementationOnce(() => {
            throw new Error("connection terminated unexpectedly");
        });
        const octokit = {
            auth: vi.fn()
        };
        // @ts-ignore
        await expect(ghaLoader.loadAllGhaYamlForBranchIfNew(octokit, "org/repo_lock_fails", "branch")).resolves.toBeUndefined();
        expect(logMock.error).toHaveBeenCalledWith(expect.any(Error), expect.stringContaining("Error acquiring hooks cache lock"));
        expect(countMock).not.toHaveBeenCalled();
        expect(cloneMock).not.toHaveBeenCalled();
    });

    it('should do nothing, when branch hooks cache already matches the branch current HEAD', async () => {
        countMock.mockReturnValueOnce(3267);
        firstMock.mockReturnValueOnce(Promise.resolve({branch_head_sha: "currentsha"}));
        const octokit = {
            repos: {
                getBranch: vi.fn().mockImplementation(() => {
                    return {data: {commit: {sha: "currentsha"}}}
                }),
                compareCommitsWithBasehead: vi.fn(),
                getContent: vi.fn()
            }
        };
        // @ts-ignore
        await ghaLoader.loadAllGhaYamlForBranchIfNew(octokit, "org/repo_fresh", "branch", ".gha.yaml");
        expect(octokit.repos.getBranch).toHaveBeenCalledWith({owner: "org", repo: "repo_fresh", branch: "branch"});
        expect(octokit.repos.compareCommitsWithBasehead).not.toHaveBeenCalled();
        expect(octokit.repos.getContent).not.toHaveBeenCalled();
        expect(cloneMock).not.toHaveBeenCalled();
        expect(insertMock).not.toHaveBeenCalled();
        expect(updateMock).not.toHaveBeenCalled();
    });

    it('should reconcile only the changed hook file, when branch hooks cache is stale relative to current HEAD', async () => {
        countMock.mockReturnValueOnce(3267);
        firstMock.mockReturnValueOnce(Promise.resolve({branch_head_sha: "oldsha"}));
        const octokit = {
            repos: {
                getBranch: vi.fn().mockImplementation(() => {
                    return {data: {commit: {sha: "newsha"}}}
                }),
                compareCommitsWithBasehead: vi.fn().mockImplementation(() => {
                    return {
                        data: {
                            files: [
                                {filename: "unrelated.ts", status: "modified"},
                                {filename: "folder1/.gha.yaml", status: "modified"},
                                {filename: "folder2/.gha.yaml", status: "removed"}
                            ]
                        }
                    }
                }),
                getContent: vi.fn().mockImplementation(() => {
                    return {
                        data: {
                            content: Buffer.from(ghaYamlExample).toString('base64'),
                        }
                    }
                })
            }
        };
        // @ts-ignore
        await ghaLoader.loadAllGhaYamlForBranchIfNew(octokit, "org/repo_stale", "branch", ".gha.yaml");
        expect(octokit.repos.compareCommitsWithBasehead).toHaveBeenCalledWith({owner: "org", repo: "repo_stale", basehead: "oldsha...newsha"});
        expect(octokit.repos.getContent).toHaveBeenCalledTimes(1);
        expect(octokit.repos.getContent).toHaveBeenCalledWith({owner: "org", repo: "repo_stale", path: "folder1/.gha.yaml", ref: "newsha"});
        expect(deleteMock).toHaveBeenCalledWith({repo_full_name: "org/repo_stale", branch: "branch", path_to_gha_yaml: "folder2/.gha.yaml"});
        expect(deleteMock).toHaveBeenCalledWith({repo_full_name: "org/repo_stale", branch: "branch", path_to_gha_yaml: "folder1/.gha.yaml"});
        expect(insertMock).toHaveBeenCalledTimes(5);
        expect(updateMock).toHaveBeenCalledWith({repo_full_name: "org/repo_stale", branch: "branch"}, {branch_head_sha: "newsha"});
        expect(cloneMock).not.toHaveBeenCalled();
    });

    it('should reconcile a renamed hook file by deleting the old path and reloading the new one, when branch hooks cache is stale', async () => {
        countMock.mockReturnValueOnce(3267);
        firstMock.mockReturnValueOnce(Promise.resolve({branch_head_sha: "oldsha"}));
        const octokit = {
            repos: {
                getBranch: vi.fn().mockImplementation(() => {
                    return {data: {commit: {sha: "newsha"}}}
                }),
                compareCommitsWithBasehead: vi.fn().mockImplementation(() => {
                    return {
                        data: {
                            files: [
                                {filename: "folder1/.gha.yaml.disabled", previous_filename: "folder1/.gha.yaml", status: "renamed"}
                            ]
                        }
                    }
                }),
                getContent: vi.fn()
            }
        };
        // @ts-ignore
        await ghaLoader.loadAllGhaYamlForBranchIfNew(octokit, "org/repo_renamed", "branch", ".gha.yaml");
        expect(deleteMock).toHaveBeenCalledWith({repo_full_name: "org/repo_renamed", branch: "branch", path_to_gha_yaml: "folder1/.gha.yaml"});
        expect(octokit.repos.getContent).not.toHaveBeenCalled();
        expect(insertMock).not.toHaveBeenCalled();
        expect(updateMock).toHaveBeenCalledWith({repo_full_name: "org/repo_renamed", branch: "branch"}, {branch_head_sha: "newsha"});
    });

    it('should skip the staleness check, when fetching the branch current HEAD fails', async () => {
        countMock.mockReturnValueOnce(3267);
        const octokit = {
            repos: {
                getBranch: vi.fn().mockImplementation(() => {
                    throw new Error("network error");
                }),
                compareCommitsWithBasehead: vi.fn(),
                getContent: vi.fn()
            }
        };
        // @ts-ignore
        await ghaLoader.loadAllGhaYamlForBranchIfNew(octokit, "org/repo_getbranch_fails", "branch", ".gha.yaml");
        expect(firstMock).not.toHaveBeenCalled();
        expect(octokit.repos.compareCommitsWithBasehead).not.toHaveBeenCalled();
        expect(cloneMock).not.toHaveBeenCalled();
        expect(insertMock).not.toHaveBeenCalled();
        expect(deleteMock).not.toHaveBeenCalled();
    });

    it('should fall back to a full reload, when comparing commits fails', async () => {
        countMock.mockReturnValueOnce(3267);
        firstMock.mockReturnValueOnce(Promise.resolve({branch_head_sha: "oldsha"}));
        const octokit = {
            auth: vi.fn().mockImplementation(() => {
                return {token: "token4"}
            }),
            repos: {
                getBranch: vi.fn().mockImplementation(() => {
                    return {data: {commit: {sha: "newsha"}}}
                }),
                compareCommitsWithBasehead: vi.fn().mockImplementation(() => {
                    throw new Error("compare API error");
                })
            }
        };
        // @ts-ignore
        await ghaLoader.loadAllGhaYamlForBranchIfNew(octokit, "org/repo_compare_fails", "branch", ".gha.yaml");
        expect(cloneMock).toHaveBeenCalledWith("https://x-access-token:token4@github.com/org/repo_compare_fails.git", expect.stringMatching(RegExp('.*org/repo_compare_fails')));
        expect(checkoutBranchMock).toHaveBeenCalledWith("branch", "origin/branch");
        expect(insertMock).toHaveBeenCalledTimes(10);
    });

    it('should force a full reload, when branch has cached hooks but no recorded head sha (predates staleness tracking)', async () => {
        countMock.mockReturnValueOnce(3267);
        firstMock.mockReturnValueOnce(Promise.resolve(null));
        const octokit = {
            auth: vi.fn().mockImplementation(() => {
                return {token: "token3"}
            }),
            repos: {
                getBranch: vi.fn().mockImplementation(() => {
                    return {data: {commit: {sha: "currentsha"}}}
                }),
                compareCommitsWithBasehead: vi.fn()
            }
        };
        // @ts-ignore
        await ghaLoader.loadAllGhaYamlForBranchIfNew(octokit, "org/repo_legacy", "branch", ".gha.yaml");
        expect(octokit.repos.compareCommitsWithBasehead).not.toHaveBeenCalled();
        expect(cloneMock).toHaveBeenCalledWith("https://x-access-token:token3@github.com/org/repo_legacy.git", expect.stringMatching(RegExp('.*org/repo_legacy')));
        expect(checkoutBranchMock).toHaveBeenCalledWith("branch", "origin/branch");
        expect(insertMock).toHaveBeenCalledTimes(10);
    });

    it('should delete all hooks from db, when branch is deleted', async () => {
        await ghaLoader.deleteAllGhaHooksForBranch("repo_full_name3", "branch3");
        expect(deleteMock).toHaveBeenCalledWith({repo_full_name: "repo_full_name3", branch: "branch3"});
    });

    it('should not corrupt each other\'s clone/checkout state, when two full-reloads for different branches of the same repo run concurrently', async () => {
        // Each call must get its own git instance and its own clone directory, keyed by branch,
        // so that call A's checkoutBranch never runs against a cwd that call B most recently set.
        const instances: { target: string | undefined, branch: string | undefined }[] = [];
        // @ts-ignore
        ghaLoader.createGit = () => {
            const instance: { target: string | undefined, branch: string | undefined } = {target: undefined, branch: undefined};
            instances.push(instance);
            return {
                clone: vi.fn().mockImplementation(async () => {
                    // yield so the other concurrent call's clone/cwd/checkout can interleave
                    await new Promise(resolve => setTimeout(resolve, 0));
                    return "";
                }),
                cwd: vi.fn().mockImplementation(async ({path: cwdPath}: { path: string }) => {
                    instance.target = cwdPath;
                    await new Promise(resolve => setTimeout(resolve, 0));
                }),
                checkoutBranch: vi.fn().mockImplementation(async (branch: string) => {
                    instance.branch = branch;
                })
            };
        };
        const rmSyncCalls: string[] = [];
        // @ts-ignore
        vi.mocked(fs.rmSync).mockImplementation((target: string) => {
            rmSyncCalls.push(target);
        });

        const octokit = {
            auth: vi.fn().mockImplementation(() => {
                return {token: "token"};
            }),
        };
        await Promise.all([
            // @ts-ignore
            ghaLoader.loadAllGhaHooksFromRepo(octokit, "shared_repo", "branch-x", ".gha.yaml"),
            // @ts-ignore
            ghaLoader.loadAllGhaHooksFromRepo(octokit, "shared_repo", "branch-y", ".gha.yaml")
        ]);

        expect(instances).toHaveLength(2);
        // each call's own git instance must have checked out its own branch inside its own target dir
        for (const instance of instances) {
            expect(instance.target).toEqual(expect.stringContaining(instance.branch as string));
        }
        // the two calls must not have shared (or clobbered) a clone directory
        const targets = instances.map(instance => instance.target);
        expect(new Set(targets).size).toBe(2);
        expect(new Set(rmSyncCalls).size).toBe(rmSyncCalls.length);
    });

});