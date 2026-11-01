import { createNodeMiddleware, createProbot } from "probot";
import app from "./index.js";

const probot = createProbot();

// probot >= 14: createNodeMiddleware is async
export default await createNodeMiddleware(app, {
    probot,
    webhooksPath: "/api/github/webhooks",
});