# Docs

Four kinds of document. The kind tells you how much to trust it, and when it gets deleted.

| Kind          | Meaning                                                               |
| ------------- | --------------------------------------------------------------------- |
| **Decision**  | Settled once accepted; change it with a new ADR.                      |
| **Reference** | How the code works today. If it disagrees with the code, it is wrong. |
| **Plan**      | Intent. Nothing here is built yet.                                    |
| **Work log**  | An open investigation. Deleted when the work lands.                   |

| Document                                                                   | Kind      | Read it when                                       |
| -------------------------------------------------------------------------- | --------- | -------------------------------------------------- |
| [adr/001-static-apps-no-framework.md](adr/001-static-apps-no-framework.md) | Decision  | Tempted to add a framework or a runtime dependency |
| [adr/002-catalog-drives-the-site.md](adr/002-catalog-drives-the-site.md)   | Decision  | Adding an app, or changing the deploy path         |
| [vellum-spec.md](vellum-spec.md)                                           | Reference | Working on Vellum                                  |
| [plan/app-ideas.md](plan/app-ideas.md)                                     | Plan      | Browsing or prioritizing future Workbench apps     |
| [plan/vellum-blueprints.md](plan/vellum-blueprints.md)                     | Plan      | Adding scale, views or dimensions to Vellum        |

## Conventions

- **Reference docs describe the present tense only.** Aspirations belong in a plan.
- **When a doc and the code disagree, the code wins** — then fix the doc.
