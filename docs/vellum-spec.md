# Vellum — Product Specification

## 1. Purpose

A single-page web application for **tracing reference imagery with true SVG geometry**. Users place one or more raster images as non-exported guides, draw vector outlines (paths with Bézier handles and standard SVG shapes) on a fixed artboard, and export **pure SVG**—no embedded images, no editor chrome.

Primary goals:

- Precise alignment via Alt-key point snapping (see §6).
- WYSIWYG: the document layer is real SVG in the DOM; export matches the document (stroke-only geometry for v1).
- Full editing loop: draw → adjust → undo → save project → import SVG → export SVG.

---

## 2. Users & workflows

| Workflow | Description                                                                                                                 |
| -------- | --------------------------------------------------------------------------------------------------------------------------- |
| Trace    | Load image, pan/zoom, draw paths over features, export SVG for downstream tools (CNC, laser, plotters, icons, CAD handoff). |
| Refine   | Re-open project or import SVG, select shapes/points, tweak handles and colors, export again.                                |
| Review   | Toggle “final SVG only” to preview exactly what will be saved/exported.                                                     |

---

## 3. Technical approach

### 3.1 Delivery

- Self-contained web app: static files, opened locally or hosted anywhere.
- TypeScript, compiled by Vite into HTML, CSS, and ES modules. No runtime framework and no runtime dependencies. The page is built with the DOM; Vite does not remain in the output.
- **SVG as source of truth** for exportable content; separate layers for UI that never appear in export.
- Geometry, undo, and path math live in the app. No canvas-centric editor library.

### 3.2 Layer model

```text
┌─────────────────────────────────────────┐
│  UI overlay (handles, selection, etc.) │  ← never exported
├─────────────────────────────────────────┤
│  Grid overlay (optional visibility)     │  ← never exported
├─────────────────────────────────────────┤
│  SVG document layer (exportable)        │  ← Save SVG / export
├─────────────────────────────────────────┤
│  Reference image layer(s)               │  ← never exported
└─────────────────────────────────────────┘
```

- **Pan/zoom** applies to the viewport (camera), not to the SVG `viewBox` (artboard stays fixed in user units).
- Reference images live in a **separate transform space** from the artboard; image position/scale/rotation do not affect exported path coordinates.

---

## 4. Artboard & coordinates

### 4.1 Defaults (user-configurable, independent of imported image)

| Setting         | Default                                 | Notes                                                                                                                                                                |
| --------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Artboard width  | `512`                                   | User units (SVG user space = px unless `unit` changed later).                                                                                                        |
| Artboard height | `512`                                   | Same.                                                                                                                                                                |
| `viewBox`       | `0 0 512 512`                           | Matches artboard; export uses this.                                                                                                                                  |
| Grid step       | `16`                                    | 32 cells across a 512 artboard: one per pixel of a 32px icon, and it halves cleanly.                                                                                 |
| Grid origin     | `(0, 0)`                                | Optional offset in user units (v1: origin at top-left of artboard).                                                                                                  |
| Snap            | **Grid snap (optional) + Alt-to-align** | Grid snap is a toggle, off by default on a mouse and **on for touch**, where it is the cheapest precision a finger has; hold Alt to snap to aligned points (see §6). |

Changing artboard size does **not** auto-resize from imported images. Optional action: “Fit view to artboard” (camera only).

### 4.2 Coordinate display

Side panel shows cursor/selection in **artboard user units** (integers when snapped). Optionally show screen pixels for debugging (secondary).

---

## 5. Reference images

### 5.1 Capabilities

- Load one or more images (file picker; drag-and-drop nice-to-have).
- Per image: position (x, y), scale (uniform + non-uniform if easy; minimum uniform for v1), rotation (degrees), opacity (0–1).
- Images are **reference only**; excluded from Save SVG and clipboard export.
- Z-order among images (bring forward / send back) relative to other images only (always below SVG document).

### 5.2 Side panel

List selected image with editable transform and opacity. Multi-image: select which image to edit from list.

A reference image has **no name of its own**: the row's title is the file it came from, and clicking
it replaces that file. A second, editable label for the same thing was only ever a way to lose track
of which file was being traced.

---

## 6. Grid & snapping

### 6.1 Grid

- Toggle visibility (the eye on its row).
- Visual: lines at `gridStep` intervals across artboard (clipped to artboard bounds).

### 6.2 Alignment snap (Alt, default off)

Grid snapping is a separate toggle (§4.1, magnet button or `G`); Alt overrides it while held. Holding **Alt** while placing or dragging any of the following checks the cursor's world position against every existing point in the document (anchors, handles, line endpoints, rect corners, circle/ellipse centers, polyline/polygon vertices) and snaps independently per axis to the nearest one that lines up horizontally or vertically within a small on-screen tolerance:

- New path anchor points and handle control points.
- Existing anchors and handles when moved.
- Whole-shape drag translation (the drag offset follows the aligned cursor position).

A magenta dashed guide line is drawn across the artboard at the matched x and/or y coordinate while the alignment is active, and disappears when Alt is released or the pointer moves away from alignment. Releasing Alt (or never holding it) places/drags at the raw cursor position with no snapping at all.

