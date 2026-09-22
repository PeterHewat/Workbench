# App ideas (plan)

Intent only — nothing here is built unless it appears in the catalog. Slugs are suggestions for `bun run new-app`; names are display titles.

Workbench fit: client-only, offline-friendly, static output, no “save online” or load-arbitrary-URL unless we explicitly decide otherwise.

---

## Daily drivers (replace sites you already use)

| Slug   | Name | Blurb (draft)                                                | MVP notes                                                                                                                                                                           |
| ------ | ---- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `json` | JSON | Format, minify, and validate JSON in the browser.            | Paste + open file; pretty/minify; parse errors with position; optional read-only tree. Skip: hosted save/share, URL fetch (CORS). Later: key sort, schema validate.                 |
| `jwt`  | JWT  | Decode and verify JSON Web Tokens without sending them away. | Split token; base64url decode; human dates for `exp` / `iat` / `nbf`; pretty payload (reuse JSON helpers). v1 verify/sign: HS256 family; later RS256 + PEM. Dev-only warning in UI. |

Inspired by [jsonbeautifier.org](https://jsonbeautifier.org/) and [jwt.io](https://www.jwt.io/) — same jobs, local and offline.

---

## Crypto & codes

| Slug      | Name    | Blurb (draft)                                | MVP notes                                                                                                                                      |
| --------- | ------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `digests` | Digests | Hash files and text with the Web Crypto API. | SHA-256/384/512; hex + base64; text + file drop. Later: HMAC, PBKDF2 demo.                                                                     |
| `codes`   | Codes   | QR and barcodes as clean SVG.                | QR presets (text, URL, Wi‑Fi); one 1D symbology (e.g. Code 128); margin + EC level; export SVG. Small bundled encoder at build time if needed. |

---

## Vellum companions (same maker / SVG audience)

| Slug          | Name        | Blurb (draft)                                           | MVP notes                                                                      |
| ------------- | ----------- | ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `measure`     | Measure     | Path length and area from SVG.                          | Drop/paste SVG; bbox; closed area; scale mm/in/px @ DPI.                       |
| `outline`     | Outline     | Turn strokes into filled outlines for export.           | Offset stroke → filled paths; miter/round.                                     |
| `refine`      | Refine      | Tidy SVG: round coords, strip noise, normalize viewBox. | Pairs with Vellum export; golden tests on round-trip stability where relevant. |
| `nest`        | Nest        | Tile parts on a sheet with margins.                     | One or many copies; sheet size; combined SVG out.                              |
| `toolpath`    | Toolpath    | Preview cut order along paths (visual only).            | 2D pen/laser path animation; no machine control.                               |
| `vellum-view` | Vellum View | Inspect a `.vellum.json` project without the editor.    | Read-only element list, stats, export preview.                                 |

---

## Small second apps (stress-test `new-app` + catalog)

| Slug          | Name        | Blurb (draft)                                   | MVP notes                                    |
| ------------- | ----------- | ----------------------------------------------- | -------------------------------------------- |
| `color-forge` | Color Forge | Palettes, contrast, and CSS-ready color export. | Already the scaffold example in AGENTS.md.   |
| `swatch`      | Swatch      | Extract a palette from a reference image.       | N colors; copy hex; optional harmony tweaks. |
| `gradient`    | Gradient    | Build SVG and CSS gradients; copy markup.       | Multi-stop; live preview.                    |
| `units`       | Units       | mm, inches, points, and px at a chosen DPI.     | Maker-oriented; artboard presets.            |
| `curves`      | Curves      | Play with Bézier handles and path length.       | May share path math with Vellum over time.   |
| `slicer`      | Slicer      | Cut a sprite sheet on a grid.                   | Export cells; all client-side.               |
| `favicon`     | Favicon     | One square SVG → common icon sizes.             | PNG via canvas export where needed.          |

---

## Offline utilities (broader, still on-brand)

| Slug    | Name  | Blurb (draft)                       | MVP notes                    |
| ------- | ----- | ----------------------------------- | ---------------------------- |
| `regex` | Regex | Test patterns on sample text.       | Match highlights; no upload. |
| `cron`  | Cron  | Cron expressions in plain language. | Next run times in local TZ.  |
| `diff`  | Diff  | Compare two pasted texts or files.  | Side-by-side or unified.     |

---

## Later / heavier

| Slug       | Name     | Blurb (draft)                             | Notes                    |
| ---------- | -------- | ----------------------------------------- | ------------------------ |
| `stipple`  | Stipple  | Reference image → engraving-friendly SVG. | Algorithm-heavy.         |
| `specimen` | Specimen | Type samples and size grids.              | Print CSS or SVG export. |

---

## Naming notes

- Catalog slugs stay **kebab-case**, lowercase, match the folder under `apps/`.
- Prefer short, tool-like names (`json`, `jwt`, `codes`, `nest`) or evocative ones (`vellum`, `color-forge`) — avoid a repeated suffix like `-bench`.
- One app per catalog entry; shared helpers live in `packages/` only when two apps need them (e.g. base64url + pretty JSON for `jwt` and `json`).

---

## Suggested build order (personal utility)

1. `json` — daily use, small surface.
2. `jwt` — shares JSON presentation; replaces jwt.io for decode/verify habits.
3. `digests` — when you want file hashes without opening a shell.
4. `codes` — different UI, SVG-native output.
5. First Vellum companion (`measure` or `refine`) when the editor workflow hurts without it.
