# skl-x

Install, audit and manage AI agent skills for Claude Code and Codex.

[![npm version](https://img.shields.io/npm/v/skl-x)](https://www.npmjs.com/package/skl-x)
[![npm downloads](https://img.shields.io/npm/dm/skl-x)](https://www.npmjs.com/package/skl-x)
[![CI](https://github.com/sentimony/skl-x/actions/workflows/ci.yml/badge.svg)](https://github.com/sentimony/skl-x/actions/workflows/ci.yml)
[![CodeQL](https://github.com/sentimony/skl-x/actions/workflows/codeql.yml/badge.svg)](https://github.com/sentimony/skl-x/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/sentimony/skl-x/badge)](https://securityscorecards.dev/viewer/?uri=github.com/sentimony/skl-x)
[![codecov](https://codecov.io/gh/sentimony/skl-x/branch/main/graph/badge.svg)](https://codecov.io/gh/sentimony/skl-x)
[![license](https://img.shields.io/npm/l/skl-x)](https://github.com/sentimony/skl-x/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/skl-x)](https://www.npmjs.com/package/skl-x)

## Install skills

```sh
npx -y skl-x add sentimony/skills
```

`skl-x add` runs `npx -y skills add` with the same arguments, so every
[source format](https://github.com/vercel-labs/skills#source-formats) and option of
`npx skills add` works as is.

```sh
# List skills in a repository
npx -y skl-x add sentimony/skills -l

# Specific skills to specific agents, non-interactive
npx -y skl-x add sentimony/skills -s tdd cross-review -a codex claude-code -y

# Hide the npx skills output, print a progress line, a table and a summary (needs -y)
npx -y skl-x add sentimony/skills -s tdd -a codex claude-code -y -m md

# The summary line only (needs -y)
npx -y skl-x add sentimony/skills -s tdd -a codex claude-code -y -m sm
```

```text
Installing 1 skill from https://github.com/sentimony/skills to Project scope ██████████ 100%
skill  .agents    .claude    skills-lock.json  cost
tdd    universal  symlinked  +                 ~125 tok
Installed 1 skill to Project scope · tdd
```

Without `-m` (`lg`), the `npx skills add` output is shown as is, followed by the same lines when
it changed any skill.

In a terminal the bar appears empty once the npm registry resolves (or `npx` prints anything): the
first seven cells fill on a timer, one every 150 ms, then the eighth when `npx` starts printing,
the ninth when every skill named with `-s` is on disk, the tenth when `npx` exits. Every value
stays on screen for at least 150 ms: one that arrives sooner waits, and the final line waits for
the last one. In scripts and CI only the
final line is printed. If `npx` fails, its full output is printed.

### Local skills

`skl-x sln <path>` symlinks `<path>/skills/<name>` into `.agents/skills` and
`.claude/skills`. The links point straight at the clone, so edits there show up without
reinstalling. `<path>` may also be the skills folder itself, such as
`../skills/plugins/devflow/skills`. When neither holds skills, `sln` searches `<path>`: every
`<name>/SKILL.md` whose frontmatter `name` is `<name>` is a skill, so in a plugin repo
`sln ../skills -s tdd dashfix` links skills from two plugins
(`plugins/devflow/skills/tdd`, `plugins/writing/skills/dashfix`). The search goes five folders
deep, skips hidden folders (`.agents`, `.claude`, `.git`), `node_modules`, `dist`, `coverage` and
symlinks, and does not look inside a skill. A name found in two folders exits 1.

```sh
# Every skill in the clone
npx -y skl-x sln ../skills -a codex claude-code -y

# Every skill except the listed ones
npx -y skl-x sln ../skills -x scope-check echarts -y

# Only the listed skills, only .claude/skills
npx -y skl-x sln ../skills -s tdd cross-review -a claude-code
```

```text
Symlinking 2 skills from ../skills to Project scope ██████████ 100%
skill         .agents    .claude    skills-lock.json  cost
cross-review  symlinked  symlinked  -                 ~186 tok
tdd           symlinked  symlinked  -                 ~125 tok
Symlinked 2 skills to Project scope · cross-review tdd
```

- Without `-s`, every `<path>/skills/<name>/SKILL.md` is linked (or `<path>/<name>/SKILL.md`
  when `<path>/skills` has no skills), except skills with
  `metadata.internal: true` (as `npx skills add` does).
- An existing copy or symlink with the same name is replaced after a
  `Replace N existing skills?` prompt, or at once with `-y`.
- `skills-lock.json` is not changed. Global scope (`-g`) is not supported yet.
- In a terminal the bar fills one cell every 50 ms, about half a second in all; in scripts and
  CI only the final line is printed.

| Option | Description |
|---|---|
| `--skill, -s <names...>` | Only these skills; a name starting with a space is skipped |
| `--reject, -x <names...>` | Every skill except these (not with `-s`) |
| `--agent, -a <agents...>` | `codex` (`.agents/skills`), `claude-code` (`.claude/skills`); default: both |
| `--yes, -y` | Skip `npx` prompts (`add`); replace existing copies without asking (`sln`) |
| `--mode, -m <mode>` | `lg` (`large`, default), `md` (`medium`), `sm` (`small`); `md` and `sm` in `add` need `-y` |

| Mode | `add` | `sln` | `rm` |
|---|---|---|---|
| `lg` | `npx` output, then the `md` lines | as `md` | plan and summary |
| `md` | progress line, table, `Installed N skills to <scope> · <names>` | progress line, table, `Symlinked N skills to <scope> · <names>` | `Executed A/B/C skills from <scope>` |
| `sm` | `Installed N skills to <scope> · <names>` | `Symlinked N skills to <scope> · <names>` | `Executed A/B/C skills from <scope>` |

`<scope>` is `Project scope`, or `Global scope` with `-g`. In a terminal these lines are gray,
except the green bar and the skill names (cyan).

## Cost

```sh
npx -y skl-x cost       # project scope
npx -y skl-x cost -g    # global scope
```

Per-skill ambient token cost (`name` + `description`, chars/3), sorted descending. Skills with
`disable-model-invocation: true` show `-` and stay out of the total.

## Usage

Skill usage from agent session logs, multiplied by cost.

```sh
npx -y skl-x usage -a claude -p 7d
npx -y skl-x usage -a codex --mode activations
```

```text
Project scope · Usage 22 times by 7d
skill         .agents  .claude  cost      total
cross-review  9        2        ~186 tok  ~2,046 tok
tdd           0        11       ~125 tok  ~1,375 tok
2 skills      9        13       ~311 tok  ~3,421 tok
```

`.agents` counts Codex runs, `.claude` - Claude Code runs; `total` is cost × runs. A skill that
is no longer installed is shown in red with `~? tok`.

| Flag | Default | Description |
|---|---|---|
| `--agent, -a` | both | `claude-code` (`claude`), `codex` |
| `--period, -p` | `all` | `60s`, `30m`, `24h`, `7d`, `2w`, `6mo`, `all` (`1m` is a minute, `1mo` is 30 days) |
| `--since` | - | `yyyy-mm-dd`, overrides `--period` |
| `--mode` | `merged` (claude) / `activations` (codex) | `merged`, `attributed`, `activations`, `mentions` |
| `--format` | `text` | `text`, `json` |
| `--scan-all-files` | - | Ignore file mtime, read everything |

- **`merged`** - per-session union of `attributed` and `activations` (`max` per skill).
- **`attributed`** - entries with an `attributionSkill` field set by Claude Code.
- **`activations`** - `Skill` tool calls (Claude), read-like `exec_command_end` events or
  `<skill>` XML (Codex).
- **`mentions`** - `foo/SKILL.md` paths or `superpowers:name` strings anywhere. The broadest
  signal; can match prompts, specs or docs.

## Other commands

| Command | Alias | Description |
|---|---|---|
| `skl-x list` | `ls` | Table of skills: `.agents`, `.claude`, lock and cost per skill |
| `skl-x remove` | `rm` | Remove skills from disk and `skills-lock.json` |
| `skl-x completion` | | Print a shell completion script |

`skl-x` with no command opens a menu in a terminal and prints `cost` otherwise.

### `skl-x list`

```text
Project scope
skill            .agents    .claude    skills-lock.json  cost
cross-review     universal  symlinked  +                 ~186 tok
echarts          -          copied     -                 ~98 tok
old-skill        -          -          +                 ~? tok
webapp-debugger  symlinked  broken     -                 ~? tok
4 skills         2          3          2                 ~284 tok
```

| Cell | Meaning |
|---|---|
| `universal` | a folder in `.agents/skills` (the canonical copy of `npx skills`) |
| `copied` | a folder in `.claude/skills` |
| `symlinked` | a symlink, to `.agents/skills` or to a local clone |
| `broken` | a symlink whose target is gone |
| `-` | not there |
| `+` | in the lock; red when the skill is on neither disk |

`skl-x ls --names` prints one name per line, for scripts and completion.

### `skl-x remove`

```sh
skl-x rm tdd                     # plan, Proceed? [y/n], then Clean lock? [y/n]
skl-x rm .                       # every skill in scope
skl-x rm . -x tdd cross-review   # every skill except the listed ones
skl-x rm tdd -y                  # no prompts, no plan
skl-x rm . -y -m sm              # one line: Executed A/B/C skills from Project scope
skl-x rm tdd --lock-only         # also --agents-only, --claude-only
skl-x rm tdd -g                  # global scope
```

### `skl-x completion`

Tab-completes subcommands and skill names for `rm`. Needs a global install.

```sh
skl-x completion bash >> ~/.bashrc
skl-x completion zsh >> ~/.zshrc
skl-x completion fish > ~/.config/fish/completions/skl.fish
```

## Scope

| Where you run it | Scope |
|---|---|
| inside a git repo (any subdirectory) | the repo root |
| anywhere else, `$HOME` included | that directory |
| `cost`, `ls`, `rm` with `--global` / `-g` | global: `~/.agents/.skill-lock.json`, `~/.claude/skills`, `~/.agents/skills` |

`skl usage` is always project scope. `skl add` and `skl sln` write into the current directory.

## Global install

```sh
npm i -g skl-x    # provides `skl-x` and the short `skl`
```

Moving from `@sentimony/sklx` or `skillio`: all three packages install the `skl` bin, so
remove the old one first:

```sh
npm rm -g @sentimony/sklx skillio && npm i -g skl-x
```

To skip the daily update check set `SKL_X_NO_UPDATE_CHECK=1` (`SKLX_NO_UPDATE_CHECK` still
works).

Requires Node.js 22 or newer.

## License

[MIT](LICENSE)
