import { readdir, readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { relative, resolve } from "node:path";

const nodeBuiltins = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

export function findExternalPreloadPackageRequires(source) {
  const packages = new Set();
  const pattern = /\brequire\s*\(\s*(["'])([^"']+)\1\s*\)/gu;

  for (const match of source.matchAll(pattern)) {
    const specifier = match[2];
    if (
      specifier === "electron" ||
      nodeBuiltins.has(specifier) ||
      specifier.startsWith(".") ||
      specifier.startsWith("/") ||
      /^[a-z]:[\\/]/iu.test(specifier)
    ) {
      continue;
    }

    packages.add(specifier);
  }

  return [...packages].sort();
}

export function assertNoExternalPreloadPackages(source, bundlePath = "preload bundle") {
  const packages = findExternalPreloadPackageRequires(source);
  if (packages.length > 0) {
    throw new Error(
      `[preload sandbox] ${bundlePath} leaves npm packages external: ${packages.join(", ")}`,
    );
  }
}

async function collectPreloadBundles(directory) {
  const bundles = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      bundles.push(...(await collectPreloadBundles(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith(".cjs")) {
      bundles.push(entryPath);
    }
  }
  return bundles;
}

export async function assertDesktopPreloadBundlesAreSelfContained({ desktopRoot }) {
  const preloadDirectory = resolve(desktopRoot, "out", "preload");
  const bundles = await collectPreloadBundles(preloadDirectory);
  if (bundles.length === 0) {
    throw new Error(`[preload sandbox] no CJS bundles found under ${preloadDirectory}`);
  }

  for (const bundlePath of bundles) {
    const source = await readFile(bundlePath, "utf8");
    assertNoExternalPreloadPackages(source, relative(desktopRoot, bundlePath));
  }

  return { checkedBundles: bundles.length };
}
