# Security and repository safety

**Engineering preview, not a security-audited product or repository sandbox.** Use disposable copies first and maintain independent backups. Do not run it as administrator/root for ordinary use. Do not open untrusted repositories just because the interface is in a browser.

## Local trust boundary

The server binds to `127.0.0.1`, validates its expected Host and same-origin Origin, and requires a random 256-bit launch token in a header on JSON API requests. No CORS permission is granted to arbitrary hosted frontends. Keep the printed URL private. Do not publish a fixed `BRANCHGLASS_TOKEN`, expose the bridge via a tunnel/reverse proxy, or serve this source from an untrusted modified copy.

The private URL's fragment is consumed into session storage where supported and removed from the address bar. Session storage is accessible to scripts on the same origin. A malicious browser extension, compromised dependency, same-origin XSS, another local process with the token, or a compromised account on the machine is outside these protections. The token is a local capability, not multi-user authorization.

The static server serves `web/`, not the authorized repository root. Repository content is read through explicit API operations. `--root` confines registration, the Git/common directories, and application filesystem operations. Choose a small project parent folder instead of an entire drive.

## Native execution is trusted execution

Git is spawned with argument arrays. The API exposes named operations, not arbitrary shell commands. Revision/branch/path checks, explicit option separators, path confinement, and command-level output/time limits reduce accidental misuse.

Hooks are disabled by default through a private empty hooks directory. `--allow-hooks` deliberately changes that policy. **Disabling hooks does not stop every executable integration:** clean/smudge filters, Git LFS, credential helpers, SSH commands, signing programs, native Git configuration, remote URL rewrites and other configured helpers can still run. Submodule operations and remote operations inherit relevant native behavior. Keep Git updated and use trusted repositories and configuration.

The authorized root is not an OS sandbox. A configured helper can have the same filesystem/network rights as the server process. The app cannot confine Git, helpers, or external clients to that root merely through path checks.

LFS pointer pushes require the normal upload workflow. Since hooks are disabled, do not assume the default Push uploaded LFS content. Enable hooks only for a trusted workflow or perform LFS pushes with your existing native client.

## Writes, history changes and recovery

Native saves compare hashes, preserve file mode and use a temporary-file rename. Partial staging revalidates both sides and preserves the working file. Regular file APIs reject symlinks and `.git` manipulation. Destructive UI actions require confirmation, and force pushes use Git's force-with-lease rather than unconditional force.

These checks cannot undo every Git operation or eliminate external races. App writes are serialized per repository within one server instance only. Another editor, bridge instance or Git client can change files concurrently. Git reflog is exposed for inspection, but is not a permanent backup or universal undo facility. Never assume deleted untracked content is recoverable.

The conflict resolver refuses remaining conflict markers before staging unless explicitly allowed at the backend. It does not verify the semantic correctness of a resolution. The rebase editor is linear-history only and creates new commits; coordinate with collaborators before rewriting shared history. Interrupted interactive rebase may require ordinary native Git recovery.

## Browser mode and optional dependency

Browser Git is opt-in and experimental. A folder grant permits that origin to read and write the granted repository. Stored handles can persist in IndexedDB; permissions may need to be granted again. Tokens for browser Git/GitHub remain in JavaScript memory for the current page, not in a secure credential vault.

The optional pinned isomorphic-git script is either vendored by `npm run vendor` or loaded from jsDelivr. No copy is bundled in this archive, and no subresource-integrity verification is currently implemented. Review and pin your own vetted dependency for sensitive deployments. A script running in the application origin can access repository data and session credentials. Native/sandbox use does not load this optional script.

Browser metadata writes use a limited File System Access adapter, not full POSIX semantics. Exclusive create/rename semantics are not fully atomic. Web Locks coordinate this origin's app tabs only. Do not concurrently access the same folder with another Git client. The browser write preflight blocks known incompatible modes/configurations, but it is not exhaustive detection.

Clearing site data can delete an OPFS repository. Do not treat origin-private storage as a durable backup. Large clones can exhaust memory or quota. A failed browser clone can leave partial metadata. The app does not yet provide a full-repository export/repair tool.

## Remote and provider data

Native Git uses your existing SSH agent and credential helpers. HTTP URLs with embedded credentials are rejected by the app, but inspect existing remote configuration before using it. Git command logging is bounded and attempts to redact embedded HTTP passwords; arbitrary helper stderr may still contain secrets. Review logs before sharing screenshots or exported diagnostics.

Browser remote tokens and optional CORS proxies are explicit. A proxy can see source code and credentials; use only infrastructure you operate or trust. Direct GitHub API actions require appropriate token permissions. Review creation, PR merging, issue creation and workflow controls change remote state only after user action. No OAuth provisioning, token refresh, encrypted vault, organization SSO administration or token-scope discovery is implemented.

Repository-provided HTML/Markdown is not executed by a preview engine. Text is escaped; binary/image previews use bounded blobs/data URLs. The frontend still requires a formal XSS/accessibility/security review before broad deployment.

## Recommended validation before important use

Start with `npm run demo`, then a disposable clone. Run the automated tests, verify the selected backend and authorized root, inspect native Git configuration, and try normal status/staging/commit behavior on your operating system. Validate WebGPU, signing, SSH/HTTPS authentication, Git LFS and submodules in your own environment. Keep native Git available for recovery. Report errors with credentials and repository secrets removed.
