FROM node:20-slim
RUN apt-get update && apt-get install -y git
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
