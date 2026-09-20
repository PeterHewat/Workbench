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
  fill2: string;
  fill2Opacity: number;
  gradAngle: number;
  markerStart: MarkerShape;
  markerEnd: MarkerShape;
}

interface ElementBase extends StyleProps {
  id: string;
  name: string;
  /** The groups containing this element, outermost first. Absent when it is in none. */
  groups?: string[];
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

/** Either open or closed run of plain vertices. */
export type PolyElement = PolylineElement | PolygonElement;

export interface TextElement extends ElementBase {
  type: "text";
  x: number;
  y: number;
  text: string;
  fontSize: number;
  fontFamily: string;
  anchor: TextAnchor;
  rotation?: number;
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
export type PointsElement = PathElement | PolyElement;

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

export interface RubberPreview {
  type: "rubber";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  strokeWidth: number;
}

export interface ShapePreview {
  type: "shape";
  tag: "rect" | "ellipse";
  nodeAttrs: Record<string, number>;
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
  grid: { step: number; visible: boolean; snap: boolean };
  elements: SceneElement[];
  images: ReferenceImage[];
  viewport: Viewport;
  tool: ToolName;
  finalOnly: boolean;
  selection: Selection;
  drawing: Drawing | null;
  hoverId: string | null;
  cursor: { x: number; y: number; snapX: number; snapY: number; snapActive: boolean };
  align: { x: number | null; y: number | null };
  ui: { expandedImageId: string | null; expandedElementId: string | null };
  spacePan: boolean;
}

/** Style plus identity, as copied when an element changes type. */
export type StyleCarrier = Partial<StyleProps> & {
  id?: string;
  name?: string;
  groups?: string[];
};

/** The serialized document written to storage. */
export interface ProjectFile {
  version: 2;
  artboard: EditorState["artboard"];
  grid: EditorState["grid"];
  images: ReferenceImage[];
  elements: SceneElement[];
  viewport: Viewport;
  tool: ToolName;
  finalOnly: boolean;
}
