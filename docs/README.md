# Documentation index

Project documentation. Internal working notes (plans, decision logs, the migration record) are not user documentation
and live in `.claude/`.

| Document | What it answers |
|---|---|
| [../README.md](../README.md) | What the program is, how to build, run, release and deploy it |
| [architecture.md](architecture.md) | Packages, the module contract, accounts and permissions, storage, notifications, public access |
| [API.md](API.md) | The REST API: every endpoint, who may call it |
| [security.md](security.md) | Sessions, passkeys, headers, dependencies, known limitations |
| [modules/reports.md](modules/reports.md) | Monthly reports module |
| [modules/transport.md](modules/transport.md) | Transport module |
| [ux-contract.md](ux-contract.md) | Interface rules and workflow invariants |
| [design-system.md](design-system.md) | Visual language, tokens, components (the canonical design contract) |
| [DESIGN.md](DESIGN.md) | Responsive behaviour of the store and admin screens, price editing rules |
| [ui-parity.md](ui-parity.md) | Map from each screen behaviour to the code that owns it |
| [adr/](adr/) | Architecture decision records (repository layout, uv, SQLite, port to Go) |
| [uk/onboarding/](uk/onboarding/00-zmist.md) | Ukrainian onboarding set for a manual tester: how the app works, what is done, test checklist |

Language: the code, API and developer documents are in English; the interface and the onboarding set are in Ukrainian.
