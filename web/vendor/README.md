# Optional browser Git dependency

Run `npm run vendor` while online to download isomorphic-git 1.41.9 and its MIT license here. No dependency binary/source is bundled in this directory. The native Git route and standalone sandbox need no vendoring or npm install.

Without a vendored copy, explicitly choosing browser Git tries the pinned jsDelivr distribution. Review dependencies for your security requirements; the loader does not currently verify SRI. Browser Git is experimental and subject to folder-permission, compatibility and CORS limitations described in the root README.
