FROM node:20-slim
RUN apt-get update && apt-get install -y git
WORKDIR /usr/src/app
COPY package.json yarn.lock tsconfig.json ./
RUN yarn install --production
# Workaround for error TS7016: Could not find a declaration file for module 'js-yaml'
RUN yarn add --dev @types/js-yaml
RUN yarn cache clean
ENV NODE_ENV="production"
COPY . .
RUN yarn build
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 CMD ["node", "./lib/healthcheck.js"]
CMD [ "yarn", "bot:start" ]
