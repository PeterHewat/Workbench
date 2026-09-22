# Vellum: blueprints an agent can measure (plan)

Intent only. When any of this lands, move the description into [../vellum-spec.md](../vellum-spec.md)
and delete it here.

## Why

Vellum's main use is drawing vehicle blueprints and icon sketches to hand to an agent, which
turns a blueprint into a 3D model in Blender. An SVG that only _looks_ right is a picture. For the
agent to build geometry to scale, the file has to say three things that it cannot say today:

1. **How big a unit is** in the real world.
2. **Which shapes belong to which view** — front, side, top, rear.
3. **How the views line up**, so a point on the side view and the same point on the top view
   share a coordinate.

## What to add

### Real-world scale

- A document setting: _1 artboard unit = N mm_ (or: the artboard is W × H mm).
- Exported on the root element as `data-vellum-mm-per-unit="…"`, and in the `.vellum.json`.
- Rulers can show mm instead of units when a scale is set.

### Views

- Groups can already be named (`<g id="group-57cc1c37_side_view">`), which is enough to tell an
  agent which view is which today. A view adds a role to a group: `front`, `rear`, `left`,
  `right`, `top`, `bottom`, or `detail`, exported as `data-vellum-view="left"` on its `<g>`.
- Each view has an origin (a point on the artboard) and axes, so "x along the vehicle, z up" means
  the same thing in every view. Exported as `data-vellum-origin="x y"`.
- A "third-angle layout" preset places front / top / side in the standard arrangement, with guide
  lines projecting between them so heights and lengths line up as you draw.

### Dimensions

- A dimension tool: pick two points, get a dimension line with its length in mm. Exported as
  `<g data-vellum-dimension="2650">` (the value in mm) with ordinary line and text children, so it
  renders anywhere and a script can still read the number.
- Typical ones for a vehicle: wheelbase, overall length / width / height, track, ground clearance.

### Hand-off

- "Copy for agent": the SVG plus a short plain-text summary — scale, the views and their
  bounding boxes in mm, and every dimension — ready to paste into a conversation.

## Out of scope

- 3D preview. Blender is the 3D tool; checking a render against the blueprint is already possible
  by loading the render as a reference image.
- Units other than mm and inches.

## Open questions

- Should views be separate artboards rather than groups on one artboard? Groups keep one SVG and
  one coordinate space, which is simpler for an agent to read; start there.
- Do icon sketches want anything from this? Probably only the scale-free parts (named groups).
