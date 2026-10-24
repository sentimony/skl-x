# Changelog

## 0.4.14 (2026-10-24)

### Changed

- The last line of `skl add` and `skl sln` starts with the scope, like `skl rm` and `skl ls`:
  `Project scope · +8 skills installed · <names>` and `Project scope · +2 skills symlinked · <names>`
  instead of `Installed 8 skills to Project scope · <names>`. With nothing changed, `skl add -m sm`
  and `-m md` print `Project scope · No skills installed`; `skl sln` with nothing selected still
  prints `No skills to symlink in <source>.`
- `skl rm` in `-m md` and `-m sm` prints `Project scope · -27 skills removed · ~3,608 tok`.
- `skl update` prints `skl-x X.Y.Z is already the latest` without the trailing period.

## 0.4.13 (2026-10-24)

### Added

- `skl ls -m sm` prints one line, `Project scope · 30 skills · ~3,333 tok`, instead of the table;
  an empty scope gives `Project scope · No skills`. `-m md`, `-m lg` and no `-m` print the table.
  Shell completion knows `ls -m`, `-g` and `--names`.

### Changed

- `skl rm` in `-m md` and `-m sm` prints `Project scope · -30 skills · ~3,333 tok` instead of
  `Executed 30/30/24 skills from Project scope`: the skills removed from at least one place and
  their cost, read before removal. With nothing to remove it prints `Project scope · No skills`.
  The `.agents`/`.claude`/lock breakdown stays in the `lg` summary.
- Tables of `ls`, `add`, `sln` and `usg` right-align counts, install cells and cost, and center
  the `+`/`-` of the lock column; `cst` right-aligns its cost column.
- Cost cells group thousands everywhere (`~3,333 tok`), as `usg` already did; also the `cst` total.

## 0.4.12 (2026-10-19)

### Added

- `skl uninstall` removes the global skl-x: it asks `Remove skl-x X.Y.Z from the global npm
  install? [y/n]` (`-y` skips the question), runs `npm uninstall -g skl-x`, removes the update-check
  cache `~/.cache/skl-x/version.json` and prints `skl-x X.Y.Z removed.` with a reminder that a
  completion script in a shell rc file stays. Skills are not touched. Under `npx` it removes
  nothing (exit 0), and a local copy exits 1 with its folder. No alias: `rm` removes skills.

### Changed

- `skl update` under `npx` names the version that runs (`skl-x 0.4.12 runs through npx, ...`), and
  both versions when npx ran an older copy from its cache.

## 0.4.11 (2026-10-18)

### Added

- `skl update` (alias `skl up`) installs the latest skl-x from npm globally:
  `npm i -g skl-x@<latest>`, then `skl-x <latest> installed successfully.`; on the latest version it
  prints `skl-x X.Y.Z is already the latest.` and installs nothing. Only a global npm install is
  updated: under `npx` it installs nothing (exit 0), and a local copy (a project dependency or a
  clone) exits 1 with its folder. The update notice is not printed before or after it.

### Changed

- The update notice says `Run: skl update` when skl-x runs from a global npm install, and
  `Run: npm i -g skl-x` otherwise.

## 0.4.10 (2026-10-18)

### Fixed

- `add` no longer removes the `.claude/skills` link that a rerun of `npx skills add -a codex
  claude-code` leaves as it was: every second run left Claude Code without the skills (0.4.9).
  An entry in a dir of an agent named with `-a` is kept; without `-a`, an entry that resolves to
  the skill's entry in the other dir is kept. Entries outside `-a` and `skl sln` links elsewhere
  are still removed.
- `add` exits 1 and names the dir (`skl add: <name> is missing in .claude/skills`) when an added
  skill is missing for an agent of `-a`, instead of printing `Installed`.

## 0.4.9 (2026-10-18)

### Changed

- `sln` removes each selected skill as `skl rm` does before linking it: the copy or link in the
  agent dir outside `-a` and the `skills-lock.json` entry. Without `-y` these are listed with the
  replaced copies (`skills-lock.json - <name>`) under one `Replace N existing skills?` question.
  An entry the source is reached through is refused, as for a replace.
- `add` removes, after `npx skills add` succeeds, the entries of each added skill that `npx` did
  not rewrite (a `skl sln` link or a copy in the agent dir outside `-a`). A failed install leaves
  them in place.

## 0.4.8 (2026-10-12)

