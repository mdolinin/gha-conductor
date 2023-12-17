import { Probot } from "probot";
import { GhaLoader } from "./gha_loader";

export = (app: Probot) => {

  const ghaLoader = new GhaLoader();

  app.on("issues.opened", async (context) => {
    const issueComment = context.issue({
      body: "Thanks for opening this issue!",
    });
    await context.octokit.issues.createComment(issueComment);
  });

  app.on("pull_request.labeled", async (context) => {
    app.log.info("context.payload is " + context.payload);
    app.log.info("Label is " + context.payload.label.name);
    if (context.payload.label.name === "gha-conductor:load") {
      app.log.info("Reload gha yaml's in repo");
      await ghaLoader.loadAllGhaYaml(context.octokit, context.payload.repository.full_name, context.log);
      app.log.info("Reload gha yaml's in repo done");
    }
  });
  // For more information on building apps:
  // https://probot.github.io/docs/

  // To get your app running against GitHub, see:
  // https://probot.github.io/docs/development/
};
