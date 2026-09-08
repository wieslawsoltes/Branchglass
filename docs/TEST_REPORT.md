# Verification report

Delivery: Branchglass 0.1.0, **2026-09-07**. This report separates executed checks from implementation claims. Passing this suite is not a production-readiness certification.

## Environment and results

| Item | Observed |
| --- | --- |
| Host | Linux container |
| Node.js | 22.16.0 |
| Git | 2.47.3 |
| UI browser | Headless Chromium 144.0.7559.96 |
| Node tests | **26 passed, 0 failed** |
| UI workflow checks | **17 passed, no captured page exceptions** |
| Renderer used in UI checks | Canvas 2D fallback |
| 5,000-commit synthetic scene | **14** history rows mounted at the captured viewport; assertion requires fewer than 60 |
| Native remote tests | Disposable local bare repositories, not live hosting services |
| GitHub tests | Mocked fetch contract tests, not a live authenticated account |

Raw results: [Node TAP output](results/node-tests.txt), [UI JSON](results/ui.json). Screenshots in `screenshots/` are actual renders of this application's HTML, not generated concept images. Dark/light screenshots show the explicitly labeled sandbox; `native.png` shows a real disposable native repository.

## Executed Node tests

Eight diff tests cover exact before/after reconstruction, edge cases such as empty/non-final-newline/CRLF text, **1,500 deterministic randomized input pairs**, selected-line composition, split/unified row IDs, bounded fallback behavior, diff3 conflict parsing, and graph parent/merge/truncated-history geometry relationships.

Eleven native integration tests use independently created temporary repositories. Coverage includes porcelain-v2 parsing; Unicode, spaces, tabs and leading-dash filenames; root commits; binary/non-UTF-8 rejection; symlink, `.git` and root restrictions; stale-save checks; actual index-only partial staging and unstaging; new-file selections; sign-off; branch operations; annotated tags; stashes including untracked removal/restoration; worktree add/lock/unlock/remove; blame/reflog; local clone/fetch/push/fast-forward pull; force confirmation; merge conflicts and three-way resolution/continuation; first-parent merge file changes; visual rebase plan reorder/reword/fixup/drop; exact native patch application; rename preimages; disabled pre-commit hooks; attribute-normalization guards; cherry-pick/revert/reset/manual bisect; and detached-HEAD tip visibility.

One live loopback HTTP test covers token, Host, Origin, content type, API method, static serving, CSP and authorized-root constraints. Two mocked GitHub-client tests cover API request construction, pagination, review/merge SHA parameters, issues/workflow actions and surfaced errors. Four browser/renderer contract tests cover native provider envelopes, browser write-mode/configuration guards, branch checkout/deletion safety, and finite viewport-culled graph vertices. Browser Git itself is stubbed in those contract tests.

## Executed UI checks

The 17 checks exercise application boot, dark/light themes, command palette keyboard selection and diagnostics, native repository loading, one-line staging, whole-file unstaging, hunk staging, stage-all/commit, file editing/keyboard save, unsaved-navigation cancellation, branch creation/checkout, repository identity settings, thirteen secondary workspace renders, literal search-to-file navigation, nested connection-dialog replacement/cancellation, commit inspection, and a 5,000-commit synthetic virtualization scene.

The real `NativeProvider` is used. Repository-changing UI actions reached the actual Node bridge and installed Git; their effects were checked through the API and file/index contents. The tests do not replace native Git operations with a fake success response.

This environment's managed Chromium blocks URL navigation and disables filesystem grants. The test therefore used **inline page content**, test-provided SHA-256 and in-memory web storage, and a forwarding function for same-origin `/api` requests to the real local server. Browser policies were not changed. Workers could not start in that opaque-origin harness, so the shared synchronous fallback ran. These accommodations mean the checks are **not** an end-to-end validation of ordinary localhost navigation, secure-context APIs, module workers, File System Access permissions, OPFS persistence, or hardware WebGPU.

## Reproduction

Native tests need only installed Node.js and Git:

```sh
npm test
npm run build:preview
```

Optional UI testing needs Python's Playwright package and a Chromium installation. After installing those in your own environment, use:

```sh
# Default: ordinary localhost navigation and the actual module entry point.
python tests/ui_smoke.py --chromium /path/to/chromium

# The mode used for this delivery's navigation-restricted browser:
python tests/ui_smoke.py --inline --chromium /path/to/chromium
```

The Python harness creates its own temporary repository and random-token bridge, blocks external HTTPS requests during the test, captures screenshots/results and terminates its server. It does not open or mutate user repositories. It injects test-only state access in memory; that hook is absent from the shipped application/preview.

The default normal-navigation variant is provided for a suitable machine but was not executed here. Do not count it as verified merely because the inline mode passed. On supported machines, manually validate the launch URL, actual worker status and selected GPU backend in Rendering diagnostics.

## Not validated in this delivery

Hardware WebGPU shader compilation/execution, GPU frame timings, sustained FPS, adapter/device-loss recovery on real hardware, live HTTPS/SSH authentication, live GitHub mutations, signed commits with a real key agent, Git LFS transfers, broad submodule workflows, browser Git with the actual optional distribution, real directory grants/OPFS/CORS clone flows, Windows/macOS behavior, accessibility with screen readers, long-duration concurrent editing, huge binaries/packfiles, and full monorepo-scale performance were not end-to-end tested.

The optional browser Git package could not be downloaded from this environment's restricted network. It remains an on-demand/vendored dependency, not a bundled or live-tested library in this archive.

## Fixes found during verification

Tests and UI inspection exposed and led to fixes for stash include-untracked cleanup, merge first-parent file lists, rename preimages, annotated-tag graph placement, partial-staging normalization, nested-dialog close races, changed-line action IDs, renderer teardown, hover-only staging interaction in the test, branch-filter wiring, and stale editor views while asynchronous file reads complete. Assertions remain around the primary paths, but not every variant has regression coverage.
