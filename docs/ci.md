# CI checks and GitHub Pages

Four workflows run on pull requests, pushes to `main`, and manual dispatch:

| Workflow | Purpose |
| --- | --- |
| `zizmor.yml` | Audit all GitHub Actions workflows with zizmor1.31.1, pedantic mode; fail on findings and annotate failures without requiring Advanced Security write permissions. |
| `oxlint.yml` | Run pinned oxlint1.89.0; all warnings fail CI. |
| `oxfmt.yml` | Check formatting with pinned oxfmt0.74.0 without rewriting files in CI. |
| `pages.yml` | Build the web app, gallery and Storybook; only trusted `main` pushes/manual runs deploy. PRs build only. |

Local commands: `yarn lint`, `yarn fmt:check`, `yarn fmt`, `VITE_BASE_PATH=/hledger-app/ yarn build:pages`. Install using `yarn install --immutable`. The format bootstrap reformats existing code; Markdown research/QA documentation, PO sources, generated Lingui catalogs and generated GraphQL output are excluded. Generated catalogs are checked by `yarn i18n:check` instead. Three control-character validation expressions have narrow, explained lint exceptions; no general warning suppression is configured.

Every external Action is SHA-pinned, including the existing mobile release workflow. Checkout does not persist credentials. Only the deploy job has Pages/OIDC write permissions. The six package-manager bootstrap steps have narrowly scoped zizmor exceptions for the exact Corepack version; application dependency installs always use `yarn.lock`. Package-manager version and SHA pins should be reviewed together when updating.

Pages uses the repository subpath, publishing compiled files only:

- `/hledger-app/`: web ledger frontend
- `/hledger-app/gallery/`: design gallery, including direct entry/refresh
- `/hledger-app/storybook/`: Storybook

The build emits `dist/pages` and never includes local ledger files, access tokens, fetched source pages, scraped logo previews or runtime caches. The backend is not deployed: users need a separately running API with appropriate browser access/CORS and transport settings. An HTTPS Pages frontend does not make an HTTP backend publicly reachable or bypass browser local-network/mixed-content restrictions. A custom domain/root-path setup needs a corresponding base-path adjustment; the workflow defaults to repository Pages.

Enable Pages with GitHub Actions as its publishing source. The `github-pages` environment is the deployment target; repository/environment protection rules still apply. Deployments are serialized and are not canceled mid-release. See the official [GitHub Pages publishing documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site), [Vite static deployment guide](https://vite.dev/guide/static-deploy.html), [zizmor integration guide](https://docs.zizmor.sh/integrations/), and [Oxfmt guide](https://oxc.rs/docs/guide/usage/formatter/quickstart.html).

## Initial rollout verification (2026-10-25)

Local oxlint (zero warnings), oxfmt, zizmor pedantic and actionlint passed. All306 API/domain/client tests,18 locale tests,5 catalog tests and full TypeScript checks passed after the formatting bootstrap. The Pages build and its asset references passed; an actual static browser session rendered the app, followed the gallery link, refreshed its direct URL and rendered a Storybook preview under `/hledger-app/`. No generated scraped preview data or local credentials were included.

GitHub Pages was not previously enabled. Attempting the requested Actions publishing setup returned HTTP422: `Your current plan does not support GitHub Pages for this repository.` Repository visibility was not changed. Until the account/repository is eligible and Pages is enabled with the Actions publishing source, the Pages deploy job cannot succeed; a successful build is not a deployment. Rerun the workflow after that external prerequisite is resolved.

On2026-10-26, the owner made the repository public. Pages Actions publishing was then enabled successfully at `https://moreal.github.io/hledger-app/`; the initial plan restriction above is historical. Deployment still requires a successful workflow run.
