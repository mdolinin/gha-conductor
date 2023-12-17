# gha-conductor

> A GitHub App built with [Probot](https://github.com/probot/probot) that GitHub Actions for monorepo setup

## Setup

```sh
# Install dependencies
yarn
# Generate schemas
yarn generate
# Apply db migrations
yarn db:migrate
# Generate db schema
yarn db:generate
# Run the bot
yarn start
```

## Docker

```sh
# 1. Build container
docker build -t gha-conductor .

# 2. Start container
docker run -e APP_ID=<app-id> -e PRIVATE_KEY=<pem-value> gha-conductor
```

## Contributing

If you have suggestions for how gha-conductor could be improved, or want to report a bug, open an issue! We'd love all and any contributions.

For more, check out the [Contributing Guide](CONTRIBUTING.md).

## License

[ISC](LICENSE) © 2023 mdolinin