### Changed

- **Breaking:** output modes are `-m sm` / `--mode small`, `-m md` / `--mode medium` and
  `-m lg` / `--mode large` (default) in `add`, `sln` and `rm`. The 0.4.6 names exit 1 with a hint:
  `q`/`quiet` → `sm`, `s`/`silent` → `md`, `c`/`clear` → `lg`.
- `add` and `sln` end with a summary line, `Installed N skills to <scope> · <names>` or
  `Symlinked N skills to <scope> · <names>`; `sm` prints only that line (no `from <source>` any
  more). `<scope>` is `Project scope`, or `Global scope` with `-g`.
- The progress line names the count and the scope and drops the summary: `Installing 1 skill
  from <source> to Project scope ██████████ 100%`, `Symlinking 2 skills from <path> to Project
  scope ██████████ 100%`.
- `rm` in `md` and `sm` names the scope: `Executed A/B/C skills from Project scope`.
- In a terminal the progress, summary and `Executed` lines are gray, except the green bar and
  the skill names (cyan).
- `add` progress bar: it appears empty once `registry.npmjs.org` resolves or `npx` prints anything,
  fills seven cells on a timer, one every 150 ms, then the eighth when `npx` starts printing and
  the ninth when every `-s` skill is on disk. Every value stays on screen for at least 150 ms.
  Without `-s` it no longer shows a moving block.
- `add` without `-m` (`lg`) prints the `md` lines after the `npx` output when a skill changed.
- `sln` no longer logs each link as `path -> target` or the skipped skills; `lg` and `md` look the
  same.
- `sln <path>` searches `<path>` when neither `<path>/skills` nor `<path>` holds skills: every
  `<name>/SKILL.md` with `name: <name>` in its frontmatter is a skill, up to five folders deep,
  skipping hidden folders, `node_modules`, `dist`, `coverage`, symlinks and the inside of a skill.
  One command links skills from several plugins (`skl sln ../skills -s tdd dashfix`); a name
  found in two folders exits 1.
- `sln` progress bar: in a terminal it fills one cell every 50 ms (about 0.5 s) before the final
  line.

## 0.4.7 (2026-10-10)

### Added

- `skl sln <path>` also takes the skills folder itself (`<path>/<name>/SKILL.md`), such as
  `plugins/devflow/skills`. When `<path>/skills` holds skills, it is used as before; errors name
  the folder that was searched.

## 0.4.6 (2026-10-10)

### Removed

- **Breaking:** `skl install` / `skl i`. They exit 1 with `skl i was removed in 0.4.6, use skl add`;
  with `-ln`/`--link` the hint is `use skl sln`.
- **Breaking:** `-ln` / `--link`. Symlinking a local clone is its own command, `skl sln`;
  `skl add -ln` exits 1 with `use skl sln`.

### Added

- `skl add <source>` runs `npx -y skills add` with the same arguments, as `skl i` did.
- `skl sln <path>` symlinks `<path>/skills/<name>` into `.agents/skills` and `.claude/skills`, as
  `skl i -ln` did, with `-s`, `-x`, `-a`, `-y`.
- Output modes for `add`, `sln` and `rm`: `-m c` / `--mode clear` (default), `-m s` / `--mode silent`,
  `-m q` / `--mode quiet`. Two different modes exit 1.
  - `add`: clear shows the `npx` output, then a table of the changed skills; silent is the 0.4.5
    `-m s` (progress line and table); quiet prints one `Installed N skills from <source>` line.
  - `add` in clear mode still runs `npx` when `skills-lock.json` is unreadable and only skips the table.
  - `sln`: clear logs each link as `path -> target` and the skipped skills
    (`metadata.internal`, `-x`), then the progress line and the table; silent is the 0.4.5 `i -ln`
    output; quiet prints one `Symlinked N skills from <path>` line.
  - `rm`: clear is the plan and summary; silent and quiet print `Executed A/B/C skills`.

### Changed

- `skl add` without `-m` shows the `npx` output as before, then prints a table of the changed
  skills.
- `skl sln` without `-m` logs each link as `path -> target` before the progress line and the table;
  the 0.4.5 `i -ln` output is `-m s`.
- Shell completion offers `add` and `sln` instead of `install` and `i`, and `clear silent quiet` after
  `-m`/`--mode`.

## 0.4.5 (2026-10-10)

### Removed

