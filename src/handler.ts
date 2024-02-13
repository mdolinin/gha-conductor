import { createNodeMiddleware, createProbot } from "probot";
import app from "./index";

export default createNodeMiddleware(app, {
    probot: createProbot({
        overrides: {
            privateKey: Buffer.from(process.env.PRIVATE_KEY || "bm8gY29udGVudCAtbgo=", "base64").toString(),
        }
    }),
    webhooksPath: "/api/github/webhooks",
});