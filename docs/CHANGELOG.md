# [1.10.0](https://github.com/mdolinin/gha-conductor/compare/v1.9.4...v1.10.0) (2024-06-17)


### Features

* **check:** validate gha yaml content and create correct check with PR annotations ([#89](https://github.com/mdolinin/gha-conductor/issues/89)) ([5225402](https://github.com/mdolinin/gha-conductor/commit/522540249186e658bb431bf574bd5382083e2e16))

## [1.9.4](https://github.com/mdolinin/gha-conductor/compare/v1.9.3...v1.9.4) (2024-05-26)


### Bug Fixes

* **loader:** reconcile new hooks with existing instead of bulk remove and insert ([#73](https://github.com/mdolinin/gha-conductor/issues/73)) ([4ba3dec](https://github.com/mdolinin/gha-conductor/commit/4ba3dec887c993160ff1db156040e0602176bd5a))

## [1.9.3](https://github.com/mdolinin/gha-conductor/compare/v1.9.2...v1.9.3) (2024-05-22)


### Bug Fixes

* **checks:** skip re-run if workflow fails to start first time and include successful workflow run results into pr-check, when re-run only failed ([#69](https://github.com/mdolinin/gha-conductor/issues/69)) ([73b269b](https://github.com/mdolinin/gha-conductor/commit/73b269b8df20657e508253cc3e8d3a75ef677d2f))

## [1.9.2](https://github.com/mdolinin/gha-conductor/compare/v1.9.1...v1.9.2) (2024-05-19)


### Bug Fixes

* **loader:** use logger from probot app instead of create new one ([#67](https://github.com/mdolinin/gha-conductor/issues/67)) ([1043aea](https://github.com/mdolinin/gha-conductor/commit/1043aea4996a3d0416ec0c3964ca2c0970072c87))

## [1.9.1](https://github.com/mdolinin/gha-conductor/compare/v1.9.0...v1.9.1) (2024-05-19)


### Bug Fixes

* **workflow:** verify workflow exist and active before trigger ([#45](https://github.com/mdolinin/gha-conductor/issues/45)) ([ef18ce7](https://github.com/mdolinin/gha-conductor/commit/ef18ce7bc61d57459196bee9b526c55acd06f08b))

# [1.9.0](https://github.com/mdolinin/gha-conductor/compare/v1.8.0...v1.9.0) (2024-04-28)


### Features

* **slash-command:** provide ability to define and trigger GHA workflows using PR comment with /command ([#42](https://github.com/mdolinin/gha-conductor/issues/42)) ([196bc01](https://github.com/mdolinin/gha-conductor/commit/196bc011146896f8c443d2e4ed5daf0cf233062e))

# [1.8.0](https://github.com/mdolinin/gha-conductor/compare/v1.7.0...v1.8.0) (2024-04-13)


### Features

* **params:** simplify GHA workflow inputs to require only PIPELINE_NAME and SERIALIZED_VARIABLES ([#38](https://github.com/mdolinin/gha-conductor/issues/38)) ([6f4e183](https://github.com/mdolinin/gha-conductor/commit/6f4e1837ca623b87795608e4f3a75e72af4023ff))

# [1.7.0](https://github.com/mdolinin/gha-conductor/compare/v1.6.0...v1.7.0) (2024-04-07)


### Features

* **params:** serialize all pipeline params and shared params into SERIALIZED_VARIABLES to avoid limit of 10 inputs for GHA workflow ([#27](https://github.com/mdolinin/gha-conductor/issues/27)) ([e1b45d1](https://github.com/mdolinin/gha-conductor/commit/e1b45d1d8381c56c7c76496d6df88cdf7e472acf))

# [1.6.0](https://github.com/mdolinin/gha-conductor/compare/v1.5.1...v1.6.0) (2024-04-06)


### Features

* **gha:** add capability to specify branch name for pipeline ([#22](https://github.com/mdolinin/gha-conductor/issues/22)) ([091a0f1](https://github.com/mdolinin/gha-conductor/commit/091a0f1fe34d90d420dff6717723b0a59d1d391b))

## [1.5.1](https://github.com/mdolinin/gha-conductor/compare/v1.5.0...v1.5.1) (2024-03-31)


### Bug Fixes

* **docker:** add workaround to preinstall js-yaml types ([#16](https://github.com/mdolinin/gha-conductor/issues/16)) ([a827853](https://github.com/mdolinin/gha-conductor/commit/a8278539e8bbcd28491439d09b5a954ba36c0153))

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