- **Breaking:** `skl usage --global` / `-g` and `--root`. `skl usage` covers the current project only;
  the flags exit 1 with `skl usage is project-only: -g and --root were removed in 0.4.5`.

### Changed

- The project root of `usage`, `cost`, `ls`, `rm` and the picker is the root of the git repo you run in,
  or the current directory outside a repo. In a subdirectory they all read the repo root's
  `skills-lock.json` and `.claude`/`.agents` skills; `skl i` still installs into the current directory.
- `skl usage` in `$HOME` is the project scope of `$HOME`, not global.
- `skl usage` takes `cost` and missing (red) rows from the same project as the sessions.
- Codex `--mode mentions` counts only `history.jsonl` entries of the project's sessions; the library's
  `readCodexUsage({ mode: 'mentions', projectRoot })` filters the same way.
- The global picker (`skl -g`) has no `usage` entry.
- CI tests on Node 22 and 24; Node 20 is no longer tested (`engines.node` has been `>=22` since
  0.4.3).
- Dev tooling: `vitest` and `@vitest/coverage-v8` 5.x, `vite` added as a dev dependency (a
  required peer of vitest 5).
- `npm run test:e2e:network` runs a real `skl i sentimony/skills -s cross-review` install
  (`SKL_X_E2E_NETWORK=1`); the regular e2e suite skips it.
- Dependabot version updates removed; dependencies and GitHub Actions are bumped by hand.

## 0.4.4 (2026-10-10)

### Fixed

- `skl usage` without `~/.claude/projects` or `~/.codex/sessions` (a fresh machine or CI runner,
  an agent that never ran) prints `No skill usage by <period>` and exits 0 instead of failing
  with `ENOENT`. Other read errors still fail. The library's `readClaudeUsage` and
  `readCodexUsage` likewise return empty results for a missing `root`.
- `skl usage --root <path>` with a path that does not exist exits 1 with
  `--root <path> does not exist` instead of a raw `ENOENT`.

## 0.4.3 (2026-10-10)

### Changed

- `skl i … -y -m s` and `skl i -ln` print one progress line. `-m s` ends it as
  `Installing from https://github.com/owner/repo ██████████ 100% · Installed N skills`
  (`owner/repo` is shown as its GitHub URL), `-ln` as
  `Symlinking from <path> ██████████ 100% · Symlinked N skills`. The bar is green and redraws only
  in a terminal; scripts and CI get the final line. While the bar moves, a label wider than the
  terminal is cut with `…`.
- The skill table of `skl i` and `skl ls` has a `cost` column, as in `skl cost`; `+` in the lock
  column is green, `-` yellow.
- `skl usage` prints one table: `.agents` (Codex) and `.claude` (Claude Code) runs, cost per skill
  and total = cost × runs, with a sum row. The `Total:` line is gone; `--format json` is unchanged.
- Scope headers read `Project scope` / `Global scope`.
- Requires Node.js 22 or newer (`engines.node` `>=22`): Node 20 reached end of life on
  2026-04-30.

## 0.4.2 (2026-10-08)

### Changed

- README leads with `npx -y skl-x`: installing skills, local clones, cost and usage first.
- npm keywords and a downloads badge.
- Dev tooling: `@biomejs/biome` 2.5.15, `@types/node` 26.6.4; unused `@changesets/cli`
  removed.

## 0.4.1 (2026-10-08)

### Changed

- `skl ls` and `skl i` print skill names in cyan, as `skl cost` and `skl usage` do.

## 0.4.0 (2026-10-08)

### Changed

- **Breaking: the `sklx` bin is gone** - use `skl-x` or `skl`. Help, the bare `skl` menu and error
  messages call the CLI `skl-x`.
- **The update check reads `SKL_X_NO_UPDATE_CHECK`** and caches in `~/.cache/skl-x/`. The old
  `SKLX_NO_UPDATE_CHECK` still disables it.
- Shell completion functions are renamed to `_skl_x*` / `__skl_x_*` and complete `skl` and `skl-x`;
  re-source `skl completion <shell>`.

## 0.3.0 (2026-10-08)

### Changed

- **Breaking: the package is renamed from `@sentimony/sklx` to `skl-x`** and the repository
  to `sentimony/skl-x`. Install with `npm rm -g @sentimony/sklx && npm i -g skl-x`;
  `npx -y skl-x` runs it without installing.
