# Vellum — Reference

What Vellum does and how, as built. When this and the code disagree, the code is right and this
is fixed.

## 1. Purpose

A single-page SVG editor for **tracing reference images with true SVG geometry**. Raster images sit
under the artboard as guides that are never exported; paths with Bézier handles and the standard
SVG shapes are drawn over them; the export is **pure SVG**, with no embedded image and no editor
chrome.

| Workflow | What it is                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------------- |
| Trace    | Load an image, pan and zoom, draw over it, export SVG for icons, CNC, laser, plotters or CAD.        |
| Refine   | Reopen a document or import an SVG, select shapes and points, adjust geometry and style, export.     |
| Review   | **Final SVG** hides everything that is not exported, so the canvas shows exactly what will be saved. |

## 2. Technical approach

- Static files: TypeScript compiled by Vite into HTML, CSS and ES modules. No runtime framework and
  no runtime dependency. Geometry, undo and path maths live in the app.
- The document layer is real SVG in the DOM, drawn from the scene graph in `state.ts`. Everything
  else is drawn in layers of its own that are never exported:

```text
┌─────────────────────────────────────────┐
│  Pointer layer (hover, snap mark)       │  never exported
├─────────────────────────────────────────┤
│  Overlay (guides, handles, selection)   │  never exported
├─────────────────────────────────────────┤
│  Grid                                   │  never exported
├─────────────────────────────────────────┤
│  Document (the SVG that is exported)    │
├─────────────────────────────────────────┤
│  Reference images                       │  never exported
└─────────────────────────────────────────┘
```

- Pan and zoom move a camera; the artboard's `viewBox` never changes with them.
- Offline after the first visit: the build's service worker precaches the page, and documents live
  in the browser.

## 3. Artboard, grid and snapping

- **Artboard:** 512 × 512 user units by default, set in the SVG section. It is what `viewBox`
  exports; importing an SVG takes its `viewBox` (or `width`/`height`).
- **Background:** a colour with alpha, default transparent. At alpha 0 the canvas shows a
  checkerboard and nothing is exported; above 0 it exports as a full-artboard
  `<rect id="background">`, which is also how it is read back.
- **Grid:** step 16 by default (32 cells across 512: one per pixel of a 32px icon). Its visibility
  and step are in the SVG section and belong to the document. It is hidden at a step of 1.
- **Grid snap** (the switch showing a ring on a grid crossing, or `G`) snaps drawing points,
  dragged points and handles, resize and box handles (the corner itself, not the pointer), and the
  top-left of moved shapes. Off by default with a mouse, on with touch.
