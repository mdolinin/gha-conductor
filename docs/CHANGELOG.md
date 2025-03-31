# [1.21.0](https://github.com/mdolinin/gha-conductor/compare/v1.20.10...v1.21.0) (2025-03-31)


### Features

* **sync:** add sync status action ([#348](https://github.com/mdolinin/gha-conductor/issues/348)) ([8b3e39e](https://github.com/mdolinin/gha-conductor/commit/8b3e39e779aafa3159ba34d2bdda41b5af8f80d0))

## [1.20.10](https://github.com/mdolinin/gha-conductor/compare/v1.20.9...v1.20.10) (2025-02-20)


### Bug Fixes

* **main:** use correct import for dd-trace ([#316](https://github.com/mdolinin/gha-conductor/issues/316)) ([3c88efb](https://github.com/mdolinin/gha-conductor/commit/3c88efb62f8e03a42deb996d716eef8d3594cce9))

## [1.20.9](https://github.com/mdolinin/gha-conductor/compare/v1.20.8...v1.20.9) (2025-02-20)


### Bug Fixes

* **gha-checks:** truncate workflow logs to GitHub bytesize limit of 65535 ([#314](https://github.com/mdolinin/gha-conductor/issues/314)) ([bb0b118](https://github.com/mdolinin/gha-conductor/commit/bb0b1186d7130b06f79d3456c8268552ff3148d0))

## [1.20.8](https://github.com/mdolinin/gha-conductor/compare/v1.20.7...v1.20.8) (2025-01-04)


### Bug Fixes

* **gha-checks:** reduce summary size to not go over limit ([#272](https://github.com/mdolinin/gha-conductor/issues/272)) ([ed97e03](https://github.com/mdolinin/gha-conductor/commit/ed97e033893a46565da75cb08b01755fdb61ac8f))

## [1.20.7](https://github.com/mdolinin/gha-conductor/compare/v1.20.6...v1.20.7) (2024-12-30)


### Bug Fixes

* **pr-checks:** create check before trigger new workflows ([#267](https://github.com/mdolinin/gha-conductor/issues/267)) ([94d2d52](https://github.com/mdolinin/gha-conductor/commit/94d2d5259adb3512e1020a51ae04562ec8e99f6a))

## [1.20.6](https://github.com/mdolinin/gha-conductor/compare/v1.20.5...v1.20.6) (2024-12-22)


### Bug Fixes

* **hooks:** do not trigger workflows for hooks removed in PR ([#266](https://github.com/mdolinin/gha-conductor/issues/266)) ([da6d331](https://github.com/mdolinin/gha-conductor/commit/da6d331850bfc32f660f28f855b8d6e544114181))

## [1.20.5](https://github.com/mdolinin/gha-conductor/compare/v1.20.4...v1.20.5) (2024-12-07)


### Bug Fixes

* **test:** add timeout when mergeable is null ([#260](https://github.com/mdolinin/gha-conductor/issues/260)) ([d7f0bd8](https://github.com/mdolinin/gha-conductor/commit/d7f0bd8735468fda663549e16ba1e1916ade3a11))

## [1.20.4](https://github.com/mdolinin/gha-conductor/compare/v1.20.3...v1.20.4) (2024-11-09)


### Bug Fixes

* **octokit:** correctly catch error from octokit ([#236](https://github.com/mdolinin/gha-conductor/issues/236)) ([62230f2](https://github.com/mdolinin/gha-conductor/commit/62230f28257c55d11166c4e2736a61a998732e21))

## [1.20.3](https://github.com/mdolinin/gha-conductor/compare/v1.20.2...v1.20.3) (2024-11-07)


### Bug Fixes

* **gh-checks:** github check summary for multiple workflow runs should not go over limit ([#231](https://github.com/mdolinin/gha-conductor/issues/231)) ([665df66](https://github.com/mdolinin/gha-conductor/commit/665df664594837120af88a02a4f75cacbbd6d8c2))

## [1.20.2](https://github.com/mdolinin/gha-conductor/compare/v1.20.1...v1.20.2) (2024-11-06)


### Bug Fixes

* **gh-checks:** catch and correctly log errors from octokit rest client ([#230](https://github.com/mdolinin/gha-conductor/issues/230)) ([8cd26db](https://github.com/mdolinin/gha-conductor/commit/8cd26db93428f5b695d9d18c9da66a80791709fc))

## [1.20.1](https://github.com/mdolinin/gha-conductor/compare/v1.20.0...v1.20.1) (2024-11-04)


### Bug Fixes

* **pr-check:** reevaluate checks when the base branch of a pull request was changed ([#227](https://github.com/mdolinin/gha-conductor/issues/227)) ([063a786](https://github.com/mdolinin/gha-conductor/commit/063a786c9e3fb193777894e7732217a387f5fe6f))

# [1.20.0](https://github.com/mdolinin/gha-conductor/compare/v1.19.0...v1.20.0) (2024-08-30)


### Features

* **monitoring:** add dd-tracer ([#168](https://github.com/mdolinin/gha-conductor/issues/168)) ([01bb240](https://github.com/mdolinin/gha-conductor/commit/01bb2407062fa342193babb6508f5e1807be39e7))

# [1.19.0](https://github.com/mdolinin/gha-conductor/compare/v1.18.0...v1.19.0) (2024-08-18)


### Features

* **pr-merge:** create PR comment with check url after merge if failed ([#157](https://github.com/mdolinin/gha-conductor/issues/157)) ([a97fda7](https://github.com/mdolinin/gha-conductor/commit/a97fda7d37ecd2ce9ed48af56126b8453583c1d4))

# [1.18.0](https://github.com/mdolinin/gha-conductor/compare/v1.17.1...v1.18.0) (2024-08-09)


### Features

* **schema:** make onBranchMerge hook optional ([#150](https://github.com/mdolinin/gha-conductor/issues/150)) ([6266546](https://github.com/mdolinin/gha-conductor/commit/6266546349d2e4d04591af40ee747fb17b52e9dd))

## [1.17.1](https://github.com/mdolinin/gha-conductor/compare/v1.17.0...v1.17.1) (2024-08-08)


### Bug Fixes

* **hooks:** persist workflow run as soon as it dispatched ([#149](https://github.com/mdolinin/gha-conductor/issues/149)) ([f80a71e](https://github.com/mdolinin/gha-conductor/commit/f80a71e6ad1848540a4eba2978f3736e978c6792))

# [1.17.0](https://github.com/mdolinin/gha-conductor/compare/v1.16.2...v1.17.0) (2024-07-05)


### Features

* **healthcheck:** add /api/health endpoint and node script to verify app ([#116](https://github.com/mdolinin/gha-conductor/issues/116)) ([0d44b5f](https://github.com/mdolinin/gha-conductor/commit/0d44b5f789df0c4ed9e660a9cbd2cefa770ee099))

## [1.16.2](https://github.com/mdolinin/gha-conductor/compare/v1.16.1...v1.16.2) (2024-06-27)


### Bug Fixes

* **gha-loader:** correctly load hooks when onPullRequest or onBranchMerge is empty list ([#115](https://github.com/mdolinin/gha-conductor/issues/115)) ([bfb19a4](https://github.com/mdolinin/gha-conductor/commit/bfb19a44bb967d9649408d9b93e76a00c69bb388))

## [1.16.1](https://github.com/mdolinin/gha-conductor/compare/v1.16.0...v1.16.1) (2024-06-26)


### Bug Fixes

* **schema:** remove not required params and catch errors from validation process ([#111](https://github.com/mdolinin/gha-conductor/issues/111)) ([df63c83](https://github.com/mdolinin/gha-conductor/commit/df63c838628dcbf0809af6659e9b8a73f621684a))

# [1.16.0](https://github.com/mdolinin/gha-conductor/compare/v1.15.1...v1.16.0) (2024-06-22)


### Features

* **hooks:** before dispatch, validate workflow inputs and provide input values from context, params or sharedParams ([#107](https://github.com/mdolinin/gha-conductor/issues/107)) ([f280f16](https://github.com/mdolinin/gha-conductor/commit/f280f16549a9d62527a674f255f576f4ffaef85e))

## [1.15.1](https://github.com/mdolinin/gha-conductor/compare/v1.15.0...v1.15.1) (2024-06-22)


### Bug Fixes

* **hooks:** group hooks by pipeline unique name, pr hooks takes precedence and tigger only one hook if multiple files matched ([#106](https://github.com/mdolinin/gha-conductor/issues/106)) ([2b07cd8](https://github.com/mdolinin/gha-conductor/commit/2b07cd822f2c60de44129fce1d423bb6dfbaa2e2))

# [1.15.0](https://github.com/mdolinin/gha-conductor/compare/v1.14.0...v1.15.0) (2024-06-21)


### Features

* **gha-loader:** load hooks from files changed in commits on push instead of whole repo ([#105](https://github.com/mdolinin/gha-conductor/issues/105)) ([5865d07](https://github.com/mdolinin/gha-conductor/commit/5865d0789746bd6d7b9696ebc003e60141c32b4b))

# [1.14.0](https://github.com/mdolinin/gha-conductor/compare/v1.13.0...v1.14.0) (2024-06-21)


### Features

* **config:** provide ability to configure workflow file extension ([#104](https://github.com/mdolinin/gha-conductor/issues/104)) ([1df7464](https://github.com/mdolinin/gha-conductor/commit/1df7464cda304348b9ab2e671b9d448ab827e978))

# [1.13.0](https://github.com/mdolinin/gha-conductor/compare/v1.12.0...v1.13.0) (2024-06-19)


### Features

* **docker:** build and publish docker image for linux/amd64 and linux/arm64 platforms ([#98](https://github.com/mdolinin/gha-conductor/issues/98)) ([4954871](https://github.com/mdolinin/gha-conductor/commit/49548714964ce62b3cb4e306a462787eec08204c))

# [1.12.0](https://github.com/mdolinin/gha-conductor/compare/v1.11.0...v1.12.0) (2024-06-19)


### Features

* **config:** environment variables can be used to override app configuration options ([#97](https://github.com/mdolinin/gha-conductor/issues/97)) ([10f4797](https://github.com/mdolinin/gha-conductor/commit/10f4797d762d88e7cd316bb9fe0e42597a07c2dc))

# [1.11.0](https://github.com/mdolinin/gha-conductor/compare/v1.10.0...v1.11.0) (2024-06-18)


### Features

* **config:** provide ability to change gha hooks file name using config ([#91](https://github.com/mdolinin/gha-conductor/issues/91)) ([e86195b](https://github.com/mdolinin/gha-conductor/commit/e86195bddf61f2d39dc6d27ff801178b06902ed1))

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