- New `skl-x` bin next to `sklx` and `skl`; the update check asks npm for `skl-x`.

## 0.2.1 (2026-10-08)

### Changed

- The bare `skl` command menu separates each command from its description with `-`, as the
  menu titles do since 0.2.0.
- First release published from CI as `@sentimony/sklx` (0.2.0 was published by hand).

## 0.2.0 (2026-10-08)

### Changed

- **Breaking: the package is renamed from `skillio` to `@sentimony/sklx`** and the repository
  moved to `sentimony/sklx`. Install with `npm rm -g skillio && npm i -g @sentimony/sklx`. npm
  rejects the unscoped name `sklx` as too similar to existing packages.
- **Breaking: the `skillio` bin is gone** - use `sklx` or `skl`.
- **Breaking: `SKILLIO_NO_UPDATE_CHECK` is now `SKLX_NO_UPDATE_CHECK`**; the update check
  asks npm for `@sentimony/sklx` and caches in `~/.cache/sklx/`.
- Shell completion functions are renamed to `_sklx*` / `__sklx_*`; re-source
  `skl completion <shell>`.

### Removed

- The 0.1.23 `skillio is deprecated` line on stderr.

## 0.1.23 (2026-10-08)

### Deprecated

- **`skillio` is renamed to `sklx`.** This is the last `skillio` release. Every run prints
  `skillio is deprecated, renamed to sklx: npm rm -g skillio && npm i -g sklx` to stderr,
  regardless of `SKILLIO_NO_UPDATE_CHECK`. Remove `skillio` first: both packages install the
  `skl` bin.

## 0.1.22 (2026-10-08)

### Added

- **`skl i -ln <path>` / `skl install --link <path>`** symlinks skills from a local clone (what
  `skl sl` did). Without `-s` it links every `<path>/skills/<name>/SKILL.md` except skills with
  `metadata.internal: true`, as `npx skills add` does. `-x`/`--reject <names...>` links every skill
  except the listed ones. The summary is `Symlinked N skills from <path>` and a table.
- **`skl i ... -y -m s` / `--mode silent`** hides the `npx skills add` output and prints
  `Installed N skills from <source>` and a table of the skills that were added or reinstalled.
  Needs `-y`. When `npx` fails, its full output is printed and its exit code returned.

### Changed

- **Breaking: `skl ls` is a table** - one row per skill with `.agents`, `.claude` and lock columns
  (`universal` / `copied` / `symlinked` / `broken` / `-`, lock `+` / `-`) and a total row. The
  `<label> : N skills : names` rows and the `not in lock` lines are gone; an empty scope prints
  `No skills in scope.`

### Removed

- **Breaking: `skl symlink` / `skl sym` / `skl sl`** - use `skl i -ln <path>`.
- **Breaking: `skl cs`** - use `skl cost` or `skl cst`.
- **Breaking: `skl us`** - use `skl usage` or `skl usg`.
- **Breaking: `skl rm -sm` / `--stealth-mode`** - use `skl rm -m s` / `--mode silent`.

## 0.1.21 (2026-10-07)

### Added

- **`skl install` / `skl i`** runs `npx -y skills add` with the same arguments in the same
  order and returns its exit code, so `-s a b c` and `-a codex claude-code` work as in
  `npx skills add`. `skl i -h` prints its own short help.
- **`skl symlink` / `skl sym` / `skl sl <path> -s <names...>`** symlinks `<path>/skills/<name>` into
  `.agents/skills` and `.claude/skills` (`-a codex` / `-a claude-code` picks one), straight
  to the clone, so edits in the clone show up at once. A copy or another symlink with the same
  name is replaced after a `Replace N existing skills?` prompt, or at once with `-y`. A name
  starting with a space is skipped. `skills-lock.json` is not changed; `-g` is not supported yet.

## 0.1.20 (2026-10-05)

### Changed

- **Breaking: `skl cost` estimates from `name` + `description` at 3 chars per
  token.** Calibrated against Claude Code `/skills`, it now matches per skill;
  the old whole-frontmatter chars/4 estimate matched only in the sum (long
  `compatibility:` / `metadata` overcounted, long descriptions undercounted).
  The method label is now `· method: chars/3, name+description`. The same
  number feeds `tokensPerSkill` and `consumption` in `skl usage --format json`.
