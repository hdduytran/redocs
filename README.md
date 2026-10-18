# ReDocs

**ReDocs** is an AI-native documentation skill: an agent, guided by the system owner, writes and
maintains a *system design book* (vision, current architecture, proposals, target state across
milestones) in its own Git repository. The book builds to static HTML that opens over `file://`,
so it can be zipped and read anywhere, or published as a static site.

**Read the design book of ReDocs, written with ReDocs:
[hdduytran.github.io/redocs-book](https://hdduytran.github.io/redocs-book/)**
(source: [hdduytran/redocs-book](https://github.com/hdduytran/redocs-book)).

## Docs

| Document | Read it for |
|---|---|
| [ReDocs design book](https://hdduytran.github.io/redocs-book/) | Architecture, decisions, flows and the phase 2 proposal, with diagrams |
| [docs/project-overview-pdr.md](docs/project-overview-pdr.md) | Intent, non-goals, terminology, constraints |
| [docs/system-architecture.md](docs/system-architecture.md) | Boundaries and the decision ledger |
| [docs/codebase-summary.md](docs/codebase-summary.md) | Where each concern lives |
| [docs/code-standards.md](docs/code-standards.md) | Engineering rules and testing policy |
| [skill/redocs/SKILL.md](skill/redocs/SKILL.md) | The contract an agent follows when it uses the skill |

## Layout

```text
skill/redocs/          the installable skill (SKILL.md, CLI, schemas, templates, theme, plugins)
docs/                  contributor documentation
spikes/file-protocol/  file:// behaviour spike and results
```

## Develop

```bash
cd skill/redocs && npm ci          # markdown-it, ajv, yazl (pinned)
cd ../.. && npm test               # all suites; Chrome/archify suites skip when unavailable
```

Inside a sandboxed agent shell Chrome may refuse to start its own sandbox; set
`REDOCS_CHROME_NO_SANDBOX=1` for `npm test`, `finalize` and `embed archify`.

Try it:

```bash
node skill/redocs/bin/redocs.mjs init ../my-book --name my-system --title "My System"
node skill/redocs/bin/redocs.mjs finalize ../my-book
open ../my-book/dist/index.html
```

Diagrams use the [archify](https://github.com/tt-a1i/archify) skill, found through `REDOCS_ARCHIFY`,
`book.json` `plugins.archify.path`, or `~/.kiro/crew/skills/archify`.

## Install as a skill

Symlink `skill/redocs` into the agent's skills folder, for example
`ln -s "$PWD/skill/redocs" ~/.kiro/crew/skills/redocs`, then run `npm ci` inside it.

## License

[MIT](LICENSE)
