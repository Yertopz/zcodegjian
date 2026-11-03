# Desktop Preload Sandbox Bundling

## Problem

Electron runs the desktop preload in a restricted sandbox. The emitted preload can use Electron's preload API and supported Node built-ins, but it cannot resolve arbitrary npm packages at runtime. The Desktop preload bundle previously inlined `@zcode/shared` while leaving its transitive `zod` import external. On Windows, Electron reported `module not found: zod`; the preload failed before exposing the bridge, and the renderer then failed during startup with an empty root element.

## Behavior

- The preload build bundles every npm package it imports; `electron` remains an external module because Electron supplies the preload API.
- Node built-ins and relative chunks are not npm package dependencies and may remain external when the sandbox supports them.
- Main and Host dependency policies stay independent from the preload policy.
- Keep Electron context isolation and sandboxing enabled. Do not work around a missing bundle by disabling the sandbox.
- The production build checks emitted preload bundles and fails when a bare npm package require remains.

## Owner and consumer

The Desktop build configuration owns preload dependency bundling. Electron's sandboxed `webContents` preload is the final consumer of `out/preload/*.cjs` inside `resources/app.asar`.

## Acceptance scenarios

- A preload bundle may require `electron`, supported Node built-ins, and relative chunks without the dependency guard failing.
- A preload bundle containing a bare package require such as `require("zod")` fails the guard with the file and package named.
- The production build emits the main preload without external `zod`, and the installed app exposes its preload bridge so the renderer root mounts without startup exceptions.
