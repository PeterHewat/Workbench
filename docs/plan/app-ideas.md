# App ideas (plan)

Intent only — nothing here is built unless it appears in the catalog. Slugs are suggestions for
`bun run new-app`.

Workbench fit: client-only, offline, static output. No "save online", no fetching arbitrary URLs.

## Shared groundwork (done)

- `@workbench/codec` — base64 / base64url, hex, UTF-8, and JSON parsing with a line and column
  for the first error. Pure and tested; JSON, JWT, Codec and Digests all build on it.
- `@workbench/ui` — `base.css` (tokens, header with a link back to the index, buttons, inputs,
  code areas), DOM helpers (`copyText`, `downloadText`, `pickFiles`, `onFileDrop`), and
  `workbenchApp(slug)` for the Vite config.

## Build order

| #   | Slug         | Name       | What it does                                                 | MVP notes                                                                                                                                                                                         |
| --- | ------------ | ---------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `json`       | JSON       | Format, minify and validate JSON.                            | Paste or drop a file; pretty / minify / sort keys; error with a caret at line and column (`parseJson`). Later: collapsible tree, JSON Pointer of the caret.                                       |
| 2   | `jwt`        | JWT        | Decode and verify JSON Web Tokens without sending them away. | Split and base64url-decode; readable `exp` / `iat` / `nbf` with "expires in"; pretty header and payload. Verify HS256/384/512 via Web Crypto; later RS/ES with a PEM or JWK. "Dev use only" note. |
| 3   | `codec`      | Codec      | Base64, base64url, URL encoding, hex and UTF-8 inspection.   | Two panes, pick the transform each way; show bytes (hex) under the text so invisible characters are visible.                                                                                      |
| 4   | `digests`    | Digests    | Hash text and files with Web Crypto.                         | SHA-256/384/512 and SHA-1 (flagged as legacy); hex and base64; file drop hashes in the browser. HMAC with a key lives here, not in JWT.                                                           |
| 5   | `icon-check` | Icon Check | See an SVG icon at the sizes it will actually be used at.    | Paste or drop an SVG; render at 16/24/32/48/64 px on light and dark, with a pixel grid option to catch half-pixel strokes. Later: PNG / favicon export via canvas.                                |
| 6   | `codes`      | Codes      | QR codes as clean SVG.                                       | Text, URL, Wi-Fi presets; EC level and margin; SVG and PNG export. Write the encoder in-repo (the spec is fixed and it is testable) rather than bundling one. Code 128 later if needed.           |
| 7   | `diff`       | Diff       | Compare two texts, or two JSON documents structurally.       | Line diff side-by-side or unified; JSON mode compares parsed values (key order ignored). Handy for two Vellum SVG exports too.                                                                    |
| 8   | `time`       | Time       | Unix timestamps ⇄ dates, across time zones.                  | Seconds or milliseconds auto-detected; ISO 8601; relative ("in 3 h"). Small, and pairs with JWT's claims.                                                                                         |

## Considered and dropped

The "Vellum companions" (Measure, Outline, Refine, Nest, Toolpath, Vellum View) target laser
cutting and plotting. Vellum's job here is different: blueprints and icon sketches handed to an
agent. What that job needs goes into Vellum itself — see
[vellum-blueprints.md](vellum-blueprints.md).

Comparing a Blender render with its blueprint needs no tool: render the same orthographic views
to PNG and load them as reference images in Vellum, under the drawing.

Palette, gradient, slicer, stipple and specimen tools stay out until a real need shows up.

## Naming

- Slugs are lowercase kebab-case and match the folder under `apps/`.
- Short, tool-like names (`json`, `jwt`, `codes`) or evocative ones (`vellum`); no repeated suffix.
- Shared code moves into `packages/` only once two apps need it.
