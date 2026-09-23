import { describe, expect, test } from "bun:test";
import { findApp } from "@workbench/catalog";
import { SITE, appBase } from "@workbench/catalog/site";
import { THEME_BOOT_SCRIPT, THEME_KEY } from "./theme.js";
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

  test("the icon and manifest are addressed from the app's base, not from the page", () => {
    const tags = headTags(vellum);
    expect(attr(tags, "rel", "icon")?.attrs?.href).toBe(`${appBase("vellum")}icon.svg`);
    expect(attr(tags, "rel", "manifest")?.attrs?.href).toBe(
      `${appBase("vellum")}manifest.webmanifest`
    );
  });

  test("an unknown path is a 404, not the app served somewhere it does not live", () => {
    expect(workbenchApp("vellum").appType).toBe("mpa");
  });

  test("the index page has no manifest", () => {
    expect(attr(headTags(null), "rel", "manifest")).toBeUndefined();
  });

  test("every page applies a stored theme from the head, before it paints", () => {
    for (const tags of [headTags(vellum), headTags(null)]) {
      expect(tags.find((t) => t.tag === "script")?.children).toBe(THEME_BOOT_SCRIPT);
      expect(attr(tags, "name", "color-scheme")?.attrs?.content).toBe("dark light");
    }
    expect(THEME_BOOT_SCRIPT).toContain(JSON.stringify(THEME_KEY));
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

  test("the light tokens are the same whether the browser or a choice asked for them", async () => {
    const css = await Bun.file(new URL("../base.css", import.meta.url)).text();
    const block = (selector: string) => {
      const start = css.indexOf(`${selector} {`);
      const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
      return body
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
    };
    const light = block(':root[data-theme="light"]');
    expect(light.length).toBeGreaterThan(5);
    expect(block(':root:not([data-theme="dark"])')).toEqual(light);
  });
});
