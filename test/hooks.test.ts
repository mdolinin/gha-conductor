import {Hooks} from "../src/hooks";

const findAllMock = jest.fn().mockImplementation(() => {
    return [
        {
            file_changes_matcher: "file1",
            pipeline_unique_prefix: "pipeline_unique_prefix"
        }
    ]

});
const selectMock = jest.fn().mockImplementation(() => {
    return {
        all: findAllMock
    }

});
const findMock = jest.fn().mockImplementation(() => {
    return {
        select: selectMock,
    }
});

jest.mock('../src/db/database', () => {
    return {
        gha_hooks: jest.fn(() => {
            return {
                find: findMock,
            };
        })
    }
});

describe('gha hooks', () => {
    const hooks = new Hooks();

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('find hooks to trigger, when matched files changed on branch merge', async () => {
        const triggeredHookNames = await hooks.filterTriggeredHooks("repo_full_name", "onBranchMerge", ["file1", "file2"], "baseBranch", [
            {
                repo_full_name: "repo_full_name",
                branch: "baseBranch",
                file_changes_matcher: "file1",
                destination_branch_matcher: "baseBranch",
                hook: "onBranchMerge",
                hook_name: "hook_name",
                pipeline_unique_prefix: "pipeline_unique_prefix",
                pipeline_name: "pipeline_name",
                pipeline_ref: "pipeline_ref",
                pipeline_params: {},
                shared_params: {}
            }
        ]);
        expect(triggeredHookNames).toEqual(new Set(["pipeline_unique_prefix"]));
        expect(findMock).toHaveBeenCalledWith(
            {
                repo_full_name: "repo_full_name",
                branch: "baseBranch",
                hook: "onBranchMerge",
                destination_branch_matcher: "baseBranch"
            }
        );
        expect(selectMock).toHaveBeenCalledWith('file_changes_matcher', 'pipeline_unique_prefix');
        expect(findAllMock).toHaveBeenCalledTimes(1);
    });

    it('find hooks to trigger, when matched files changed on pull request open', async () => {
        const triggeredHookNames = await hooks.filterTriggeredHooks("repo_full_name", "onPullRequest", ["file1", "file2"], "baseBranch", [
            {
                repo_full_name: "repo_full_name",
                branch: "baseBranch",
                file_changes_matcher: "file1",
                destination_branch_matcher: "baseBranch",
                hook: "onPullRequest",
                hook_name: "hook_name",
                pipeline_unique_prefix: "pipeline_unique_prefix",
                pipeline_name: "pipeline_name",
                pipeline_ref: "pipeline_ref",
                pipeline_params: {},
                shared_params: {}
            }
        ]);
        expect(triggeredHookNames).toEqual(new Set(["pipeline_unique_prefix"]));
        expect(findMock).toHaveBeenCalledWith(
            {
                repo_full_name: "repo_full_name",
                branch: "baseBranch",
                hook: "onPullRequest",
            }
        );
        expect(selectMock).toHaveBeenCalledWith('file_changes_matcher', 'pipeline_unique_prefix');
        expect(findAllMock).toHaveBeenCalledTimes(1);
    });

});