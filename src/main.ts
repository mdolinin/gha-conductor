import {config as dotenvConfig} from "dotenv";

dotenvConfig();
import 'dd-trace/init.js';
import {Server, Probot, Options} from "probot";
import {defaultApp} from "probot/lib/apps/default.js";
import app from "./index.js";
import {ServerOptions} from "probot/lib/types.js";
import {readEnvOptions} from "probot/lib/bin/read-env-options.js";
import {getTransformStream} from "./log/log.js"
import {rebindLog} from "probot/lib/helpers/rebind-log.js";
import {pino} from "pino";
import type {LoggerOptions} from "pino";

const main = async () => {
    const envOptions = readEnvOptions();
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

    } = {...envOptions};

    const transform = getTransformStream({
        logFormat,
        logLevelInString,
    });
    const sonicBoom = pino.destination(1)
    // @ts-ignore
    transform.pipe(sonicBoom);

    const pinoOptions: LoggerOptions = {
        level: level || "info",
        name: "probot",
        messageKey: logMessageKey || "msg",
    };
    const log = rebindLog(pino(pinoOptions, transform));

    const probotOptions: Options = {
        appId,
        privateKey,
        redisConfig,
        secret,
        baseUrl,
        log: log.child({name: "probot"}),
        Octokit: undefined,
    };

    const serverOptions: ServerOptions = {
        host,
        port,
        webhookPath,
        webhookProxy,
        log: log.child({name: "server"}),
        Probot: Probot.defaults(probotOptions),
    };

    const server = new Server(serverOptions);

    await server.load(defaultApp)
    await server.load(app);

    server.start();
};

main().catch((error) => {
    console.error(error);
    process.exit(1);
});