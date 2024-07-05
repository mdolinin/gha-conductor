import {Transform} from "readable-stream";
import prettyFactory from "pino-pretty"

const LEVEL_MAP = new Map<number, string>([
    [10, "trace"],
    [20, "debug"],
    [30, "info"],
    [40, "warn"],
    [50, "error"],
    [60, "fatal"],
]);

export type Options = {
    logFormat?: "json" | "pretty";
    logLevelInString?: boolean;
};

function stringifyLogLevelAndCleanUp(data: { level: number | string, req?: any, res?: any }) {
    if (typeof data.level === "number") {
        data.level = LEVEL_MAP.get(data.level) || "info";
    }
    // remove verbose keys from pino-http
    if (data.req) {
        data.req = undefined;
    }
    if (data.res) {
        data.res = undefined;
    }
    return JSON.stringify(data) + "\n";
}


/**
 * Implements Probot's default logging formatting
 * @returns Transform
 * @see https://getpino.io/#/docs/transports
 */
const getTransformStream = (options: Options = {}): Transform => {
    const formattingEnabled = options.logFormat !== "json";
    const levelAsString = options.logLevelInString;

    const pretty = prettyFactory({
        ignore: [
            // default pino keys
            "time",
            "pid",
            "hostname",
            // remove keys from pino-http
            "req",
            "res",
            "responseTime",
        ].join(","),
        errorProps: ["event", "status", "headers", "request", "sentryEventId"].join(
            ","
        ),
    });

    return new Transform({
        objectMode: true,
        transform(chunk, _enc, cb) {
            const line = chunk.toString().trim();

            /* istanbul ignore if */
            if (line === undefined) return cb();


            if (formattingEnabled) {
                return cb(null, pretty(line));
            }

            if (levelAsString) {
                return cb(null, stringifyLogLevelAndCleanUp(JSON.parse(line)));
            }

            cb(null, line + "\n");
            return;
        },
    });
}

export {getTransformStream};