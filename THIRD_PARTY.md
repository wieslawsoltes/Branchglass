# Third-party notices

Branchglass code, shaders, styles, icon paths and synthetic demonstration content in this archive are provided under the accompanying MIT license. Product names in research documentation identify their respective products; no affiliation or feature-parity endorsement is implied.

The optional browser Git backend uses **isomorphic-git**, pinned to 1.41.9, an upstream MIT-licensed project. Its distribution is not included in this delivery. `npm run vendor` downloads the distribution and the upstream `LICENSE.md` into `web/vendor/`; preserve that license when redistributing those files. The runtime can instead load the pinned jsDelivr copy on demand when browser Git is explicitly chosen. Refer to the upstream package/license for the authoritative notices and bundled dependency information.

Git, Node.js, Git LFS and browser software are separately installed programs, not bundled binaries. Python and Playwright are optional test tools, not runtime dependencies. No fonts, commercial client source code or proprietary reference screenshots are bundled. The interface uses the user's system fonts; the CSS's font stack does not download a font.

Primary references: https://isomorphic-git.org/ and https://www.npmjs.com/package/isomorphic-git . Research-source links are in docs/FEATURE_RESEARCH.md.