- **`skl cost` shows skills with `disable-model-invocation: true` as `-`.**
  Claude Code keeps them out of the always-loaded context, so they are left out
  of `Total`; they still count in `across N skills`. In `skl usage --format json`
  their `tokensPerSkill` is `null`.
- **Breaking: no verdict in the `skl cost` total.** `OK - keep it lean` /
  `time to plan some cleanup` / `ballast - clean it up` are gone; how many skills
  to keep is the user's call.
- **Breaking: no blank lines in `skl ls`, `skl cost` and `skl usage`.** The empty
  line before the scope header, before `Total:` and before the `not in lock`
  lines is gone, so a sequence of commands reads as one report.
- **Scope header is bold** (`Project Scope` / `Global Scope`) in all three
  commands when color is on.
- **`not in lock` names in `skl ls` use their disk color** (green for a real
  folder, yellow for a symlink, red for a dangling one) instead of cyan.

### Fixed

- **`skl usage` rejects unknown `--mode` and `--format` values** with exit 1 and
  a one-line error, before reading any session. A typo like `--mode merge` used
  to print zero usage, and `--format yaml` silently printed text.
- **e2e color tests pass with `NO_COLOR=1` in the environment** (as set by
  Codex). `NO_COLOR` still wins over `FORCE_COLOR`; the tests now drop an
  inherited `NO_COLOR`.

## 0.1.19 (2026-10-03)

### Added

- **`skl rm -sm` / `--stealth-mode` - one-line output.** Instead of the summary
  block, `skl rm` prints a single `Executed A/B/C skills` line, where the
  numbers are the skills actually removed from `.agents/skills/`,
  `.claude/skills/` and `skills-lock.json`. Locations outside a scoped run
  (`--lock-only` etc.) count as `0`. Without `--yes` the plan and prompts stay;
  only the summary is replaced. Errors still go to stderr.

### Changed

- **`skl rm --yes` no longer prints the plan.** With `-y` nothing is asked, so
  the `… will be removed from:` block only duplicated the summary. Now only the
  `… removed from:` block is printed. Interactive runs are unchanged.
- **Scope header renamed in `skl ls`, `skl cost` and `skl usg`.** `Local` is
  now `Project Scope`, `Global` is now `Global Scope`. Breaking for scripts
  that grep the header.
- **Breaking: `--lo`, `--ao`, `--co` aliases removed from `skl rm`.** Use
  `--lock-only`, `--agents-only`, `--claude-only`.
- **`skl rm` rejects unknown options.** An unrecognised flag (e.g. `--lo` or
  `-lo`) now exits 1 with `Unknown option: <flag>` before anything is removed.
  Previously it was silently ignored, so `skl rm foo -lo` widened the scope to
  every location instead of only the lock.

## 0.1.18 (2026-07-19)

### Added

- **`skl rm . -x <name> …` / `--reject` - exclusions for remove-all.** When
  removing all skills with `.`, listed skills are kept on disk and in
  `skills-lock.json`, e.g. `skl rm . -x web-debug typescript`. Accepts multiple
  space-separated names, repeated flags, and `--reject=<name>`. Only valid
  together with `.`; unknown names abort before anything is removed. Shell
  completions (bash/zsh/fish) advertise the new flag.

## 0.1.17 (2026-07-11)

### Fixed

- **`skl ls` and `skl rm` now see dangling skill symlinks.** Skill discovery
  detected a skill by resolving `<name>/SKILL.md` with `existsSync`, which
  follows symlinks - so a `.claude/skills/<name>` symlink whose target no longer
  exists resolved to nothing and was skipped entirely. Such skills were invisible
  to `skl ls` (counted as `0 skills`) and untouched by `skl rm .`. A symlink
  entry is now treated as a skill regardless of whether its target resolves, so
  both commands list and clean up dangling symlinks.

- **`skl ls` paints dangling symlinks red.** A `.claude/skills/<name>` symlink
  whose target no longer resolves now renders red (broken) instead of yellow
  (live symlink), so a symlink pointing nowhere is visually distinct.
- **Build now emits `dist/index.*` (library exports were broken).** Both bunup
  entries share `outDir: dist`, and bunup cleans the outDir at the start of each
  entry build - so the `cli` entry wiped the `index` entry's `dist/index.js`,
  `.cjs`, `.d.ts`, `.d.cts`, shipping a package whose `exports` pointed at
  missing files (the CLI still worked via `bin`, but `import` of the library did
  not). Per-entry `clean` is now off and the build script removes `dist` once up
  front. A new e2e test guards that every `exports`/`bin` path exists in `dist`.

