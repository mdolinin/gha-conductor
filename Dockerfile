# Keep in sync with .nvmrc. Node >= 24.22.1 is required for CVE-2026-111497 (Brotli decoder OOB write).
ARG NODE_VERSION=24.22.2
FROM node:${NODE_VERSION}-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /usr/src/app
ENV NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production YARN_VERSION=4.6.0
RUN corepack enable && corepack prepare yarn@${YARN_VERSION}
COPY package.json yarn.lock .yarnrc.yml tsconfig.json ./
RUN yarn install --immutable
RUN yarn cache clean
COPY . .
RUN yarn build
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 CMD ["node", "./lib/healthcheck.js"]
CMD [ "yarn", "bot:start" ]
