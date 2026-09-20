import { describe, expect, it } from "bun:test";
import { createInitialState, replaceState, snapshotForUndo, getState } from "./state.js";
import type { ReferenceImage } from "./types.js";

function image(dataUrl: string): ReferenceImage {
  return {
    id: "img-1",
    name: "ref.png",
    fileName: "ref.png",
    dataUrl,
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity: 0.5,
    visible: true,
  };
}

describe("snapshotForUndo", () => {
  it("shares the image data URL rather than copying it", () => {
    const dataUrl = `data:image/png;base64,${"A".repeat(1024)}`;
    replaceState({ ...createInitialState(), images: [image(dataUrl)] });

    const snap = snapshotForUndo();

    // Same string object, so a hundred undo steps cost one copy of the pixels, not a hundred.
    expect(snap.images[0]!.dataUrl).toBe(dataUrl);
  });

  it("still copies the image transform, so undo can restore it", () => {
    replaceState({ ...createInitialState(), images: [image("data:,")] });
    const snap = snapshotForUndo();

    getState().images[0]!.x = 250;

    expect(snap.images[0]!.x).toBe(0);
    expect(snap.images[0]!.opacity).toBe(0.5);
  });

  it("deep-copies elements, so a later mutation cannot reach into the snapshot", () => {
    replaceState({
      ...createInitialState(),
      elements: [
        {
          type: "polyline",
          id: "a1b2c3d4",
          name: "polyline 1",
          points: [{ x: 1, y: 2 }],
          stroke: "#000000",
          strokeOpacity: 1,
          strokeWidth: 2,
          linecap: "round",
          linejoin: "round",
          fillEnabled: false,
          fillType: "solid",
          fill: "#000000",
          fillOpacity: 1,
          gradStops: [
            { offset: 0, color: "#000000", opacity: 1 },
            { offset: 1, color: "#ffffff", opacity: 1 },
          ],
          gradFrom: { x: 0, y: 0.5 },
          gradTo: { x: 1, y: 0.5 },
          markerStart: "none",
          markerEnd: "none",
        },
      ],
    });

    const snap = snapshotForUndo();
    const live = getState().elements[0]!;
    if ("points" in live) live.points[0]!.x = 99;

    const snapped = snap.elements[0]!;
    expect("points" in snapped && snapped.points[0]!.x).toBe(1);
  });
});