### Changed

- **Dev dependencies bumped**, incl. TypeScript `6` → `7` (native compiler),
  Biome `2.4` → `2.5`, `@types/node` `25` → `26`, and vitest `4.1.10`.
  Typecheck and build verified green on TypeScript 7.
- **`skl rm` lock row shows the skill count.** The `skills-lock.json` line now
  reads `N skills (M lines)` (e.g. `3 skills (20 lines)`) instead of bare
  `M lines`, clarifying that the line count spans several skill entries.
- **`skl rm -h` documents what `--yes` skips.** The help entry now spells out
  that `-y, --yes` answers yes to both the `Proceed?` and
  `Clean skills-lock.json?` prompts.

## 0.1.16 (2026-07-05)

### Fixed

- **`skl rm` no longer leaves dangling symlinks.** Removal checked existence
  with `existsSync`, which follows symlinks - after the real
  `.agents/skills/<name>/` directory was deleted, the `.claude/skills/<name>`
  symlink became dangling, reported as missing, and was silently kept on disk
  (while the summary claimed it was removed). Existence is now checked with
  `lstat`, so live and dangling symlinks are both deleted.

### Changed

- **`skl rm` plan/summary lines are flatter and aligned.** No leading
  indentation and no parentheses; labels are always `.agents/skills/`,
  `.claude/skills/`, and `skills-lock.json` (no per-skill suffix), padded into
  columns. Disk counts now read `N folders, M subfolders, K files`, where
  `folders` is the number of skill directories being removed and `subfolders`
  the nested directories inside them. A blank line now precedes the
  `Proceed? [y/n]` and `Clean skills-lock.json…?` prompts.
- **`skl ls` lock row lists all lock entries.** The green `All skills
  onboard!` message is gone; the `skills-lock.json` row now enumerates every
  skill in the lock (uncolored), with lock orphans still highlighted in red.
  **Breaking** for scripts grepping `All skills onboard!`.

## 0.1.15 (2026-07-01)

### Changed

- **`skl rm` plan/summary output is now colored and aggregated.** Real
  installs show `(N folders, M files)` in green; symlinked installs show
  `(N symlinks)` in yellow; the `skills-lock.json` line shows the exact
  number of lines that will change, in red. Multiple targets (including
  `rm .`) share one aggregated block instead of a header repeated per skill.
- **Lock cleanup is now an interactive question, not a flag.** `--force-lock`
  and its `-fl` alias are **removed**. After confirming disk removal, `rm`
  asks a second, independent `Clean skills-lock.json (N lines)? [y/n]`
  question whenever at least one target is in the lock. `--yes`/`-y` now
  answers **both** questions. **Breaking** for scripts relying on
  `--force-lock` or on `--yes` leaving the lock untouched.
- **`--dry-run` removed.** The plan is always printed before every
  confirmation, so a separate preview mode was redundant. **Breaking**.
- **New scoped flags**: `--lock-only`/`--lo` (unchanged behavior, new alias),
  `--agents-only`/`--ao`, and `--claude-only`/`--co` - each restricts `rm` to
  exactly one location (disk side or lock) with a single confirmation and no
  second question. Mutually exclusive with each other.
- **Confirmation prompts now read `[y/n]`** (was `[y/N]`); behavior for
  anything other than a literal `y`/`yes` answer is unchanged (still `false`).

## 0.1.14 (2026-06-01)

### Changed

- **`cost` short alias is now `cs`** (was `co`). `cst` is unchanged. `co` is
  no longer recognized. **Breaking** for anyone scripting `skl co`.
- **`skl rm .` replaces `skl rm --all`.** Use the positional `.` to target
  every skill in scope; `skl rm . -fl` (or `--force-lock`) also wipes lock
  entries. The `--all` flag is **removed**. **Breaking.**
- **`-fl` short alias for `--force-lock`.**
- **`rm` result block reformatted.** A blank line precedes the results; each
  skill prints a `"name"` header followed by per-source lines -
  `removed` (red), `kept` (green), `skipped` (yellow) - in the order
  `.agents/skills`, `.claude/skills`, `skills-lock.json`.
