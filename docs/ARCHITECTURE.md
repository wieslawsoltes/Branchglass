# Architecture

## Frontend and provider boundary

`web/index.html` loads one stylesheet and one ES-module entry point. There is no React, Vue, bundler, Electron runtime, WebAssembly Git binary, external font, or canvas-text library. `app.js` coordinates application state, views, asynchronous requests and action dispatch. UI strings originating in repository content are escaped before insertion. Forms, keyboard focus, text inputs, dialogs and menus remain HTML.

Each repository provider exposes `call(action, args)` and a small repository descriptor. NativeProvider sends an authenticated JSON envelope to the **same-origin** `/api`. BrowserProvider delegates supported operations to the optional isomorphic-git package and HandleFS. DemoProvider operates on explicitly synthetic in-memory head/index/working-file maps. Unsupported operations throw capability errors; there is no fallback that reports a fake Git success.

The separate GitHub client calls REST directly after the user supplies a repository and token. Git traffic still uses the selected repository backend. GitHub collaboration does not silently use the bridge's credential helper or any connected assistant account.

## Graph pipeline

1. Native Git returns topologically ordered commits and actual parent IDs. Browser Git produces a topological ordering of the commits it collected.
2. `layoutGraph` assigns active lanes, parent edges and merge nodes. Parents outside loaded history are represented as truncated continuation edges rather than invented commits.
3. A worker handles layout where worker creation is supported. Request IDs separate stale results from the current view.
4. `GraphRenderer.geometry` scans loaded nodes/edges, emits only relevant node geometry and visible-crossing edges, and tessellates lines, curved turns and node circles. It returns interleaved normalized-device coordinates and RGBA values (24 bytes per vertex).
5. WGSL vertex/fragment shaders draw a triangle list. A vertex buffer grows geometrically and is reused. Canvas sizing is device-pixel-aware, with the DPR capped at 2.
6. Scrolling, selection, resizing, theme changes or a new graph invalidate the scene. There is no continuous idle animation loop. Device loss switches to Canvas 2D. Destruction guards prevent an old async renderer from reattaching after navigation.

History metadata is independently virtualized in HTML rows of fixed height. The graph overlay has no pointer interception; row interaction remains available to the ordinary DOM. Graph-only rendering is not a claim that every UI pixel uses WebGPU. Current geometry generation still scans the loaded scene; it is not an indexed million-edge renderer.

WebGPU requires the relevant browser/platform APIs and an available adapter. Those requirements and compatibility evolve: [MDN WebGPU](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API). The fallback was tested here; hardware WebGPU was not.

## Text diff and editor

`core/diff.js` tokenizes lines while retaining newline bytes. It trims common prefixes/suffixes and computes a bounded Myers-style edit script. Its work budget avoids unconstrained computation on highly divergent inputs; the fallback reconstructs the target exactly but can be nonminimal. A shared algorithm produces stable changed-line IDs for display and native partial-index composition.

Diff display supports split/unified rows, grouped unchanged context, a simple syntax tokenizer and character-prefix/suffix intraline emphasis. Syntax coloring is intentionally lightweight, not a grammar/LSP implementation. Long lines and large text inputs remain a performance limit. Display-only whitespace/context controls are separate from the actual bytes passed to staging.

Native partial staging rereads the source pair, verifies before/after hashes, rejects renamed/conflicted/nonregular files, and composes only the selected changes. It writes a Git blob and updates the index entry. This keeps the working tree unchanged. Working-to-index selection is refused when attributes or autocrlf could transform the content; native whole-file `git add` remains available. See [check-attr](https://git-scm.com/docs/git-check-attr).

The editor uses a textarea with a line-number gutter. Saves reread the current file, compare its digest with the opened version, write a same-directory temporary file and rename it into place. The mode is retained for existing native regular files. This is not a system-wide transactional compare-and-swap: another external writer can still race between checks and the rename. Unsaved-navigation prompts protect changes inside the app, not against OS crashes or storage loss.

## Native bridge

`server/index.mjs` uses Node's HTTP, filesystem, path and crypto modules. It serves only `web/`, validates the Host and Origin, requires a random token for `/api`, limits bodies, and adds a restrictive CSP and related headers. The token starts in a URL fragment, is moved to session storage where available, and is not included in ordinary URL query logs by the app.

`server/git.mjs` uses `spawn('git', argv)` with argument arrays, not interpolated shell commands. Operations are mapped to an explicit allowlist. Ref names/revisions/paths are validated, option-ending markers are used where appropriate, and Git errors are returned to the UI. Git output, editor sizes and process duration are bounded. Writes to a registered repository are serialized within that server process; Git's own locks remain necessary.

The working folder, Git directory and common Git directory must resolve under the authorized root. Application file APIs reject `.git`, upward traversal, absolute paths and symlink editing. These controls are **not** an OS-level sandbox. Existing Git filters, signing/credential helpers and repository configuration can execute programs with the bridge user's rights.

Interactive rebase creates a bounded plan and temporary editor data. A dedicated Node helper supplies the sequence and reword messages. The UI does not accept arbitrary `exec` rebase steps or general shell commands. Conflicts leave Git's actual sequence state available to Continue/Abort/Skip. Restarting the server mid-plan is not a supported recovery guarantee for custom reword/squash editing; native Git remains the recovery route.

## Browser filesystem adapter

HandleFS implements the promise-oriented subset of the [isomorphic-git filesystem contract](https://isomorphic-git.org/docs/en/fs): file/directory handles, byte reads/writes, directory operations and synthetic stat information. It supports the granted folder or OPFS, not arbitrary filesystem paths. Symlink operations are unsupported, chmod cannot preserve POSIX semantics, rename is implemented by copy/remove, and exclusive-create emulation is not an OS-atomic lock.

Web Locks coordinate Branchglass tabs within one origin where available. They do not lock out another app or native Git process. Browser mode must therefore not be used concurrently on the same repository with an external client. Compatibility guards inspect Git modes, attributes/configuration and sequencer metadata before content/index mutations, but cannot prove that a repository has no unsupported behavior.

The [directory picker](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker) requires support, secure context, user activation and a grant. Browser private storage belongs to an origin and profile. This release does not implement repository-wide export or storage durability guarantees.

Browser Git network transport buffers request bodies and streams responses through fetch. Large packs can require substantial memory. Only HTTPS remotes are accepted. Native SSH credentials cannot be borrowed by a static page. CORS behavior is described in the [isomorphic-git quick start](https://isomorphic-git.org/docs/en/quickstart). A proxy is an explicit trust choice, not a transparent privacy feature.

## Observability and bounds

The diagnostics view and frozen `window.Branchglass.diagnostics()` expose counts and rendering state, not credentials. The activity view shows bounded native command output. CPU geometry/submission time is not GPU timing. Insights count only loaded history, with that scope shown in the UI.

Defaults/limits: 500 initial commits; 5,000 loaded-history cap; 200 interactive rebase steps; 4 MiB editor/per-side diff; 32 MiB Git output; 12 MiB request body; 1,000 search matches; 120-second local Git and 600-second network timeout. History/diff/blame DOM are virtualized; file-tree and secondary lists are not yet fully virtualized. No service-worker/offline cache or automatic filesystem watcher is included. Refresh occurs through explicit actions and selected focus transitions.