### 6.3 What does not snap

| Case                                   | Behavior                                          |
| -------------------------------------- | ------------------------------------------------- |
| Camera pan/zoom                        | No snap (viewport only).                          |
| Rotation of shapes/images              | Angle continuous; Shift snaps to 15°.             |
| Opacity, color pickers, numeric fields | No snap; user may type exact values for position. |
| Without Alt held                       | Free (float) coordinates everywhere.              |

---

## 7. Drawing tools & primitives

### 7.1 Styling

Per-primitive, editable in the Primitives accordion (§12.2):

- `stroke` (color, per primitive).
- `stroke-opacity` (0–1, default `1`); omitted from export when `1`.
- `stroke-width` (user units; default `2`; per-object editable).
- `stroke-linecap`: `round` | `butt` | `square` (default `round`).
- `stroke-linejoin`: `round` | `miter` | `bevel` (default `round`).
- Fill is off by default (`fill="none"`, matching v1's original stroke-only look). A **Fill** toggle enables it, revealing `fill` (color) and `fill-opacity` (0–1, default `1`, omitted from export when `1`). Disabling the toggle sets `fill="none"` again without discarding the chosen color.
- **Gradients** (linear or radial) replace the solid fill. A gradient is a list of stops - colour,
  opacity and offset - with rows in the shape's panel to add, recolour, move and remove them. The
  first stop doubles as the solid colour, so switching the gradient off leaves something sensible.
  Where the gradient runs is **two handles on the shape**, stored as fractions of its bounding box
  so it follows the shape when that is moved or resized: for a linear the two ends of the vector,
  for a radial the centre and a point on the circle.
- Imported SVGs: `fill`/`fill-opacity`/`stroke-opacity` are read from the source node; an element with no `fill` attribute at all imports with fill off (this tool's default), not the SVG-spec default of black.

Future: per-vertex fill rules, pattern fills.

### 7.2 Supported SVG primitives (target completeness)

| Tool    | SVG element                                    | v1      | Notes                                                                                                                                                                                                                         |
| ------- | ---------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pen     | `<path>`, or `<line>`/`<polyline>`/`<polygon>` | **Yes** | One tool for all freeform shapes — see §7.4.                                                                                                                                                                                  |
| Rect    | `<rect>`                                       | **Yes** | Corner radius `rx`/`ry` optional later. Hold Shift for a square.                                                                                                                                                              |
| Ellipse | `<ellipse>`                                    | **Yes** | Hold Shift for a circle (no separate Circle tool).                                                                                                                                                                            |
| Circle  | `<circle>`                                     | n/a     | No dedicated tool. An ellipse has a diagonal handle that keeps both radii equal, and an ellipse whose radii are equal exports as `<circle>`.                                                                                  |
| Arc     | `<path>` cubic segments                        | No      | Dropped. It produced the same two-point cubic the pen does, differing only in being an _exact_ circle; that is not worth a permanent slot in a six-button toolbar. `A` commands still import, converted to cubics (`arc.ts`). |
| Text    | `<text>`                                       | **Yes** | Click to place; edit content/size/font/alignment in the row.                                                                                                                                                                  |

Each primitive is a **first-class object** in the scene graph with stable `id` (for project file and selection).

### 7.3 Pen tool (cubic Bézier — recommended semantics)

- **Click** on artboard: add **corner** anchor (handles retracted or colocated).
- **Click + drag**: add **smooth** anchor; drag sets outgoing handle; incoming handle mirrored (symmetric smooth).
- **Click on first anchor** of open path (with tolerance): **close path** (subpath `Z`).
- **Esc**: cancel current segment in progress (keep existing anchors) or cancel placement mode per context.
- **Enter / double-click**: **finish** open path (end current subpath, tool stays in pen for new path).
- While drawing, preview segment follows pointer (snaps to aligned points while Alt is held).

**Point editing** (select tool):

- Select anchor: move anchor (Alt-aligns per §6).
- Select handle: adjust curvature; broken/smooth/corner conversion:
  - **Alt/Option + drag handle**: break symmetry (corner).
  - Double-click anchor (or shortcut): cycle smooth ↔ corner.
- **Delete** selected anchor(s) or whole path.
- Add point on segment: click segment with appropriate modifier (e.g. Alt+click) — spec’d for v1.1 if tight; include in full spec as required feature.

Paths support **multiple subpaths** in one `<path>` only when user explicitly joins; default is **one path element per continuous trace** for simpler editing.

### 7.4 Continuous paths vs new path

- One continuous stroke per path until user finishes (Enter / double-click / tool action “Finish path”).
- “New path” starts a new `<path>` element.

---

## 8. Selection & manipulation

### 8.1 Selection model (recommended)

- **Select tool (V):**
  - Click object: select whole primitive (shows bounding box + path anchors/handles when path).
  - Click anchor/handle: select that control point (paths).
  - **Shift+click**: add/remove from selection.
  - Drag on empty artboard: marquee selection.
- **Multi-select:** move, delete, duplicate, z-order, and **group color** apply to all selected.
- **Delete / Backspace:** remove selected objects or selected points (if only points selected, delete points; if one point left on path, delete path or keep minimum per implementer rule: min 2 points for open path).

### 8.2 Transform

- Drag selected object(s): translate (Alt-aligns per §6).
- Path: move anchors/handles individually when selected.
- Rect/circle/ellipse: drag bounds handles (corners for rect; radius handles for circle/ellipse).
- **Uniform handle:** a rect has one just outside its bottom-right corner that keeps width and
  height equal, and an ellipse has one on its diagonal that keeps both radii equal. Square and
  circle without a modifier held, which is the only way to get them on a touch screen.
- **Typed geometry:** every shape's row carries X, Y, W, H (and an angle where the shape stores
  one), measured from its bounding box, so one set of fields covers a rect, an ellipse and a
  traced path alike. Typing is the one way to be exact that a fingertip cannot manage.
- **Rotation** is stored on the shapes whose element can express it - rect, ellipse, circle and
  text - and exported as `transform="rotate(a cx cy)"`. They keep their type and stay editable as
  what they are. A path or polyline has the rotation baked into its points instead, which loses
  nothing. Drag the rotate handle, twist with two fingers, or type the angle.

### 8.3 Z-order

- Bring forward / send backward / bring to front / send to back (shortcuts `[` `]` with modifier).
- Order reflected in SVG DOM order.

### 8.4 Clipboard

- **Duplicate:** Ctrl+D.
- **Copy/paste:** duplicate objects with offset (Phase 2 if not v1).

---

## 9. Color

- Each primitive has its own **`stroke` color** and independent **`fill` color** (CSS `#rrggbb`), each with its own opacity (§7.1).
- Default stroke color: `#000000`; fill defaults to off (`fill="none"`).
- Color pickers live per-primitive in the Primitives accordion (§12.2), not a shared selection panel — there is currently no bulk "apply to all selected" color action; multi-select is used for move/delete/duplicate/z-order, not shared styling. (Not yet implemented: an explicit **Group** concept in the project JSON.)

---

## 10. Viewport

- **Zoom:** wheel (around cursor), the +/- buttons, or pinch; range 10%–1600%.
- **Pan:** middle mouse, space+drag, or one finger on empty canvas. There is no hand tool: it
  was redundant three ways over, so select is simply the resting state with no drawing tool
  chosen. On touch, resting still for a moment before dragging gives a marquee instead.
- **Fit artboard in view** / **Reset zoom** (100% centered).
- Rulers optional Phase 2; **cursor position readout** in side panel for v1.

---

## 11. View modes

| Mode                   | What is visible                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------- |
| **Edit** (default)     | Images + grid (if on) + SVG document + handles/selection overlay.                   |
| **Final SVG** (toggle) | **Only** exportable SVG layer—no images, no grid, no handles. Pan/zoom still apply. |

Live **formatted SVG** text in side panel always reflects exportable document (pretty-printed, stable attribute order where practical).

---

## 12. Side panel

### 12.1 Document

- Artboard width/height.
- Grid step; grid visible toggle.
- Background colour with alpha. Alpha 0 is a transparent document: the canvas draws a
  checkerboard and the export carries no background rect. Above 0 it exports as a full-artboard
  `<rect id="background">`, which is also how it is read back, so the live SVG panel round-trips
  it like anything else.
- Alt-to-align hint (no persistent snap toggle).
- View: “Final SVG” toggle.

### 12.2 Selection / cursor

- World X, Y (and handle info if applicable).
- For selected image(s): position, rotation, scale, opacity.
- Per primitive (in its Primitives-list row, expand to edit): stroke color + opacity, stroke width, linecap/linejoin, fill toggle + color + opacity.

### 12.3 Live SVG

- Read-only, formatted preview of export DOM.
- Updates on every document change (debounced formatting acceptable).

### 12.4 Actions

- Save SVG, Save project, Load project, Import SVG (see §13–§14).
- Export/download naming: the document's name, as `Name.svg` / `Name.vellum.json` (`document` when it has none).

---

## 13. Undo / redo

- Unlimited stack (memory-bounded reasonably, e.g. cap 100 steps with warning).
- Records document mutations: geometry, styles, z-order, artboard/grid settings, image list and transforms.
- **Ctrl+Z** / **Ctrl+Y** (or Ctrl+Shift+Z).
- Clear redo stack on new edit after undo.

---

## 14. Persistence & I/O

### 14.1 Save SVG

- File contains **only** exportable SVG:
  - Root `<svg>` with `viewBox`, `xmlns`, optional `width`/`height`.
  - Primitives as elements (paths, lines, shapes).
  - **No** `<image>`, no editor metadata, no grid.
- Stroke-only attributes as drawn.
- Pretty-print optional (default on for file save).

### 14.2 Saved documents (browser storage)

> Documents behave like macOS document lists. Everything autosaves (about 1 s after the last change, never mid-drag) to the browser's **IndexedDB** (not localStorage, whose ~5 MB cap is too small once reference images are embedded); there is no Save button. Two stores: `meta` (id, name, updated) for the list and `data` (serialized project incl. images). There is no name field in the panel header: each row in the Documents list has an inline name input, editable on the open document (click its name), while clicking another row opens it; hover actions are duplicate and delete (with confirmation), and ▲ ▼ move a row up or down. The list is in an order the user sets: each document's meta carries an `order`, a new, duplicated or imported document goes to the top, and saving never moves anything. Every document is named from the start: a new document is created and stored immediately as "Untitled", "Untitled 2", … (`+` does nothing new while the open document is still empty). Deleting the open document opens the first remaining one in the list, or creates a blank one. The very first start, with an empty library, creates **Vellum Workbench**: `public/art.svg` (512 × 320, in Vellum's own export format), fetched and imported by `welcome.ts` — an isometric workbench whose parts are named groups, with a translucent backdrop. The same file is Vellum's card art on the index page. It is an ordinary document once created, deletable like any other; a `vellum.welcomed` flag in localStorage, set once it is in, keeps it from coming back. If the drawing cannot be fetched, the first document is an empty one. The last open document reopens at startup; Ctrl+S forces an immediate save. Documents exist only in this browser; export the SVG for a portable file. Ctrl+A + Delete empties a document (the old "Clear all" button was removed as redundant with New).

Stored shape (versioned by `version`, `PROJECT_VERSION` in `types.ts`). Every released version stays readable: `readProject` (`io.ts`) brings an older document up to the current one step by step, and refuses one written by a newer Vellum with a message to reload. The database has a version of its own (`DB_VERSION` in `storage.ts`) for its stores; a library from before the first release is dropped once, on upgrade, and the welcome drawing is offered again.

```json
{
  "version": 1,
  "artboard": { "width": 512, "height": 512 },
  "grid": { "step": 10, "visible": true, "snap": false },
  "images": [
    {
      "id": "img-1a2b3c4d",
      "name": "reference.png",
      "fileName": "reference.png",
      "dataUrl": "data:image/png;base64,...",
      "x": 0,
      "y": 0,
      "scaleX": 1,
      "scaleY": 1,
      "rotation": 0,
      "opacity": 0.5,
      "visible": true
    }
  ],
  "elements": [/* scene graph in z-order: type, name, geometry, style, optional groups[] */],
  "viewport": { "panX": 0, "panY": 0, "zoom": 1 },
  "tool": "select",
  "finalOnly": false
}
```

- Z-order is the array order of `elements`. Grouping is a `groups` array on each member -
  the ids containing it, outermost first - not a separate list, so nesting needs no tree.
  **Members of a group are always contiguous**, because an `<g>` cannot be interleaved with
  anything else; every reordering moves whole blocks, and an interleaved list from an import is
  gathered back together (`normalizeGroups`).
- Style defaults are not stored: an element carries its full style, and new elements take the app's defaults.
- Images stored as **data URLs** for portability (note file size in UI).
- Restores full session including camera.

### 14.3 Load project

- Reverse of save project; validates version.

### 14.4 Import SVG

- Parse uploaded `.svg`:
  - Respect `viewBox` if present; optionally merge into current artboard or prompt “replace artboard / fit content.”
  - Import supported elements: `path`, `line`, `polyline`, `polygon`, `rect`, `circle`, `ellipse`.
  - Strip or ignore `image`, `defs` filters, stylesheets (document behavior: ignore external CSS; inline `stroke`/`stroke-width` preserved).
  - Convert to internal scene graph for editing.
- Imported content is editable like native primitives.

---

## 15. Keyboard shortcuts (minimum set)

| Key                   | Action                                                       |
| --------------------- | ------------------------------------------------------------ |
| S                     | Select tool (also the resting state: no drawing tool chosen) |
| P                     | Pen tool                                                     |
| R                     | Rect (Shift = square)                                        |
| E                     | Ellipse (Shift = circle)                                     |
| T                     | Text                                                         |
| Ctrl+G / Ctrl+Shift+G | Group / ungroup                                              |
| X                     | Split path at the selected point                             |
| J                     | Join the two selected open paths                             |
| Space (hold)          | Pan the view (or middle-drag, or one finger on empty canvas) |
| Esc                   | Cancel current operation                                     |
| Enter                 | Finish path                                                  |
| Delete                | Delete selection                                             |
| Ctrl+Z / Ctrl+Y       | Undo / redo                                                  |
| Ctrl+S                | Save now (autosave is always on)                             |
| Ctrl+A                | Select all shapes                                            |
| Ctrl+Shift+S          | Save SVG                                                     |
| Ctrl+D                | Duplicate                                                    |
| Ctrl+C / X / V        | Copy / cut / paste (also accepts SVG markup)                 |
| `[` / `]`             | Z-order down / up (with Ctrl or Alt)                         |
| G                     | Toggle snap to grid (orange marker shows the snapped point)  |
| Alt (hold)            | Snap to aligned points while held (overrides grid snap)      |

Additional tool shortcuts for polyline/polygon as needed.

---

## 16. Non-functional requirements

- **Offline** after the first load. The build's service worker precaches the page, and the document stays in the browser.
- **Performance:** smooth interaction with hundreds of anchors; debounce SVG preview formatting.
- **Accessibility:** focusable panel controls, ARIA labels on tools; canvas/SVG keyboard nudging (arrow keys move selection by 1 user unit, ×10 with Shift).
- **Browsers:** recent Chrome, Firefox, Edge, Safari.

---

## 17. Implementation phases

### Phase 1 — MVP (shippable)

- Artboard + grid + snap (§4, §6).
- Single/multiple images (§5).
- Pen, line, rect, circle, ellipse, polyline/polygon (§7).
- Select, move, point/handle edit for paths (core §8).
- Stroke only + per-object color (§7.1, §9).
- Zoom/pan, final SVG toggle, live SVG panel (§10–§12).
- Undo/redo (§13).
- Save SVG, save/load project (§14.1–14.2).

### Phase 2 — Completeness

- Import SVG (§14.4).
- Marquee multi-select, z-order, duplicate (§8).
- Add/remove path points on segment; corner/smooth (§7.3).
- Copy/paste with offset (§8.4).
- Arrow-key nudge; fit artboard in view.

### Phase 3 — Polish

Done: fill + alpha, per-shape opacity, rect corner radius (separate rx/ry, on-canvas corner
handle), rulers (always on), text tool, groups (`<g>`), line-end markers, add/remove anchor
points, smooth↔corner toggle, path close/open/split, docked SVG panel with splitter, popover
color picker with alpha, undo/redo buttons, Ctrl+C/X/V clipboard (own JSON or plain SVG markup),
name-in-id export, Help panel (`?` button).

### Phase 4 — Touch, and the rest of the spec

- **Gradients** with any number of stops, positioned by two handles on the shape rather than an
  angle. Stored as fractions of the bounding box, so the gradient follows the shape.
- **Nested groups** and **imported `<g transform>`**, baked into coordinates at import
  (`transform.ts`); a shape keeps its type when the transform is one it can express.
- **A path parser that reads what other tools actually write:** implicit command repeats,
  `Q`/`T`/`S`, and `A` converted to cubics.
- **Non-destructive rotation** for rect, ellipse, circle and text (§8.2).
- **Touch:** one-finger pan, hold-to-marquee, two-finger pinch/pan/rotate, finger-sized handle
  targets, a tool bar under the canvas, a contextual action bar beside the selection, and text
  edited in place instead of in a panel over the artboard.
- **Document background** with alpha; transparent is the default and exports nothing (§12.1).
- **Wide layout:** one bar across the top: Document, undo / redo and the tools on the left; fit,
  zoom and Final SVG on the right beside the light / dark switch and Help. The cursor position
  floats over the canvas at the top right, under the ruler, light text on a dark halo, so it
  takes no room in the bar. The phone layout starts at 720px with a mouse, 800px on a touch
  screen, whose buttons are larger.
- **Panels:** the Document panel docks left and Help docks right; each keeps room for its
  scrollbar, so content that starts to scroll does not reflow. On a phone, where either covers
  the canvas, opening one closes the other.
- **Phone layout:** both toolbars float over the canvas instead of taking a strip of it, clear of
  the rulers, transparent between the buttons so the canvas still pans there. Fit-artboard reads
  the strips they cover so it fits what is actually free. There is no overflow menu: Document,
  undo, redo, fit, zoom, Final SVG and Help fit across the top at 360px, and the drawing tools and
  the snap magnet sit in the bottom bar. Buttons are the same size in both bars. The light / dark
  switch, which sits beside Help on a wider screen, moves into the Help panel's header.
- **Zoom is one control**, not three: a button reading the current level that opens a list of
  presets, and that follows the viewport however it changed (wheel, pinch, fit).
- **Help** opens on the pointer it detects and can be switched between mouse/keyboard and touch,
  because a laptop with a touch screen is both. It also carries an About section: what the app is,
  where documents live, and where the name comes from.

**Not implemented:**

- Gradient stops cannot be dragged along the gradient line on the canvas (they are typed as a
  percentage in the shape's row).
- `<g>` has no transform of its own: an imported one is baked into the coordinates, so a group
  cannot be rotated as a unit after import.
- Multi-line text.
- Patterns, clip paths and masks (skipped on import, cannot be created).

**Optional extras (only if wanted):**

- Arrow keys moving the selected anchor instead of the whole shape.
- Multi-point editing (selecting several anchors at once).
- Align and distribute for selected shapes.
- Real touch-device verification of one-finger dragging, handles and drag-reordering the Primitives list (touch improvements above were only tested with synthetic events).
- Manual verification with a real mouse of Alt-drag handles, drag-endpoint-to-close and X-split (scripted-event tested only).

### Interaction notes (added in Phase 3)

- **Anchors:** double-click a segment (of a selected path/line/polyline/polygon) to insert a vertex; curved segments are split so the shape doesn't change. Double-click an anchor, or use the curve / corner button on its bar, to toggle curve ↔ corner (a line/polyline/polygon vertex converts the shape to a path first). Double-click a curve handle, or grab it and use the bar's remove button, to take that one handle off. A multi-selection shows every member's handles (path points and shape handles alike) until the total passes a budget, past which it shows boxes only. Click an anchor/vertex to select it, Delete removes it.
- **Rotate:** drag the pink handle above the selection; Shift snaps to 15°. Rectangles become polygons and ellipses become paths on first rotation.
- **Groups:** Ctrl+G / Ctrl+Shift+G or the Group/Ungroup buttons. Clicking any member on the canvas selects the group; the Primitives list toggle selects individual members. Exported as `<g id="…">` (members are kept contiguous in z-order). A group can be named on the line at its head in the Primitives list; the name is stored by group id in the document (`groupNames`) and exported after the id, `<g id="group-57cc1c37_top_view">`, the same way shape names are. On import, the part after the first `_` of a `group-…` id is the name, and any other `<g id>` becomes the name of a fresh group. Each group gets a hue once, when it first appears (`groupHues`, saved with the document, never exported): the first step of the golden-angle sequence at least 30° from every hue in use, so it stays distinct and keeps its colour wherever it moves. On the canvas a selected group is outlined in that same colour, standing a few pixels off its members (further for a group that holds groups, so nested boxes never overlap); its members' own boxes step back to a thin dashed line. Every selection outline is drawn over a pale halo so it reads on the dark canvas and on a white artboard alike. Hovering a grouped shape shows the group's box, in the group's colour, since that is what a click selects. Each group has a row of its own at the top of its bracket, laid out like a shape's row so the buttons line up: chevron (folds the group; list view state only, not saved or undone), checkbox (selects every member), name (live while typing, one undo step per edit), member count in the colour-preview slot, eye (shows or hides every member), ▲ ▼ (moves the group as one block among its siblings, stopping at the edge of the group that holds it - `moveGroup`), and a bin that deletes the group with its contents.
- **Path topology:** "Closed" checkbox in the primitive row closes/opens a path (polyline <-> polygon). Dragging an endpoint onto the opposite endpoint merges them and closes the shape; onto another open shape's endpoint, joins the two. While dragging, the end a drop would merge with is ringed in green (`dropTarget`, pointer-only state). X splits at the selected anchor (closed shape -> one open path, open path -> two); the ends of an open path cannot be split and their bar does not offer it. Delete removes the anchor and rejoins its neighbours. A path anchor's two handles are linked (`smooth`: dragging one mirrors the other) or broken into a cusp (each moves on its own, arms drawn dashed). Grabbing a handle selects its anchor, and the bar beside the anchor links or breaks the pair; linking mirrors the in-handle off the out-handle. While dragging a linked handle, holding Alt breaks the pair live (partner stays put) and releasing Alt restores the mirror; a cusp stays a cusp until it is linked from the bar. On import a point is linked when its handles lie on one line through it, pointing apart (with slack for whole-unit rounding), and a cusp otherwise.
- **Document panel (merged Document + SVG):** one toolbar button opens a docked left panel with collapsible sections (Documents, Reference images, SVG, Primitives; open/closed state remembered). A "Documents" section (with a dot while an autosave is pending) lists stored documents (click to open, click the open one's name to rename, hover for duplicate / delete, `+` for a new one); the SVG section holds artboard width × height and SVG import/export/copy. The toolbar holds a grid visibility toggle, an inline grid-step field, the snap magnet, Fit view, 100% and the Final-SVG-only eye. Grid snapping (off by default, magnet button or `G`, `grid.snap`) snaps drawing points, dragged handles/vertices and the top-left of moved shapes; Alt alignment overrides it while held.
- **Editable SVG source:** the SVG section holds the artboard size row and a live, editable text area (a transparent `<textarea>` over a colored `<pre>`). Edits apply to the drawing ~0.5 s after typing stops (or on blur) by re-importing the markup with generated ids restored (`importSvgFile(text, {keepIds:true})`); invalid markup shows an error and changes nothing. Shapes whose re-imported markup is identical keep their original float geometry and smooth flags (the text only holds rounded integers), so only edited shapes are re-quantized. Moving the cursor into a shape's line selects that shape (same as picking it in Primitives); selected shapes' lines are blue; selecting elsewhere scrolls the text to the shape. Unsupported tags are dropped on apply. One undo step per editing session.
- **Easy picking:** every non-text shape is rendered twice on the canvas: the real shape and a transparent copy of its outline (class `hit-area`, stroke width = max(real width, 10 screen px / zoom), pointer-events `stroke`) so thin strokes are easy to click. In Select mode the shape under the cursor gets a blue hover outline (`state.hoverId`, overlay only, never exported).
- **Field → attribute highlight:** when a field or color swatch in a Primitives row has keyboard focus (even if that shape is not selected), the SVG attribute(s) it edits are highlighted in yellow in the SVG text (e.g. Width -> `stroke-width`, Name -> `id`, gradient/marker fields -> the whole `<linearGradient>`/`<marker>` block in `<defs>`), and the text scrolls to it. While a color popover is open its swatch counts as focused, so the attribute stays highlighted and follows the value. Selects keep keyboard focus after a change; clicking the canvas releases it so shortcuts work again.
- **Group / Ungroup / Join buttons** are disabled unless they would do something: Group needs two or more selected shapes that are not already one group; Ungroup needs a grouped shape in the selection; Join needs exactly two selected open paths/lines/polylines.
- **Row layout (Primitives, Reference images and Documents):** chevron (expand/collapse, on the left like the section headers; Documents have no body so they have no chevron), select control (a radio where the choice is exclusive - which document is open - and a checkbox for selecting primitives), name (for a reference image, the file chip instead), color preview (primitives only), an eye that shows or hides the shape or overlay, ▲ ▼ move buttons (disabled at the ends; Shift+click jumps to the front/back) and a trash icon at the far right. Primitives and Reference images are listed front to back, like a layers panel: the last thing in the document, drawn on top, heads the list, so ▲ brings forward. The document and the SVG source keep SVG order (`towardFront` in accordion.ts maps a row's arrow onto it). There is no drag handle or drag-and-drop reordering and no Delete button in the expanded body; delete is undoable. The color preview is 74px wide so its left edge lines up with the controls below.
- **Default names:** every shape always has a real name stored in `el.name` (so it is exported in the id and re-imported from it; nothing else is stored in the document that the SVG does not express). Unnamed shapes get `<type> <n>` ("path 1", "rect 2", …) with n = highest used for that type + 1; default names of a different type (path→line, rect→polygon after rotation) and duplicated defaults (copy/paste) are renumbered automatically; clearing a name restores a default; names typed by the user are never touched. Enforced centrally in `state.js` (`ensureDefaultNames`, run by `setState`/`replaceState`), so old documents and imported SVGs get names too.
- **Hidden shapes:** the eye on a Primitives row sets `hidden`. A hidden shape is not drawn, cannot be hit, marquee-selected, Ctrl+A-selected or snapped to, and leaves the selection when hidden. It is still in the document and in the export, as `display="none"`, because the SVG panel re-imports its own output and would otherwise delete it; `display="none"` on import (on the shape or an ancestor) reads back as hidden.
- **Invisible shapes:** a shape with stroke width 0 (exported as `stroke="none"`) and no fill paints nothing, exactly as in any SVG viewer. The app keeps it clickable (pointer-events `all`) and shows its Primitives row dimmed/italic so it can be found and fixed.
- **Control widths:** every input, dropdown, color swatch and file chip in a primitive/image row body is 150px wide (`--field-w`) so the right edges line up; the row-header color preview lines up with them (see Row layout) and shows the gradient at its real angle.
- **View state is the tab's, not the document's:** zoom, pan and which panels are open are kept
  in `sessionStorage` (`session.ts`) and restored on reload, keyed by document id so another
  document still gets its own fitted view. A new tab starts fresh, and nothing of it travels with
  an exported or shared file.
- **A group holds at least two children** (`groups.ts`). A group carries nothing but its
  membership, so a `<g>` around one shape, or around only one other `<g>`, expresses nothing that
  its content does not; both are dropped. The rule runs on every state change, so deleting members
  dissolves the group around the survivor, and it runs on import, so a redundant wrapper collapses.
- **The Primitives list is a tree**, not a flat list with per-row stripes: a group is one coloured
  rail down the rows it holds, nested rails for nested groups.
- **One scroller:** the Document panel scrolls as a whole; no section brings its own scroll area
  and none has a fixed share of the height. The SVG source box is the single exception, at a
  clamped height, because a text editor that grows without bound pushes everything past the edge.
- **Document rows** carry no date: the list is in the order the user gives it, and a second line
  per row cost more than it told.
- **Documents move one at a time:** a row's export writes that document (reference images
  included) as `Name.vellum.json` with the tag `vellum/document`; the header's import reads one
  back, always with a fresh id and a free name, so it is added beside what is there and never
  overwrites it. There is no whole-library file: it could only ever be restored wholesale, which
  is the wrong unit for moving one drawing between two browsers.
- **Deleting documents:** empty documents (no shapes, no reference images) are deleted without a confirmation; others ask first.
- **Document panel layout:** the SVG section is a fixed one third of the window height when open (no splitter; it takes no space when collapsed) and Primitives fills the rest. Creating a document (`+`) expands the Documents section and focuses the new name; adding a reference image expands Reference images. Docked left, full height, translucent frosted overlay on the canvas (canvas does not move). A splitter between the SVG text and the Primitives list resizes them (remembered). Undo/Redo buttons in the toolbar. Rulers are always on and start to the right of the SVG panel when it is open. Primitive names export as `id="<generated-id>_<name>"` (generated ids are 8 hex chars starting with a letter, e.g. `d8e4764a_my_shape`; spaces in names become `_`; other invalid characters are dropped; only the first `_` separates the parts) and are read back from that, or from a `<title>`, on import.
- **Markers/gradients** are emitted into a `<defs>` block with ids derived from the element id.
- **Rect corners:** the handle just inside the top-right corner sets the radius; hold Alt for independent horizontal/vertical radii (stored as `rx`/`ry`, `ry` absent means "same as rx").
- **Join:** with two open paths selected, J / the Join button connects their closest ends (merging coincident ends, otherwise adding a straight segment). The joined shape is named "<first> <second>" when both have custom names, keeps whichever custom name exists otherwise, and gets a fresh default name when both are defaults (lines become a polyline). Dropping an end point onto another open path's end joins them too.
- **Keyboard focus:** shortcuts are ignored only while typing in a text/number field, select or textarea; focused checkboxes/buttons don't block them, and clicking the canvas blurs the field.
- **Clipboard:** copy writes JSON (`{tag:"vellum/elements", elements}`) to the system clipboard; paste accepts that or SVG markup. Each paste offsets by the grid step (min 10).

---

## 18. Open decisions (resolved)

| #   | Topic        | Decision                                                                                  |
| --- | ------------ | ----------------------------------------------------------------------------------------- |
| 1   | Artboard     | Fixed defaults, user-configurable, not tied to image.                                     |
| 2   | Pen / Bézier | Cubic; click vs drag semantics per §7.3.                                                  |
| 3   | Snap         | Grid snap toggle (off by default); Alt-to-align to other points, horizontally/vertically. |
| 4   | Selection    | Select tool model per §8.1.                                                               |
| 5   | Style        | Stroke only v1.                                                                           |
| 6   | Final view   | Exportable SVG only—no handles, grid, images.                                             |
| 7   | Persistence  | Save SVG + save project.                                                                  |
| 8   | Import       | Import SVG for editing (Phase 2 in rollout; required in full product).                    |
| —   | Color        | Per primitive; multi-select/group applies shared stroke color.                            |

---

## 19. Success criteria

- User can trace a logo over a reference image with Alt-aligned anchors, toggle final preview, and save an SVG that opens correctly in Inkscape/browser with no raster embedded.
- User can save project, reload, and continue editing with images and geometry restored.
- User can import a third-party SVG, change stroke color and path points, and re-export.

---

## 20. Glossary

- **Artboard:** Fixed user-coordinate rectangle defining SVG `viewBox`.
- **Document layer:** Exportable SVG elements only.
- **Reference image:** Raster guide; project-only unless user exports separately.
- **Overlay:** Handles, selection UI, grid—not serialized to SVG.

---

## 18. Touch

Vellum is used on a phone and a tablet as much as on a desktop, and a tool whose actions are all
keyboard shortcuts is unusable without a keyboard. The rules that follow from that:

- **Targets are sized for the pointer.** A handle is a transparent target circle with the visible
  dot drawn over it, so how big a handle looks and how big it is to hit are independent. Targets
  are ~44px across on touch, shrunk where neighbouring points sit closer together than that, and
  they keep one size at every zoom level.
- **A press is not a drag.** A drag starts only once the pointer has travelled past a slop
  threshold (10px touch, 6px stylus, 4px mouse), and the undo snapshot waits for that too. A tap
  that selects never nudges, and never spends an undo step.
- **One finger pans on empty canvas**, two pinch, pan and rotate. Holding still before dragging
  gives a marquee. There is no hand tool.
- **Nothing needs a modifier held.** A square and a circle have their own diagonal handles, an
  angle can be typed, and grid snap is on by default.
- **Nothing needs a keyboard.** The bar beside the selection carries delete, duplicate, z-order,
  close/open, group/ungroup, split and join. With one anchor selected it sits beside that anchor
  rather than the whole shape, and offers only what acts on the anchor: make it a curve or a
  corner, remove the handle grabbed last, link or break its handles, split (not at the ends of an
  open path), close/open, delete the point. The selection bar also leads with two keyboard stand-ins:
  an **add to the selection** switch (Shift-click for a finger: taps toggle shapes in and out,
  empty canvas no longer clears; it turns itself off when the selection empties) and **select
  everything**. On a touch screen it also carries **copy**, for taking shapes to another document
  (duplicate copies within this one; a keyboard has Ctrl+C). On a touch screen with nothing selected the bar stays up,
  docked above the tool bar, with **select everything** and **paste** (this tab's last copy, else
  the system clipboard, which may ask for permission). Beside the magnet, an **align** switch
  does what holding Alt does. These switches are session state (`modes.ts`), outside the editor
  state, so undo never flips them. Two-finger twists, and rotate-handle drags by touch or pen,
  catch on each 15° within 3° of it (`magnetTurn`). While the pen has a path open it offers
  throw it away, take back the
  last point / close and finish / finish, which is how a path ends without a double-tap. It shows
  on every pointer: a mouse has the shortcuts, but knowing them is not the same as having them to
  hand. Text is edited in place on the canvas rather than in a panel over it.
- **The chrome gets out of the way.** On a narrow screen the tools move to a bar under the canvas,
  the view controls collapse into one labelled menu, and the cursor readout is hidden - one 57px
  row of four buttons instead of four rows. Anything that belongs to the document rather than to
  the moment (the grid's visibility and step) lives in the Document panel, not the toolbar.
