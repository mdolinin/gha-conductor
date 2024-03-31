# [1.5.0](https://github.com/mdolinin/gha-conductor/compare/v1.4.0...v1.5.0) (2024-03-31)


### Features

* **gha:** add workflow to auto-merge dependabot PRs ([#15](https://github.com/mdolinin/gha-conductor/issues/15)) ([7408197](https://github.com/mdolinin/gha-conductor/commit/74081978596f27827ef0f432f2cfa3ac51c9bc8f))

# [1.4.0](https://github.com/mdolinin/gha-conductor/compare/v1.3.6...v1.4.0) (2024-03-08)


### Bug Fixes

* **app:** remove redundant issue opened handler ([c6380d6](https://github.com/mdolinin/gha-conductor/commit/c6380d6bcf499e43bc5e507c026981622800b15d))


### Features

* **fork:** if PR is from forked repo then skip all hooks ([7a9a7f6](https://github.com/mdolinin/gha-conductor/commit/7a9a7f68dc966118c59d8af37bf841e907d0ac14))

## [1.3.6](https://github.com/mdolinin/gha-conductor/compare/v1.3.5...v1.3.6) (2024-03-06)


### Bug Fixes

* **multi-repo:** use workflow_job_id when search for gha_workflow_runs in db ([ae16fd9](https://github.com/mdolinin/gha-conductor/commit/ae16fd95ea607c273524d5cb8ab4f89eacdc7267))

## [1.3.5](https://github.com/mdolinin/gha-conductor/compare/v1.3.4...v1.3.5) (2024-03-06)


### Bug Fixes

* **multi-repo:** use repo full name when search for triggered hooks ([cd4e57a](https://github.com/mdolinin/gha-conductor/commit/cd4e57a128d09a5557dd44c52ba258c7ca87e0fc))

## [1.3.4](https://github.com/mdolinin/gha-conductor/compare/v1.3.3...v1.3.4) (2024-03-06)


### Bug Fixes

* **container:** install git binary into container for simple-git ([953beac](https://github.com/mdolinin/gha-conductor/commit/953beac1cb2f7366f94c14d28d0fa81b2b9fb8cc))

## [1.3.3](https://github.com/mdolinin/gha-conductor/compare/v1.3.2...v1.3.3) (2024-02-13)


### Bug Fixes

* **deploy:** revert redundant changes ([af63b53](https://github.com/mdolinin/gha-conductor/commit/af63b537b280f03a7c0253df4503b2cd6f7e95b7))

## [1.3.2](https://github.com/mdolinin/gha-conductor/compare/v1.3.1...v1.3.2) (2024-02-13)


### Bug Fixes

* **deploy:** decode private key from base64 ([54ddfb7](https://github.com/mdolinin/gha-conductor/commit/54ddfb73c1eb2d5f23f059a0fd97ae8d07a89484))

## [1.3.1](https://github.com/mdolinin/gha-conductor/compare/v1.3.0...v1.3.1) (2024-02-13)


### Bug Fixes

* **deploy:** add public/index.html for vercel build and hosting ([b127369](https://github.com/mdolinin/gha-conductor/commit/b127369ae030f055083c90d9ab87f95ad2c76926))

# [1.3.0](https://github.com/mdolinin/gha-conductor/compare/v1.2.0...v1.3.0) (2024-02-13)


### Features

* **deploy:** define middleware to deploy into vercel ([9421a2f](https://github.com/mdolinin/gha-conductor/commit/9421a2f42698ea0b9ad4cb40633a696fc9622dde))

# [1.2.0](https://github.com/mdolinin/gha-conductor/compare/v1.1.0...v1.2.0) (2024-02-13)


### Features

* **ci:** use github PAT for release ([45b7dea](https://github.com/mdolinin/gha-conductor/commit/45b7dea81499bba50cf1a8ca28317448d2fae069))

# [1.1.0](https://github.com/mdolinin/gha-conductor/compare/v1.0.0...v1.1.0) (2024-02-13)


### Features

* **ci:** add semantic-changelog ([9c47b23](https://github.com/mdolinin/gha-conductor/commit/9c47b23c234e6c59de47707dc8bfb871cc2b91b4))
