# Workbench

Small, self-contained browser tools. Everything runs client-side — your documents and files stay
in the browser — and each tool keeps working offline once you have opened it. The public site may
send anonymous page-view analytics to Cloudflare when you are online.

**[peterhewat.github.io/Workbench](https://peterhewat.github.io/Workbench/)**

| Tool                     | What it does                                       |
| ------------------------ | -------------------------------------------------- |
| [Vellum](./apps/vellum/) | Trace reference images and export clean, pure SVG. |

## Running it

Requires [Bun](https://bun.sh).

```bash
bun install
bun run dev vellum
```

`bun run dev <slug>` serves one app with hot reload; `bun run dev home` serves the index page.
Each app is its own Vite root on its own port, and the index's links point at built paths like
`/Workbench/vellum/` that only resolve in a built site — use the build-and-serve below to see
them joined up.

To build and preview the whole site, including the index page:

```bash
WORKBENCH_BASE=/ bun run build && bunx serve dist
```

On Windows, run that from PowerShell (`$env:WORKBENCH_BASE = '/'; bun run build`) or prefix it
with `MSYS_NO_PATHCONV=1`. Git Bash rewrites the bare `/` into a Windows path and the build bakes
that in as the base, which fails quietly: the page loads and every asset 404s.

## Adding a tool

```bash
bun run new-app color-forge "Color Forge"
```

That scaffolds `apps/color-forge` and adds an unlisted entry to
[`packages/catalog`](./packages/catalog/src/index.ts). The catalog is the only list — the index
page, the build, each page's title and manifest, and the deploy all read from it.

## How it is put together

```text
apps/          one folder per tool, plus `home` (the index page)
packages/
  catalog/     which apps exist, and where the site is deployed
  ui/          shared styles, browser helpers, build wiring and the offline service worker
  codec/       pure encoding helpers: base64, hex, UTF-8, JSON with error positions
  tsconfig/    shared TypeScript config
tools/         build and scaffold scripts
docs/          decisions, reference and plans
```

Each app is TypeScript built by Vite into plain static files, with **no runtime framework and no
runtime dependencies**. Vite is a build tool here, not a foundation: the output is HTML, CSS and
ES modules that will still work off any file server in ten years.

## Commands

| Command              | What it does                              |
| -------------------- | ----------------------------------------- |
| `bun run dev <slug>` | Serve one app (or `home`) with hot reload |
| `bun run check`      | Lint, typecheck and format check          |
| `bun run test`       | Run the test suites                       |
| `bun run build`      | Build the whole site into `dist/`         |
| `bun run verify`     | `check` + `test` + `build`                |
| `bun run new-app`    | Scaffold a new app                        |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). `bun run verify` is the check CI runs.

## License

MIT — see [LICENSE](./LICENSE).