- **Snap to shapes** (the switch showing a ring on a shape's corner, or Alt held) checks the
  pointer against every point in the document — anchors, handles, line ends, corners, centres,
  vertices, the middle of every segment and every place two shapes cross (`snapFeatures`,
  worked out once per gesture and without crossings past 600 segments) — and snaps each axis to
  the nearest one that lines up within a few screen pixels. A
  dashed guide marks the matched x and/or y. The two switches are exclusive: turning one on
  turns the other off, and a document opened with grid snap on turns snap to shapes off. Alt held
  borrows snap to shapes without changing either switch. While a
  curve handle or a rect's corner-radius handle is dragged, Alt keeps its other meaning instead.
- **Guides** (`guides.ts`): dragged out of the top ruler (horizontal) or the left one
  (vertical); moved by dragging, and taken away by dropping one back on its ruler or
  double-clicking it. With either snap switch on, a point lands on a guide in reach before the grid
  or another shape, and a moved shape lines up its nearest edge or centre with one. A guide being
  placed snaps too: to the grid, or in line with a shape's point when snapping to shapes. Saved with the
  document (`guides`), never exported. The rulers are hidden on a phone, so guides are made on a
  wider screen.
- A marker shows where a snapped point will land.
- Nothing snaps the camera, colours or typed numbers. Rotation is free; Shift steps it by 15°,
  and touch or pen catches on each 15° within 3° of it (`magnetTurn`).

## 4. Reference images

- Any number, from the file picker. Each has a position, a scale (x and y), a rotation, an opacity
  and a visibility eye, edited in its row of the Reference images section, and a place in the
  images' own z-order, always below the document.
- An image has no name of its own: its row shows the file it came from, and clicking that replaces
  the file.
- Stored in the document as data URLs, so a document carries its images.
- The colour picker's dropper picks a colour from them (`eyedropper.ts`): the next press on the
  canvas reads the topmost visible image's own pixel there - not blended with its opacity - and
  keeps the colour's alpha as it was. It shows only when the document has an image.

## 5. Shapes and styles

### 5.1 Primitives

| Tool    | Makes                                                            | Notes                                                                              |
| ------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Pen     | `<path>`, or `<line>` / `<polyline>` / `<polygon>` when straight | One tool for every freeform shape (§6). A path may hold several outlines (§5.4).   |
| Rect    | `<rect>`                                                         | Shift for a square. Corner radius `rx`/`ry`.                                       |
| Ellipse | `<ellipse>`, or `<circle>` when its radii are equal              | Shift for a circle. There is no circle tool.                                       |
| Text    | `<text>`                                                         | Click to place, typed in place on the canvas; size, font and alignment in its row. |

Every element has a stable id and a name. Unnamed shapes are named `<type> <n>`; a default name of
the wrong type (a path become a line) or a duplicate one (after a paste) is renumbered, and a name
someone typed is never touched (`ensureDefaultNames`). A name exports as
`id="<generated id>_<name>"` (8 hex characters starting with a letter; spaces become `_`, other
invalid characters are dropped) and is read back from that, or from a `<title>`.

### 5.2 Style

Every element carries a complete style, edited in its row of the Primitives list:

- Stroke colour and opacity, stroke width (default 2; 0 exports `stroke="none"`), line cap and
  line join (default round).
- Fill: off by default. On, it is a solid colour with opacity, or a **linear or radial gradient**
  with any number of stops (colour, opacity, offset). The first stop is also the solid colour.
  Where a gradient runs is two handles on the shape, stored as fractions of its bounding box so it
  follows the shape.
- A dash pattern (`dash`, exported as `stroke-dasharray`): dash and gap lengths in artboard units.
  Empty, `none`, negative or all-zero is a solid line. The panel offers it as a style (`dash.ts`):
  solid, dashed, dotted and dash-dot are worked out from the stroke width and cap, and worked out
  again when either changes; the numbers show in a Pattern field beside it, which takes typing - digits, points and spaces,
  applied as they are typed -
  only for Custom. Only the numbers are stored, so the style is read back by matching them.
- The fill rule (`fillRule`, exported as `fill-rule`): non-zero, the default, or even-odd.
- Line-end markers (arrow, dot, square, diamond) on lines, polylines and paths. An arrow's tip reaches
  past the end point just far enough to cover the line's cap (round, butt or square), so no stroke
  shows beside it.
- Opacities of 1 are not exported. Markers and gradients go into `<defs>`, with ids derived from
  the element id.
- A shape with no stroke and no fill paints nothing, as in any viewer; Vellum keeps it clickable
  and shows its row dimmed so it can be found.

### 5.3 Hidden shapes

The eye on a row hides a shape: it is not drawn, cannot be clicked, marquee-selected, selected with
Ctrl+A or snapped to, and leaves the selection. It is still in the document and exported as
`display="none"`, because the SVG panel re-imports its own output; `display="none"` on a shape or
an ancestor imports as hidden.

### 5.4 Paths of several outlines

A path holds one outline or several: `points` has every outline's anchors one after another, and
`subpaths` lists where each outline after the first starts. Every outline of a path is closed or
open with it (`closed`). This is how a shape with a hole is drawn - what combining shapes makes,
and what icons with a letter O or a ring are made of. Each outline exports as a subpath of its own
(`M … Z M … Z`), and every `M` in an imported `d` starts one; a `d` mixing open and closed
outlines imports as one path of each. Point editing, inserting and deleting points keep to a
point's own outline, and an outline down to one point goes. Splitting and joining are for
single-outline paths.

### 5.5 Locked shapes

A locked shape (`locked`) is out of reach on the canvas: it is not clicked, box-selected, selected
with Ctrl+A or dragged along with the rest, and shows no handles. It is still snapped to, still
selectable from its row, and unlocked with the row's padlock - beside the eye, and on a group's
row for every member - or from the bar. The lock
lives in the document, not in the exported SVG; the SVG panel's re-import keeps it by id.

## 6. The pen and point editing

### 6.1 Drawing

- Click: a corner point. Click and drag: a smooth point, the drag setting its outgoing handle and
  mirroring the incoming one.
- From the second point on, clicking the first point closes the path; the first point is ringed
  while a click would close it. Two points close into a lens once a segment curves.
- Enter, double-click, or the bar's finish button ends the path; Esc ends it too. The bar also
  closes and finishes, takes back the last point, or throws the path away.
- A path with no curves becomes a line, polyline or polygon (`simplifyPathIfStraight`).

### 6.2 Points and handles

- A path's anchor has two handles, **linked** (dragging one mirrors the other) or broken into a
  **cusp** (each moves on its own; arms drawn dashed). The bar beside a picked point links or breaks
  them. Alt while dragging a linked handle breaks the pair until released. On import, a point is
  linked when its handles lie on one line through it, pointing apart.
- Double-click an anchor, or use the bar, to toggle curve ↔ corner; a line, polyline or polygon
  becomes a path first. Double-click a curve handle, or grab it and press Delete or the bar's
  button, to take that one handle off.
- Double-click a segment to insert a point; a curved segment is split so the shape does not change.
- Delete removes the picked point and rejoins its neighbours. X splits the path there (a closed
  shape opens; an open one becomes two; not at an open path's ends).
- Dragging an end onto the other end closes the shape; onto another open shape's end, joins the
  two. The end a drop would merge with is ringed while dragging (`dropTarget`). J joins the two
  selected open shapes at their closest ends. A joined shape keeps the names that were typed.
- The Closed checkbox in a row closes or opens a path (polyline ↔ polygon).

## 7. Selection

- **Click** a shape to select it; a grouped shape selects its outermost group.
- **Click a member of a selected group** to step one level in — to the nested group holding it,
  or to the shape itself. Inside, clicking another member of that group picks it at that level.
  **Esc** steps back out one level, and first lets go of a picked point.
- Hover outlines what a click would pick, in the group's colour for a group.
- **Shift+click** (or the bar's **add to the selection** switch) toggles shapes in and out.
- **Drag on empty canvas:** a marquee (touch: hold still first, as one finger otherwise pans).
- **Ctrl+A** selects every visible shape.
- **Click a point or handle** to pick it: the bar moves beside the point and offers only what
  acts on it. The shapes selected with it stay selected, so their points can be added.
- **Several points** (`points.ts`): with a point picked, Shift+click (or the add switch) adds or
  removes points of the selected shapes, and a marquee picks the points inside it (with no point
  inside, it selects shapes as usual). Dragging one of them, or the arrow keys, moves them all;
  Delete removes them; the bar makes them all curves or all corners, or aligns them. A plain click
  on one of them picks it alone again.
- A multi-selection shows each member's handles until the total passes a budget, then boxes only.

## 8. Transforming

- **Move:** drag the selection, or the arrow keys (1 unit, 10 with Shift). With a point picked, the
  arrow keys move only that point, or the curve handle grabbed last (a linked pair keeps
  mirroring).
- **Rect, ellipse, circle:** corner handles for a rect, radius handles for an ellipse and circle,
  and a diagonal handle that keeps a square or a circle without a modifier. A rect's corner-radius
  handle sits inside its top-right corner; Alt sets `rx` and `ry` apart. A faint tether joins each
  extra handle to the corner it works from.
- **Path, polyline, polygon:** a hollow handle off each corner of the bounding box stretches the
  shape from the opposite corner (Shift keeps proportions).
- **Rotate:** the pink handle above a shape, a two-finger twist, or the Angle field. Rect, ellipse,
  circle and text store the angle and export `transform="rotate(a cx cy)"`, keeping their type; a
  path or polyline has it baked into its points.
- **Typed geometry:** a row's X, Y, W and H are the bounding box; up and down step to whole numbers.
- **Groups and multi-selections** move, stretch and turn as one: corner handles and a rotate
  handle around their shared box, and under an open group's row in the Primitives list, X, Y, W, H and
  **Rotate**. A group keeps no transform of its own — each change is baked into its members'
  coordinates (`selection-transform.ts`) — so Rotate reads a running total since the shapes were chosen (`turn-tally.ts`: typing turns by the difference, the rotate handle adds to it, and a new selection or an undo starts it from 0), a rotated
  rect or ellipse stretched off its own axes becomes a path, a circle stretched unevenly an
  ellipse, and stroke widths do not scale.

- **Align and distribute** (`align.ts`): the six alignments, and even spacing across or down
  for three or more. What moves is the selection's blocks - a group selected whole moves as one -
  against the box they share, or, for a single block, against the artboard. Picked points align
  and spread the same way.
- **Combine** (`boolean.ts`): union, subtract (the others from the backmost), intersect and
  exclude, for two or more paths, polygons, polylines, rects and ellipses. Curves stay curves:
  every segment is cut where another meets it, each piece is kept when the result lies on one
  side of it only - found by testing a point just either side against every operand - turned so
  the result is on its left, and chained into outlines; pieces of one curve are joined again and
  straight pieces in line merged. Shared edges and identical shapes need no special case. The
  result is one path (a polygon when it is straight and single), with the non-zero rule, in the
  backmost shape's place, name and style. Nothing left is reported and changes nothing.

## 9. Groups

- A group is only an id its members carry: each element has `groups`, the ids containing it,
  outermost first. Nesting needs no tree, and z-order stays the order of `elements`.
- **Members are contiguous**, since a `<g>` cannot be interleaved: every reordering moves whole
  blocks, and an interleaved list from an import is gathered back together (`normalizeGroups`).
- **A group holds at least two children.** A group of one shape, or around one other group, is
  dropped on every change and on import (`pruneGroups`).
- **Group** (Ctrl+G) wraps the selection in a new group; **Merge** (Ctrl+Alt+G) puts it into one
  group without a new level; **Ungroup** (Ctrl+Shift+G) removes the outermost level. Each acts at
  the level the selection was made at, so inside a group they stay inside it. They are disabled
  when they would change nothing.
- Duplicating a member picked inside a group keeps the copy in that group.
- A group's name is stored by id (`groupNames`) and exported after it, as
  `<g id="group-57cc1c37_top_view">`; any other `<g id>` imports as a named group.
- Each group gets a hue when it first appears (`groupHues`, saved, never exported), at least 30°
  from every hue in use. A selected group is outlined in it, standing off its members (further for
  a group holding groups), and its rail in the Primitives list has it.

## 10. The Document panel

A panel docked on the left, toggled by the first toolbar button, scrolled as a whole. Its sections
fold, and which are open is remembered for the tab.

- **Documents:** one row per stored document (§12).
- **Reference images:** one row per image (§4).
- **SVG:** artboard size, grid visibility and step, background, and the live SVG source, with
  import, export and copy buttons, and **Export PNG** (`png-export.ts`): the artboard's size, one pixel to a unit,
  drawn from the exported SVG so it shows exactly what that does. Named `Name.png`. The source is editable: about half a second after typing stops,
  or on blur, it is re-imported with its ids kept (`importSvgFile(text, { keepIds: true })`);
  invalid markup shows an error and changes nothing. Shapes whose markup did not change keep their
  exact geometry. Putting the cursor in a shape's line selects it; selected shapes' lines are
  highlighted, and a focused field in the Primitives list highlights the attribute it edits. One
  undo step per editing session. The box has a clamped height and scrolls on its own.
- **Primitives:** the document as a tree, front to back like a layers panel (▲ brings forward). A
  group is one coloured rail down the rows it holds, headed by a row of its own: fold (which also hides the group's fields, §8), select all,
  name, member count, eye, ▲ ▼ and delete. A shape's row has a checkbox, name, a colour preview
  (its stroke round its fill), eye, ▲ ▼ and delete, and opens to its fields. ▲ ▼ stop at the edge
  of the group holding the row; Shift jumps to the end. Only the rows in view are built.

Every row in every list reads the same way: chevron, select control (a radio where only one can be
chosen, a checkbox otherwise), name, preview, eye, ▲ ▼, delete.

## 11. Layout, touch and help

- **Wide screens:** one bar across the top — Document, undo/redo and the tools on the left; fit,
  zoom and Final SVG on the right beside the theme switch and Help. The cursor position floats over
  the canvas at the top right. Rulers are always on, starting right of the Document panel.
- **Phones** (below 720px, or 800px on a touch screen): both bars float over the canvas; the tools
  and snap switches move to a bottom bar under the thumb. An open panel covers the canvas, so
  opening one closes the other, and the rulers and cursor readout are hidden. The theme switch
  moves into the Help panel.
- **Zoom** is one control: a button reading the level that opens a list - fit the artboard, fit
  the selection, then presets (25%–800%); wheel and pinch go from 10% to 1600%.
- **Touch:** handles have ~44px targets (shrunk where points crowd), a drag starts only past a
  threshold (10px touch, 6px pen, 4px mouse) so a tap never nudges or spends an undo step, one
  finger pans empty canvas and two pinch, pan and rotate. Nothing needs a modifier or a keyboard:
  the bar beside the selection carries delete, duplicate, z-order, close/open, group, merge,
  ungroup, split, join, lock, an **add to the selection** switch and **select everything**, and
  **Align** and **Combine**, each a button opening a page of its own with a way back; with nothing
  selected on a touch screen it offers select everything and paste. Up to seven buttons sit in one
  row, as many as fit across a 360px phone; more split into even rows, eight as two of four, never parting backward from forward. These switches are
  session state (`modes.ts`), so undo never flips them.
- **Help** (`?`) explains everything for the pointer it detects, switchable between mouse and
  touch, and carries an About section.
- **Light and dark** follow the browser until the theme switch is pressed (see AGENTS.md).

## 12. Documents and files

### 12.1 Storage

- Documents autosave to **IndexedDB** about a second after a change, never mid-drag; Ctrl+S saves
  at once. Two stores: `meta` (id, name, order, updated, tags) and `data` (the document, images
  included). A dot in the Documents header shows a save is pending.
- The list is in the order the user sets. A new, duplicated or imported document goes to the top,
  and saving moves nothing.
- `+` creates and stores "Untitled", "Untitled 2", … (nothing new while the open document is still
  empty) and focuses its name. Click the open document's name to rename it; click anywhere else on
  another row to open it. Row actions: duplicate, export, ▲ ▼, delete (asked first unless the
  document is empty). Deleting the open document opens the first remaining one, or a new one.
- **Tags and details** (`doc-list.ts`): a row's ▶ opens its tags - typed with commas, trimmed,
  without repeats (`Icons` and `icons` are one), at most 20 of 32 characters - and its stats:
  shapes, groups, points (path anchors, polyline vertices, line ends), reference images, size and
  when it was saved. Tags live in `meta`, so the list and the search never load a document;
  stats of a closed document load it once and are kept until it changes. Which rows are open
  belongs to the session.
- **Search**: a field above the list, with a magnifying glass at its end that becomes a ✕ to clear
  it once there is text. Commas separate alternatives and spaces the words of one: a document
  stays when, for one alternative, every word is found, ignoring case, in its name or one of its
  tags. What matched is marked - in the name, from a copy laid over the field, and in the tags that
  matched, shown under a folded row. ▲ ▼ are off while the list is filtered. Esc clears the field.
- The last open document reopens at start. The first start, with an empty library, creates
  **Vellum Workbench** from `public/art.svg` (512 × 320, Vellum's own export, also the index
  page's card art); a `vellum.welcomed` flag keeps it from coming back once deleted.
- Zoom, pan and open panels belong to the tab: kept in `sessionStorage` by document id
  (`session.ts`), never in the document.

### 12.2 Stored format

`ProjectFile`, versioned by `PROJECT_VERSION` (`types.ts`). Every released version stays readable:
`readProject` (`io.ts`) brings an older document up to date step by step, and refuses one from a
newer Vellum with a message to reload. The database has its own `DB_VERSION` (`storage.ts`) for
its stores.

```json
{
  "version": 1,
  "artboard": { "width": 512, "height": 512 },
  "background": { "color": "#ffffff", "opacity": 0 },
  "grid": { "step": 16, "visible": true, "snap": false },
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
  "elements": [
    /* in z-order: type, id, name, geometry, full style, and optional groups, rotation,
       hidden, locked, fillRule, dash, and a path's subpaths */
  ],
  "groupNames": { "group-57cc1c37": "top view" },
  "groupHues": { "group-57cc1c37": 210 },
  "guides": { "x": [256], "y": [64, 448] },
  "viewport": { "panX": 0, "panY": 0, "zoom": 1 },
  "tool": "select",
  "finalOnly": false
}
```

### 12.3 Document files

Documents move between browsers as files (`document-files.ts`):

- A row's export writes `Name.vellum.json`:
  `{ "tag": "vellum/document", "version": 1, "exported", "name", "tags"?, "data" }`,
  with `tags` only when there are some.
- The header's export writes every document, in list order, as one library file:
  `{ "tag": "vellum/library", "version": 1, "exported", "documents": [{ "name", "tags"?, "data" }] }`.
- Import takes any number of files of either kind. Every document in them is read by `readProject`
  and added at the top of the list, in the order the file gives, with a fresh id, a free name and
  its tags, cleaned as if typed:
  an import never replaces or merges with an existing document. Files that cannot be read are
  listed; the rest still import.

### 12.4 SVG export and import

- **Export** (Ctrl+Shift+S, or the SVG section's buttons; copy puts it on the clipboard) writes
  only the document: `<svg>` with `xmlns`, `viewBox`, `width` and `height`; the background rect if
  any; `<defs>` for markers and gradients; the elements in z-order, grouped in `<g>`. No image, no
  grid, no editor metadata. Pretty-printed, as the SVG panel shows it. Named `Name.svg`.
- **Import** reads `path`, `line`, `polyline`, `polygon`, `rect`, `circle`, `ellipse` and `text`,
  with nested `<g>`. A path's `Q`, `T`, `S` and `A` commands and implicit repeats are read, arcs
  converted to cubics (`arc.ts`), and each `M` starts an outline (§5.4). `fill-rule` and
  `stroke-dasharray` are read. A `transform` on an element or a `<g>` is baked into the
  coordinates (`transform.ts`); a shape keeps its type when the transform is one it can express
  (a rotation on a rect becomes its stored angle). Fill defaults to off when a shape has no `fill`
  at all. Images, patterns, clip paths, masks, filters and stylesheets are skipped.
- **Export → import → export is byte-for-byte stable** (`io.test.ts`): the SVG panel re-imports
  its own output while typing, and any drift would move shapes.

## 13. Undo, clipboard, keyboard

- **Undo** keeps 100 steps of every document change — geometry, style, order, artboard, grid,
  images. A drag, or a session of typing in one field, is one step. Ctrl+Z; Ctrl+Y or Ctrl+Shift+Z.
- **Clipboard:** copy writes `{ "tag": "vellum/elements", "elements", "groupNames" }` as text —
  exactly the selection, a member picked inside a group included. Paste takes that, offset by the
  grid step (at least 10) per paste, or SVG markup from anywhere, placed where it says.
- Shortcuts are ignored while typing in a text or number field, a select or the SVG source.

| Key                   | Action                                                             |
| --------------------- | ------------------------------------------------------------------ |
| S                     | Select (the resting state: no drawing tool chosen)                 |
| P / R / E / T         | Pen / rectangle (Shift: square) / ellipse (Shift: circle) / text   |
| G                     | Toggle grid snap                                                   |
| Alt (hold)            | Snap to other shapes' points                                       |
| Space (hold)          | Pan (or middle-drag, or one finger on empty canvas)                |
| Enter                 | Finish the path                                                    |
| Esc                   | End the path; let go of a picked point; step out of a group        |
| Delete / Backspace    | Delete the selection, the picked point, or the picked curve handle |
| Arrows                | Move the selection or the picked point by 1 (Shift: 10)            |
| X / J                 | Split at the picked point / join the two selected open shapes      |
| Ctrl+G                | Group (Shift: ungroup; Alt: merge)                                 |
| Ctrl+D                | Duplicate                                                          |
| Ctrl+C / X / V        | Copy / cut / paste (paste also takes SVG markup)                   |
| Ctrl+A                | Select every visible shape                                         |
| Ctrl+[ / Ctrl+]       | Send backward / bring forward                                      |
| Ctrl+Z / Ctrl+Y       | Undo / redo (Ctrl+Shift+Z also redoes)                             |
| Ctrl+S / Ctrl+Shift+S | Save now / export SVG                                              |
| Shift+0 / 1 / 2       | Zoom to 100% / fit the artboard / fit the selection                |

## 14. Not supported

- Multi-line text, patterns, clip paths and masks.
- A transform stored on a group (see §8 for what is done instead).
- Creating guides on a phone, where the rulers are hidden.
- Dragging gradient stops along the gradient on the canvas; they are typed as percentages.
