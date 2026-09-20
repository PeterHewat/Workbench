import { describe, expect, test } from "bun:test";
import { cardHtml, escapeHtml, pageHtml } from "./render.js";
import type { WorkbenchApp } from "@workbench/catalog";

const app: WorkbenchApp = {
  slug: "demo",
  name: "Demo",
  blurb: "Does a thing.",
  icon: "M0 0h24v24H0z",
  tags: ["one", "two"],
  status: "beta",
  listed: true,
};

describe("escaping", () => {
  test("markup in catalog copy cannot break out into the page", () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"
    );
  });

  test("a name with markup is escaped in its card", () => {
    const html = cardHtml({ ...app, name: "<b>x</b>" }, "/");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>x</b>");
  });
});

describe("cards", () => {
  test("the link is the app's folder under the site base", () => {
    expect(cardHtml(app, "/Workbench/")).toContain('href="/Workbench/demo/"');
    expect(cardHtml(app, "/")).toContain('href="/demo/"');
  });

  test("a non-stable status is badged", () => {
    expect(cardHtml(app, "/")).toContain('class="status status--beta"');
  });

  test("a stable app gets no badge", () => {
    expect(cardHtml({ ...app, status: "stable" }, "/")).not.toContain('class="status');
  });

  test("tags are listed", () => {
    const html = cardHtml(app, "/");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<li>two</li>");
  });
});

describe("page", () => {
  test("every app gets a card", () => {
    const html = pageHtml([app, { ...app, slug: "other", name: "Other" }], "/");
    expect(html.match(/class="card"/g)).toHaveLength(2);
  });

  test("an empty catalog says so instead of rendering an empty grid", () => {
    const html = pageHtml([], "/");
    expect(html).toContain("Nothing here yet.");
    expect(html).not.toContain('class="grid"');
  });
});
