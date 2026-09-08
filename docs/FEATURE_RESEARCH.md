# Git-client feature research and implementation map

Research date: **2026-09-07**. Scope: primary documentation for eleven representative graphical/visual clients, including two terminal/editor interfaces with influential interaction models. The research is not an exhaustive enumeration of every Git GUI, edition, plugin, subscription feature, or operating-system variation. Products continue to change. Branchglass is an independent implementation, not a copy of their source, artwork, or exact interface.

## Representative clients

| Client and primary source | Interaction/workflow lessons | Branchglass response |
| --- | --- | --- |
| [GitKraken](https://help.gitkraken.com/gitkraken-desktop/branching-and-merging/) and [interactive rebase](https://help.gitkraken.com/gitkraken-desktop/interactive-rebase/) | Visual branch relationships and direct history operations | GPU graph, branch/ref navigation, commit actions, visual linear rebase plan |
| [Fork](https://git-fork.com/) | Dense history, partial staging, image comparisons, blame, reflog and conflict tools | Unified history/changes workspace; line/hunk staging; image split/wipe; blame and reflog; resolver |
| [Sourcetree](https://www.sourcetreeapp.com/) | Visible staging state and approachable graphical repository operations | Separate staged/unstaged groups, commit composer and native remote actions |
| [Tower](https://www.git-tower.com/) | Discoverable native workflows and history management | Searchable commands, repository switching, explicit confirmations and contextual actions; no blanket undo abstraction |
| [SmartGit](https://www.smartgit.dev/features/) | Distinct log/working-tree workflows, three-way conflicts, author/path filtering and history cleanup | History/Changes/Files views, base/ours/theirs resolver, advanced filters and rebase editor |
| [GitHub Desktop](https://docs.github.com/en/desktop/overview/about-github-desktop) | Focused daily work and connection to hosted collaboration | Focused commit path plus an independent, opt-in GitHub REST workspace |
| [GitButler](https://docs.gitbutler.com/features/branch-management/branch-lanes) and [workspace branch](https://docs.gitbutler.com/workspace-branch) | Parallel work and branch lanes beyond a traditional checkout | Native worktrees and conventional branches. **No** equivalent virtual-branch/index-composition model claimed |
| [Git Extensions](https://gitextensions.github.io/) | Broad repository-management surface and visible history | Native operation palette, refs, stashes, tags, worktrees, blame and recovery views |
| [TortoiseGit](https://tortoisegit.org/about/) and [feature manual](https://tortoisegit.org/docs/tortoisegit/tgit-intro-features.html) | Context-driven repository/file operations and familiar native shell integration | Context menus and file actions; **no** OS shell extensions or overlay icons |
| [Magit](https://docs.magit.vc/magit/Introduction.html) and [rebasing](https://docs.magit.vc/magit/Rebasing.html) | Keyboard-oriented, context-sensitive composition of Git operations | Keyboard navigation, palette, contextual menus, partial staging and sequencer controls; not an Emacs mode |
| [lazygit](https://github.com/jesseduffield/lazygit) | Compact panels, keyboard discoverability and interactive history manipulation | Resizable panels, shortcuts, explicit state, line selection and rebase-plan ordering |

## Capability matrix

**N** = implemented through native Git. **B** = implemented in the experimental browser adapter, subject to its compatibility checks. **S** = sandbox interaction only; not evidence of a real repository feature. **External** = requires an installed program/configuration. “Implemented” is not synonymous with fully end-to-end validated on all operating systems; consult the test report.

| Capability | Native | Browser-only | Notes |
| --- | --- | --- | --- |
| Actual commit ancestry graph | N | B | WebGPU or Canvas; virtual DOM metadata |
| History search/filter/load-more | N | Partial B | Browser path filtering explicitly rejected; not all remote/tag reachability is walked |
| Local/remote/tag decorations | N | Partial B | Browser reference listing currently centers on local branches and tags |
| First-parent commit file changes | N | B | Native rename detection/preimage comparison; browser changes detected by content |
| Two-revision diffs | N | B | Text/image/binary viewing within size bounds |
| Split/unified and intraline text | N | B | Shared frontend diff engine |
| Whole-file stage/unstage | N | B | Native mode preserves native filters/modes |
| Hunk/line stage/unstage | N | No | Canonical text only; safe normalization restrictions |
| Editor and stale-save check | N | B | UTF-8 regular files, bounded size; not a full IDE |
| New/rename/delete files | N | Partial B | Browser adapter implements new/save, not rename/delete actions |
| Commit/amend/sign-off | N | B | Requires configured identity |
| Cryptographically signed commit | External | No | Existing Git signing program and agent; not live-tested here |
| Branch creation/rename/deletion | N | B | Native Git checks plus browser current/unmerged branch protections |
| Checkout | N | B | Browser requires clean, supported trees |
| Annotated/lightweight tags | N | B | Local tag operations, not a dedicated remote-tag manager |
| Merge/rebase/cherry-pick/revert | N | No | Real Git, conflict errors retained |
| Three-way resolver and continuation | N | No | Base/ours/theirs + result, marker check and staging |
| Interactive rebase plan | N | No | Pick/reword/squash/fixup/drop/order; linear history only |
| Reset and detached revisions | N | No | Confirmation required |
| Clone/fetch/push | N | B | Browser HTTPS/CORS; native HTTPS/SSH/local |
| Pull and force-with-lease | N | No | Browser force push disabled |
| Remote add/edit/delete | N | Partial B | Browser add/delete; not edit |
| Stash save/apply/pop/drop | N | No | Native include-untracked behavior integration-tested |
| Linked worktrees and locks | N | No | Git/common directory inside authorized root |
| Blame/file history/reflog | N | No | Virtualized blame; recovery via standard commit actions |
| Patch export/apply | N | Partial B | Browser export is selected-file text only |
| Submodule management | N | No | Native status/add/update; broad scenarios untested |
| LFS | External | No | Status/files/pull/track only; installed Git LFS and hook caveat |
| Bisect | N | No | Manual good/bad/skip/reset; no arbitrary shell runner |
| Search | N | B | Literal text, bounded matches; native tracked files |
| GitHub PR/issues/actions | Direct REST | Direct REST | Independent of Git backend; mocked tests, no live account test |
| Theme/layout/command palette | Yes | Yes | Shared frontend; sandbox also supports these |
| Repository statistics | Yes | Yes | Only loaded commits; not a productivity score |

## Intentional departures and gaps

Branchglass uses a hybrid renderer: GPU graph geometry, HTML controls, virtualized selectable text and a native textarea. Rasterizing every control or letter on the GPU would not automatically make Git operations faster, and would require rebuilding text-input, selection and accessibility behavior. There is no claimed FPS advantage over the researched products.

The native backend was prioritized over attempting to emulate every Git edge case on browser filesystem handles. Browser writing is conservative and explicit about unsupported repositories. The static preview's sandbox is visibly distinct and refuses unsupported operations rather than reporting fabricated success.

Features not reproduced include GitButler-style virtual branches, Git-flow/Feature-flow wizards, all-host review systems, Gerrit/Jira integrations, Tower-specific undo/stack workflows, distributed offline review protocols, OS shell integration, language servers, external diff/merge tool launchers, generic command execution, sparse-checkout UI, subtree UI, Git notes, bundles, SVN bridges, and universal repository-repair tooling.

## Platform and Git references

- [WebGPU API](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)
- [Directory picker, activation and compatibility](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker)
- [isomorphic-git quick start and browser/CORS requirements](https://isomorphic-git.org/docs/en/quickstart)
- [isomorphic-git filesystem contract](https://isomorphic-git.org/docs/en/fs)
- [Git porcelain status format](https://git-scm.com/docs/git-status)
- [Git apply](https://git-scm.com/docs/git-apply)
- [Git interactive rebase](https://git-scm.com/docs/git-rebase)
- [Git attributes inspection](https://git-scm.com/docs/git-check-attr)
- [GitHub pulls](https://docs.github.com/en/rest/pulls/pulls), [reviews](https://docs.github.com/en/rest/pulls/reviews), [issues](https://docs.github.com/en/rest/issues/issues), [workflow runs](https://docs.github.com/en/rest/actions/workflow-runs)
