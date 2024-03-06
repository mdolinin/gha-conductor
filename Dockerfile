FROM node:20-slim
RUN apt-get update && apt-get install -y git
WORKDIR /usr/src/app
COPY package.json yarn.lock tsconfig.json ./
RUN yarn install --production
RUN yarn cache clean
ENV NODE_ENV="production"
COPY . .
RUN yarn build
CMD [ "yarn", "bot:start" ]
