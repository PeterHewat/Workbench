/** The shape of a Vellum document: scene elements, reference images and editor state. */

export const ELEMENT_TYPES = [
  "path",
  "line",
  "rect",
  "circle",
  "ellipse",
  "polyline",
  "polygon",
  "text",
] as const;

export type ElementType = (typeof ELEMENT_TYPES)[number];

export type FillType = "solid" | "linear" | "radial";
export type MarkerShape = "none" | "arrow" | "dot" | "square" | "diamond";
export type LineCap = "round" | "butt" | "square";
export type LineJoin = "round" | "miter" | "bevel";
export type TextAnchor = "start" | "middle" | "end";
/** "select" is the rest state: no drawing tool chosen, so the canvas selects and navigates. */
export type ToolName = "select" | "pen" | "rect" | "ellipse" | "text";

export interface Point {
  x: number;
  y: number;
}

/** A path anchor plus its two Bézier control points (null when the anchor is a corner). */
export interface Anchor extends Point {
  smooth: boolean;
  hIn: Point | null;
  hOut: Point | null;
}

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * What the artboard is painted with. An opacity of 0 is the transparent document, which exports
 * no background at all; the colour is still remembered so the swatch does not forget it.
 */
export interface BackgroundPaint {
  color: string;
  opacity: number;
}

/** One colour stop of a gradient. `offset` runs 0..1 along the gradient. */
export interface GradientStop {
  offset: number;
  color: string;
  opacity: number;
}

/** Every style an element carries. Elements always hold a complete set. */
export interface StyleProps {
  stroke: string;
  strokeOpacity: number;
  strokeWidth: number;
  linecap: LineCap;
  linejoin: LineJoin;
  fillEnabled: boolean;
  fillType: FillType;
  fill: string;
  fillOpacity: number;
  /** Two or more stops, in offset order. Used when `fillType` is a gradient. */
  gradStops: GradientStop[];
  /**
   * Where the gradient runs, in fractions of the shape's bounding box, so it follows the shape
   * when that is moved or resized. Linear: the two ends of the vector. Radial: the centre, and
   * a point on the circle that sets the radius. Both are dragged on the canvas.
   */
  gradFrom: Point;
  gradTo: Point;
  markerStart: MarkerShape;
  markerEnd: MarkerShape;
}

interface ElementBase extends StyleProps {
  id: string;
  name: string;
  /** The groups containing this element, outermost first. Absent when it is in none. */
  groups?: string[];
  /**
   * Degrees clockwise about the shape's own centre, exported as `transform="rotate()"`.
   * Carried by the shapes that cannot express a rotation in their coordinates - rect, ellipse,
   * circle and text. Paths and polylines have their rotation baked into their points instead,
   * which loses nothing, and never set this.
   */
  rotation?: number;
  /**
   * Hidden in the editor and in the file (`display="none"`), but still part of the document:
   * the SVG panel re-imports its own output, so a shape left out of it would be deleted.
   */
  hidden?: boolean;
}

export interface PathElement extends ElementBase {
  type: "path";
  points: Anchor[];
  closed: boolean;
}

export interface LineElement extends ElementBase {
  type: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface RectElement extends ElementBase {
  type: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
  /** Absent means "same as rx". */
  ry?: number;
}

export interface CircleElement extends ElementBase {
  type: "circle";
  cx: number;
  cy: number;
  r: number;
}

export interface EllipseElement extends ElementBase {
  type: "ellipse";
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export interface PolylineElement extends ElementBase {
  type: "polyline";
  points: Point[];
}

export interface PolygonElement extends ElementBase {
  type: "polygon";
  points: Point[];
}

export interface TextElement extends ElementBase {
  type: "text";
  x: number;
  y: number;
  text: string;
  fontSize: number;
  fontFamily: string;
  anchor: TextAnchor;
}

export type SceneElement =
  | PathElement
  | LineElement
  | RectElement
  | CircleElement
  | EllipseElement
  | PolylineElement
  | PolygonElement
  | TextElement;

/** Elements whose geometry is a list of points that can be edited individually. */
export type PointsElement = PathElement | PolylineElement | PolygonElement;

export interface ReferenceImage {
  id: string;
  name: string;
  fileName: string;
  dataUrl: string;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  naturalWidth?: number;
  naturalHeight?: number;
}

export interface PathEdit {
  pathId: string;
  kind: "anchor";
  index: number;
}

export interface Selection {
  elementIds: string[];
  pathEdit: PathEdit | null;
}

export interface Viewport {
  panX: number;
  panY: number;
  zoom: number;
}

interface RubberPreview {
  type: "rubber";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  strokeWidth: number;
}

interface ShapePreview {
  type: "shape";
  tag: "rect" | "ellipse" | "path";
  nodeAttrs: Record<string, number | string>;
  stroke?: string;
  strokeWidth?: number;
}

export type Preview = RubberPreview | ShapePreview;

export interface Marquee {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface RotateHandle {
  elementId: string;
  cx: number;
  cy: number;
  x: number;
  y: number;
}

export interface Drawing {
  activePathId?: string | null;
  preview?: Preview | null;
  marquee?: Marquee;
  shapeStart?: Point;
  rotateHandle?: RotateHandle;
}

export interface EditorState {
  artboard: { width: number; height: number };
  background: BackgroundPaint;
  grid: { step: number; visible: boolean; snap: boolean };
  elements: SceneElement[];
  /**
   * Names the user gave groups, by group id. A group is only the id its members carry (see
   * groups.ts), so its name lives here; exported as `<g id="<group id>_<name>">`.
   */
  groupNames: Record<string, string>;
  images: ReferenceImage[];
  viewport: Viewport;
  tool: ToolName;
  finalOnly: boolean;
  selection: Selection;
  drawing: Drawing | null;
  hoverId: string | null;
  cursor: { x: number; y: number; snapX: number; snapY: number; snapActive: boolean };
  align: { x: number | null; y: number | null };
  ui: {
    expandedImageId: string | null;
    expandedElementId: string | null;
    /** The text element being edited in place on the canvas, if any. */
    editingTextId: string | null;
  };
  spacePan: boolean;
}

/** Style plus identity, as copied when an element changes type. */
export type StyleCarrier = Partial<StyleProps> & {
  id?: string;
  name?: string;
  groups?: string[];
  hidden?: boolean;
  /** Import only: the gradient arrived in artboard units and still has to be converted. */
  gradUserSpace?: boolean;
};

/** The serialized document written to storage. */
export interface ProjectFile {
  version: 2;
  artboard: EditorState["artboard"];
  /** Absent in documents saved before backgrounds existed, which means transparent. */
  background?: BackgroundPaint;
  grid: EditorState["grid"];
  images: ReferenceImage[];
  elements: SceneElement[];
  /** Absent when no group has a name. */
  groupNames?: Record<string, string>;
  viewport: Viewport;
  tool: ToolName;
  finalOnly: boolean;
}
