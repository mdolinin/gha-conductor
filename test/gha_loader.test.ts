import {GhaLoader} from "../src/gha_loader";

const cloneMock = jest.fn().mockReturnValue(Promise.resolve(""));
const cwdMock = jest.fn();
const checkoutBranchMock = jest.fn();
const globMock = jest.fn().mockImplementation(() => {
    return ["file1", "file2"];
});
const deleteMock = jest.fn();
const insertMock = jest.fn();

jest.mock('glob', () => {
    return {
        glob: () => globMock()
    }
});

jest.mock('../src/db/database', () => {
    return {
        gha_hooks: jest.fn(() => {
            return {
                delete: deleteMock,
                insert: insertMock
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
`;

const readFileSyncMock = jest.fn().mockImplementation(() => {
    return ghaYamlExample;
});

jest.mock('fs', () => {
    return {
        existsSync: jest.fn().mockReturnValue(true),
        rmSync: jest.fn(),
        mkdirSync: jest.fn(),
        writeSync: jest.requireActual('fs').writeSync,
        readFileSync: () => readFileSyncMock(),
        statSync: jest.fn().mockImplementation(() => {
            return {
                isFile: jest.fn().mockReturnValue(false),
                isDirectory: jest.fn().mockReturnValue(true)
            }
        })
    }
});

describe('gha loader', () => {
    const ghaLoader = new GhaLoader();

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

    it('should load all gha yaml files from github repo, when repo and branch provided to loader', async () => {
        const octokit = {
            auth: jest.fn().mockImplementation(() => {
                return {
                    token: "token"
                }
            }),
        };
        // @ts-ignore
        await ghaLoader.loadAllGhaYaml(octokit, "repo_full_name", "branch");
        expect(octokit.auth).toHaveBeenCalledWith({type: "installation"});
        expect(cloneMock).toHaveBeenCalledWith("https://x-access-token:token@github.com/repo_full_name.git", expect.stringMatching(RegExp('.*repo_full_name')));
        expect(cwdMock).toHaveBeenCalledWith({path: expect.stringMatching(RegExp('.*repo_full_name')), root: true});
        expect(checkoutBranchMock).toHaveBeenCalledWith("branch", "origin/branch");
        expect(globMock).toHaveBeenCalled();
        expect(deleteMock).toHaveBeenCalledWith({repo_full_name: "repo_full_name", branch: "branch"});
        expect(readFileSyncMock).toHaveBeenCalledTimes(2);
        expect(insertMock).toHaveBeenCalledTimes(8);
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
                filename: ".gha.yaml",
                contents_url: "contents_url",
            }
        ];
        // @ts-ignore
        const hooks = await ghaLoader.loadGhaHooks(octokit, diffEntries);
        expect(hooks).toEqual([{
            "branch": "",
            "destination_branch_matcher": null,
            "file_changes_matcher": "namespaces/domain-b/projects/example-c/**",
            "hook": "onPullRequest",
            "hook_name": "build",
            "pipeline_name": "common-job",
            "pipeline_params": {"COMMAND": "make build"},
            "pipeline_ref": null,
            "pipeline_unique_prefix": "domain-b-example-c-build",
            "repo_full_name": "",
            "shared_params": {"ROOT_DIR": "namespaces/domain-b/projects/example-c"}
        }, {
            "branch": "",
            "destination_branch_matcher": null,
            "file_changes_matcher": "namespaces/domain-b/projects/example-c/tests/test.sh",
            "hook": "onPullRequest",
            "hook_name": "test",
            "pipeline_name": "common-job",
            "pipeline_params": {"COMMAND": "make test"},
            "pipeline_ref": null,
            "pipeline_unique_prefix": "domain-b-example-c-test",
            "repo_full_name": "",
            "shared_params": {"ROOT_DIR": "namespaces/domain-b/projects/example-c"}
        }, {
            "branch": "",
            "destination_branch_matcher": "main",
            "file_changes_matcher": "namespaces/domain-b/projects/example-c/**",
            "hook": "onBranchMerge",
            "hook_name": "release",
            "pipeline_name": "common-job",
            "pipeline_params": {"COMMAND": "make release"},
            "pipeline_ref": null,
            "pipeline_unique_prefix": "domain-b-example-c-release",
            "repo_full_name": "",
            "shared_params": {"ROOT_DIR": "namespaces/domain-b/projects/example-c"}
        }, {
            "branch": "",
            "destination_branch_matcher": null,
            "file_changes_matcher": "namespaces/domain-b/projects/example-c/**",
            "hook": "onPullRequestClose",
            "hook_name": "cleanup",
            "pipeline_name": "common-job",
            "pipeline_params": {"COMMAND": "make clean"},
            "pipeline_ref": null,
            "pipeline_unique_prefix": "domain-b-example-c-cleanup",
            "repo_full_name": "",
            "shared_params": {"ROOT_DIR": "namespaces/domain-b/projects/example-c"}
        }]);
        expect(octokit.request).toHaveBeenCalledWith("contents_url");
    });

});