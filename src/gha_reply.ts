import {Context, Logger} from "probot";

export class GhaReply {
    private log: Logger;

    constructor(log: Logger) {
        this.log = log;
    }


    async replyToCommentWithReactionAndComment(
        context: Context<"issue_comment">,
        comment: string,
        reaction: "+1" | "-1" | "laugh" | "confused" | "heart" | "hooray" | "rocket" | "eyes"
    ): Promise<void> {
        const commentId = context.payload.comment.id;
        this.log.debug(`Replying to comment ${commentId} with reaction ${reaction} and comment ${comment}`);
        const reactions = await context.octokit.reactions.listForIssueComment({
            owner: context.payload.repository.owner.login,
            repo: context.payload.repository.name,
            comment_id: commentId,
        });
        try {
            for (const react of reactions.data) {
                if (react.content !== reaction) {
                    await context.octokit.reactions.deleteForIssueComment({
                        owner: context.payload.repository.owner.login,
                        repo: context.payload.repository.name,
                        comment_id: commentId,
                        reaction_id: react.id,
                    });
                }
            }
            await context.octokit.reactions.createForIssueComment({
                owner: context.payload.repository.owner.login,
                repo: context.payload.repository.name,
                comment_id: commentId,
                content: reaction,
            });
            await context.octokit.issues.createComment({
                owner: context.payload.repository.owner.login,
                repo: context.payload.repository.name,
                issue_number: context.payload.issue.number,
                body: comment,
            });
        } catch (e) {
            this.log.error(e, `Failed to reply to comment ${commentId} with reaction ${reaction} and comment ${comment}`);
        }
    }

}