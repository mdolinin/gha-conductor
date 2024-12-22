import {GhaLoader} from "../src/gha_loader";
import {Logger} from "probot";
import fs from "fs";

const cloneMock = jest.fn().mockReturnValue(Promise.resolve(""));
const cwdMock = jest.fn();
const checkoutBranchMock = jest.fn();
const globMock = jest.fn().mockImplementation(() => {
    return ["folder1/.gha.yaml", "folder2/.gha.yaml"];
});
const findAllMock = jest.fn().mockReturnValue([
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
const findMock = jest.fn().mockImplementation(() => {
    return {
        all: findAllMock
    }
});
const deleteMock = jest.fn();
const updateMock = jest.fn();
const insertMock = jest.fn();
const countMock = jest.fn().mockReturnValue(0);

jest.mock('glob', () => {
    return {
        glob: () => globMock()
    }
});

jest.mock('../src/db/database', () => {
    return {
        gha_hooks: jest.fn(() => {
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

jest.mock('fs', () => {
    return {
        existsSync: jest.fn().mockReturnValue(true),
        rmSync: jest.fn(),
        mkdirSync: jest.fn(),
        write: jest.requireActual('fs').write,
        writeSync: jest.requireActual('fs').writeSync,
        readFileSync: jest.fn().mockImplementation((path: string, options: string) => {
            if (path.includes(".gha.yaml")) {
                return ghaYamlExample;
            }
            return jest.requireActual('fs').readFileSync(path, options);
        }),
        statSync: jest.fn().mockImplementation(() => {
            return {
                isFile: jest.fn().mockReturnValue(false),
                isDirectory: jest.fn().mockReturnValue(true)
            }
        })
    }
});

const readFileSyncMock = jest.spyOn(fs, 'readFileSync');

const logMock = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
};

describe('gha loader', () => {
    const ghaLoader = new GhaLoader(logMock as unknown as Logger);

    beforeEach(() => {
        // @ts-ignore
        ghaLoader.git = {
            clone: cloneMock,
            cwd: cwdMock,
            checkoutBranch: checkoutBranchMock
        }
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should load all gha yaml files from github repo and reinsert all hooks into db, when repo and branch provided to loader', async () => {
        const octokit = {
            auth: jest.fn().mockImplementation(() => {
                return {
                    token: "token"
                }
            }),
        };
        // @ts-ignore
        await ghaLoader.loadAllGhaHooksFromRepo(octokit, "repo_full_name", "branch", ".gha.yaml");
        expect(octokit.auth).toHaveBeenCalledWith({type: "installation"});
        expect(cloneMock).toHaveBeenCalledWith("https://x-access-token:token@github.com/repo_full_name.git", expect.stringMatching(RegExp('.*repo_full_name')));
        expect(cwdMock).toHaveBeenCalledWith({path: expect.stringMatching(RegExp('.*repo_full_name')), root: true});
        expect(checkoutBranchMock).toHaveBeenCalledWith("branch", "origin/branch");
        expect(globMock).toHaveBeenCalled();
        expect(readFileSyncMock).toHaveBeenCalledTimes(3);
        expect(deleteMock).toHaveBeenCalledTimes(1)
        expect(insertMock).toHaveBeenCalledTimes(10);
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
            request: jest.fn().mockImplementation(() => {
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
            request: jest.fn().mockImplementation(() => {
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
            request: jest.fn().mockImplementation(() => {
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
                getContent: jest.fn().mockImplementation(() => {
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
            request: jest.fn().mockImplementation(() => {
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
            }
        ];
        // @ts-ignore
        const hooks = await ghaLoader.loadGhaHooks(octokit, ".gha.yaml", diffEntries);
        expect(hooks).toEqual({
            hookFilesModified: new Set([".gha.yaml", "remove/.gha.yaml"]), hooks: [
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
            auth: jest.fn().mockImplementation(() => {
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
        expect(readFileSyncMock).toHaveBeenCalledTimes(2);
        expect(insertMock).toHaveBeenCalledTimes(10);
    });

    it('should delete all hooks from db, when branch is deleted', async () => {
        await ghaLoader.deleteAllGhaHooksForBranch("repo_full_name3", "branch3");
        expect(deleteMock).toHaveBeenCalledWith({repo_full_name: "repo_full_name3", branch: "branch3"});
    });

});