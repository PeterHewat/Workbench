# ADR-001: Apps are static and framework-free

**Status:** Accepted

## Context

Workbench holds several unrelated small tools rather than one product. They are used
occasionally, over years, by one person and whoever finds them. The original Vellum was plain
ES modules with no build and no dependencies, which is why it ran off any file server.

TypeScript is wanted for the editing experience and for catching mistakes in geometry code.
TypeScript needs a build.

## Decision

Each app is TypeScript compiled by **Vite** into plain static files, with **no runtime framework
and no runtime dependencies**.

Vite is a build tool, not a foundation. The deployed output is HTML, CSS and ES modules; nothing
in it knows Vite existed. An app can be opened from any static host, and would still run if the
toolchain vanished.

## Consequences

- No React/Svelte/Vue in an app. UI is built with the DOM directly.
- A dependency is acceptable in `devDependencies`; in the shipped bundle it needs a real reason.
- Shared code goes in `packages/`, not into a runtime library an app links against at runtime.
- Apps stay small enough to read, which is the point of the collection.
