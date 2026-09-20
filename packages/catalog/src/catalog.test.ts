import { describe, expect, test } from "bun:test";
import { APPS, findApp, listedApps } from "./index.js";
import { appBase, siteBase } from "./site.js";

describe("catalog", () => {
  test("slugs are unique", () => {
    const slugs = APPS.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test("slugs are URL- and folder-safe", () => {
    for (const app of APPS) expect(app.slug).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  test("every app has the copy the index page needs", () => {
    for (const app of APPS) {
      expect(app.name.length).toBeGreaterThan(0);
      expect(app.blurb.length).toBeGreaterThan(0);
      expect(app.icon.length).toBeGreaterThan(0);
    }
  });

  test("findApp resolves by slug", () => {
    expect(findApp("vellum")?.name).toBe("Vellum");
    expect(findApp("nope")).toBeUndefined();
  });

  test("listedApps is a subset of APPS", () => {
    expect(listedApps().every((a) => APPS.includes(a))).toBe(true);
  });
});

describe("deploy paths", () => {
  test("the default is the project-site path", () => {
    expect(siteBase({})).toBe("/Workbench/");
  });

  test("a custom base is honoured and normalised", () => {
    expect(siteBase({ WORKBENCH_BASE: "/" })).toBe("/");
    expect(siteBase({ WORKBENCH_BASE: "/thing" })).toBe("/thing/");
    expect(siteBase({ WORKBENCH_BASE: "thing/" })).toBe("/thing/");
  });

  test("an app sits under the site base", () => {
    expect(appBase("vellum", {})).toBe("/Workbench/vellum/");
    expect(appBase("vellum", { WORKBENCH_BASE: "/" })).toBe("/vellum/");
  });

  test("the Pages action's empty base_path resolves to the site root", () => {
    // `configure-pages` emits "" behind a custom domain; the workflow appends "/".
    expect(siteBase({ WORKBENCH_BASE: "/" })).toBe("/");
  });
});
