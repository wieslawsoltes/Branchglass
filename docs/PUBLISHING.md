# Publishing Branchglass

Repository: https://github.com/wieslawsoltes/Branchglass

GitHub Pages: https://wieslawsoltes.github.io/Branchglass/

## Automated publication

The Pages workflow tests the source, downloads the optional pinned browser Git dependency, builds `_site/`, uploads the static artifact, and deploys it. Pushes to `main` and manual workflow dispatches publish the site. Pull requests run the CI checks without deploying.

```sh
npm test
npm run vendor
npm run build:pages
```

`_site/` contains only `web/`, license notices, a `.nojekyll` marker, and `build.json`. It deliberately excludes the Node bridge, development scripts, tests, repository metadata, and credentials. All application assets use relative paths so a project site at `/Branchglass/` works. The browser Git dependency is included in the deployed artifact rather than requiring a CDN download at first use.

The public site starts in the explicitly labeled, in-memory sandbox. Open repository → Browser folder can use supported browser folder grants; initialization and HTTPS cloning can use origin-private storage. Browser permissions, API support, and remote CORS requirements still apply. The hosting page cannot execute installed Git or use SSH keys.

For native Git, clone the source, run `npm run demo` or `node server/index.mjs --root ... --repo ...`, and open the private loopback URL printed by the launcher. Do not paste its token into the public Pages site. Do not expose the bridge to the Internet.

## Verification

Node tests include static artifact isolation, project-subpath asset resolution, and source-directory overwrite protection. The separate browser CI job runs `tests/ui_smoke.py` with ordinary localhost navigation, disposable repositories, and pinned Playwright/Chromium. CI results describe that runner only; they are not a hardware WebGPU benchmark or a cross-platform certification.