- **`skl ls` drops the "skills-lock.json has N skills missing on disk" line.**
  Lock orphans are already shown inline (red) in the lock row.
- **Bulk-remove confirm reverted to instant `y`.** `skl rm .` now asks
  `Remove ALL N skills?` and accepts a single `y` keypress (no Enter), like
  single-skill removal. The 0.1.13 typed-`all` guard is removed; `--yes` again
  skips the prompt entirely.

## 0.1.13 (2026-05-16)

### Added

- **`skl completion <bash|zsh|fish>`.** Prints a shell completion script that
  tab-completes subcommands, flags and (dynamically) skill names for `skl rm`.
  Source once in your rc-file; the script calls `skl list --names` under the
  hood, so completions track real on-disk state.
- **`skl list --names`.** Machine-readable mode that prints one unique skill
  name per line, union of `.agents/skills`, `.claude/skills` and the lock
  file, sorted, with no header and no colors. Designed for completion scripts
  and pipelines.
- **`skl rm --lock-only`.** Removes only the `skills-lock.json` entry and
  keeps on-disk directories intact. Mutually exclusive with `--force-lock`.
- **`skl usage`: `(missing)` suffix and `installed: boolean`.** Skills that
  have usage records but are no longer present in lock or on disk are tagged
  with a red `(missing)` suffix in text output; JSON output gains an
  `installed` field. Sort is `installed-first`.
- **`mo` period unit (30 days).** A fixed 30-day month unit: `6mo` = 180 days,
  not calendar months. `m` continues to mean minute - the new `mo` unit
  removes the ambiguity around month-vs-minute in `-p`.
- **`rm --all` typed-phrase guard in TTY.** Interactive `rm --all` now
  requires typing the word `all` to confirm, even with `--yes`. Non-TTY
  scripts that pass `--yes` are unchanged.
- **Method label in `cost` summary.** The total line now ends with
  `· method: chars/4, yaml-frontmatter` so the estimation method is
  self-documenting.
- **CodeQL workflow** (`.github/workflows/codeql.yml`) and
  **OpenSSF Scorecard workflow** (`.github/workflows/scorecard.yml`).
- **Vitest coverage + Codecov upload.** New `npm run test:coverage` script
  and a `coverage` job in CI that uploads `lcov.info` to Codecov.

### Changed

- **`mentions` extractor normalizes plugin namespaces.** `superpowers:foo` is
  now reported as bare `foo`, matching the names emitted by `attributed` and
  `activations`. This removes a real double-count risk in `merged` mode when
  the same skill appeared with and without a namespace prefix.
- **`readers/claude.ts` mentions aggregation.** Switched from per-line
  accumulation to a session-level `Map` (`sessionMen`) plus post-file
  aggregation, matching the structure used by `attributed`/`activations`.
  Output counts are unchanged; the refactor removes a structural
  inconsistency flagged in code review.
- **`isRecentEntry` (jsonl.ts).** Entries with no timestamp (or `null`) now
  return `false` instead of `true`, removing inflation of short windows
  caused by stamp-less log lines.
- **Custom `skl remove --help`.** The remove subcommand now prints a
  formatted USAGE/ARGUMENTS/OPTIONS/EXAMPLES block instead of the generic
  citty layout.
- **Root help descriptions** updated to reflect 0.1.11+ semantics for `list`
  and `remove`.
- **README rewrite.** Period units (`60s/30m/24h/30d/2w/6mo/all`), `rm`
  semantics (disk-only by default, `--force-lock`, `--lock-only`, `--all`),
  default modes per agent (Claude → `merged`, Codex → `activations`).
- **README badges.** Added CodeQL, OpenSSF Scorecard, Codecov, license, and
  node-version shields alongside the existing npm and CI badges.

### Internal

- `@vitest/coverage-v8` added as a devDependency (no new runtime deps).

## 0.1.12 (2026-05-15)

Version bump only - the substantive changes drafted for this slot landed in
0.1.13. 0.1.12 on npm is identical to 0.1.11 except for the version field.

## 0.1.11 (2026-05-14)

### Breaking

- **`skl rm` no longer touches `skills-lock.json` by default.** Pass `--force-lock` to remove
  the lock entry. The previous "skip if git-tracked, override with `--force-lock`" logic is
  removed entirely. Scripts that relied on default lock removal need `--force-lock` added.
