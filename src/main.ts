// Must stay the first import: ESM evaluates imports in order, and modules such as ./db/database.js
// read process.env (e.g. DATABASE_URL) at import time. probot < 14 loaded .env itself on import.
import "dotenv/config";
import 'dd-trace/init.js';
import {Server, Probot} from "probot";
import type {Options} from "probot";
import {getPrivateKey} from "@probot/get-private-key";
import app from "./index.js";
import {getTransformStream} from "./log/log.js"
import {pino} from "pino";
import type {LoggerOptions} from "pino";

// probot >= 14 only exports its package root, so env parsing that used to come from
// probot/lib/bin/read-env-options.js lives here (same env vars and defaults).
function readEnvOptions(env = process.env) {
    let privateKey: string | undefined;
    try {
        privateKey = getPrivateKey({env})?.toString() || undefined;
    } catch (e) {
        console.error(e);
    }
    const logFormat: "json" | "pretty" = env.LOG_FORMAT
        ? (env.LOG_FORMAT === "pretty" ? "pretty" : "json")
        : (env.NODE_ENV === "production" ? "json" : "pretty");
    return {
        privateKey,
        appId: Number(env.APP_ID),
        port: Number(env.PORT) || 3000,
        // probot >= 14's Server defaults host to "localhost" (loopback only), which makes the app
        // unreachable from a load balancer/container network; probot 13 listened on all interfaces.
        host: env.HOST || "0.0.0.0",
        secret: env.WEBHOOK_SECRET,
        webhookPath: env.WEBHOOK_PATH,
        webhookProxy: env.WEBHOOK_PROXY_URL,
        logLevel: env.LOG_LEVEL,
        logFormat,
        logLevelInString: env.LOG_LEVEL_IN_STRING === "true",
        logMessageKey: env.LOG_MESSAGE_KEY,
        redisConfig: env.REDIS_URL,
        baseUrl: env.GHE_HOST
            ? `${env.GHE_PROTOCOL || "https"}://${env.GHE_HOST}/api/v3`
            : "https://api.github.com",
    };
}

const main = async () => {
    const {
        // log options
        logLevel: level,
        logFormat,
        logLevelInString,
        logMessageKey,

        // server options
        host,
        port,
        webhookPath,
        webhookProxy,

        // probot options
        appId,
        privateKey,
        redisConfig,
        secret,
        baseUrl,
    } = readEnvOptions();

    const transform = getTransformStream({
        logFormat,
        logLevelInString,
    });
    // SonicBoom is a Writable at runtime but its typings lack the full NodeJS.WritableStream shape
    transform.pipe(pino.destination(1) as unknown as NodeJS.WritableStream);

    const pinoOptions: LoggerOptions = {
        level: level || "info",
        name: "probot",
        messageKey: logMessageKey || "msg",
    };
    const log = pino(pinoOptions, transform);

    const probotOptions: Options = {
        appId,
        privateKey,
        redisConfig,
        secret,
        baseUrl,
        log: log.child({name: "probot"}),
    };

    const server = new Server({
        host,
        port,
        webhookPath,
        webhookProxy,
        log: log.child({name: "server"}),
        Probot: Probot.defaults(probotOptions),
    });

    await server.load(app);
    await server.start();
};

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
