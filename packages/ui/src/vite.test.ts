import { describe, expect, test } from "bun:test";
import { findApp } from "@workbench/catalog";
import { SITE } from "@workbench/catalog/site";
import { headTags, manifestFor, workbenchApp } from "./vite.js";

const vellum = findApp("vellum")!;

describe("workbenchApp", () => {
  test("refuses an app the catalog does not list", () => {
    expect(() => workbenchApp("not-an-app")).toThrow(/not in packages\/catalog/);
  });

  test("builds into the app's folder under the site", () => {
    const config = workbenchApp("vellum");
    expect(config.build?.outDir).toBe("../../dist/vellum");
    expect(config.base).toEndWith("/vellum/");
  });
});

describe("page head", () => {
  const attr = (tags: ReturnType<typeof headTags>, key: string, value: string) =>
    tags.find((t) => t.attrs?.[key] === value);

  test("an app's title and description come from the catalog", () => {
    const tags = headTags(vellum);
    expect(tags.find((t) => t.tag === "title")?.children).toBe("Vellum — Workbench");
    expect(attr(tags, "name", "description")?.attrs?.content).toBe(vellum.description!);
    expect(attr(tags, "rel", "manifest")).toBeDefined();
  });

  test("the index page has no manifest", () => {
    expect(attr(headTags(null), "rel", "manifest")).toBeUndefined();
  });
});

describe("manifest", () => {
  test("names the app and stays inside its folder", () => {
    const m = manifestFor(vellum);
    expect(m.name).toBe("Vellum");
    expect(m.start_url).toBe(".");
    expect(m.scope).toBe(".");
  });
});

describe("base.css", () => {
  test("the page background is the theme colour the head and manifest announce", async () => {
    const css = await Bun.file(new URL("../base.css", import.meta.url)).text();
    expect(css).toContain(`--bg: ${SITE.themeColor};`);
  });
});