- **`--period` syntax cleanup.** `s/m/h/d/w` only. Notable: **`1m` now means 1 minute, not
  30 days.** Longhand `30sec`, `5min` and units `m` (month) / `y` (year) are rejected.
  Migration: `5min`→`5m`, `1m` (month)→`30d`, `1y`→`365d` or `52w`.

### Added

- **`skl rm --all`.** Wipes every skill in scope (disk only). Combine with `--force-lock`
  to also clear lock entries. Mutually exclusive with positional names.
- **Picker `remove` option.** Bare `skl` in TTY now shows `remove` in the main menu;
  selecting it opens a secondary picker listing every skill in scope. Orphans-on-disk
  (present on disk, missing from `skills-lock.json`) are labeled with a red `(orphan)`
  suffix to distinguish them from `cost`'s `missing` (in-lock, no `SKILL.md`).
- **Instant `y/N` confirm.** `skl rm` in a TTY resolves on a single keystroke - no Enter
  required. Pipes and CI still use the line-based readline fallback unchanged.

### Changed

- **`skl ls` redesign.** Row order is now `.agents/skills` → `.claude/skills` →
  `skills-lock.json`. Disk names are painted green for real directories and yellow for
  symlinks (`lstatSync` check). The `skills-lock.json` row shows only orphans-in-lock
  (entries with no disk presence in either source); an empty orphan set renders
  `All skills onboard!` in green.
- **`skl usage` spacing.** The blank line that used to appear before each agent header
  inside a scope is gone. Blank lines BEFORE the scope header (`Local`/`Global`) and
  BEFORE `Total:` are unchanged.

### Removed

- `src/utils/git.ts` (`isTrackedByGit`) - no longer used after the `rm` rewrite.

### History

The repository history of `.gitignore` is rewritten via `git filter-repo --blob-callback`
to drop seven legacy patterns from every historical revision. Existing clones must
`git fetch --all --tags --force && git reset --hard origin/main`. Provenance attestations
for v0.1.0-v0.1.10 reference pre-rewrite SHAs that no longer exist (Sigstore signatures
remain valid; repo-SHA chain is broken for those versions). v0.1.11 establishes a fresh
chain.

## 0.1.10 (2026-05-13)

### Fixes
- `skl usage` (claude-code, attributed/merged modes): same skill re-invoked
  after a non-attributed line is now counted as a separate invocation.
- `skl usage` (codex, function_call exec_command): only read-like commands
  (`cat`, `sed`, `head`, `tail`, `bat`, `batcat`, `less`, `more`) are
  counted. Skips output redirection (`>`, `>>`, `2>`, `&>`) and heredoc
  bodies. Fixes false positives from fixture-generation and search commands.

### Features
- Bare `skl` in a TTY shows an interactive picker
  ({usage, cost, list, quit}). Non-TTY invocations (CI, pipes) preserve
  the legacy bare→cost behavior. `remove` is intentionally omitted from
  the menu and will return in a future iteration with a skill-name picker.
- `skl rm` now skips modifying `skills-lock.json` when the file is
  git-tracked; warning to stderr. Pass `--force-lock` to override.
- `skl usage` no longer renders skills with `count=0`.
- `skl cost` shows `~? tok  missing` (red) for skills missing from disk.
- `skl list` always renders three source rows (`.claude/skills`,
  `.agents/skills`, `skills-lock.json`) with `0 skills` for empty sources.

### Style
- Blank line moved to BEFORE `Local`/`Global`/`Total` headers (was after).

## 0.1.8 (2026-05-12)

### Breaking Changes

- **`skl` (bare, no subcommand)** now runs `skl cost` instead of the
  Global + Local + Total summary. For per-agent activations + consumption,
  run `skl usage`.
- `skl summary` subcommand removed (it was the previous bare behavior).

### Added

- `skl cst` alias for `skl cost` (and existing `co`).
- `skl usg` alias for `skl usage` (and existing `us`).
- Cyan highlighting for skill names in `skl cost`, `skl ls`, and `skl usage` output.
- Dependabot: automatic weekly PRs for npm deps and GitHub Actions versions.
- CI: matrix on Node 20 + 22 with `fail-fast: false` and a per-ref concurrency group; adds a `tsc --noEmit` typecheck step.

### Internal

- `.github/actions/checks` composite action holds the shared lint/typecheck/unit/build/e2e sequence; both `ci.yml` and `release.yml` call it (zero duplication).
