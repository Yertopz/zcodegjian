import assert from "node:assert/strict";
import test from "node:test";
import {
  BrowserProxyConfigError,
  buildBrowserInstanceProxyConfig,
} from "../src/main/browserConsole/browserProxyConfig.js";

test("inherit follows the global proxy and falls back to the system proxy", () => {
  assert.deepEqual(buildBrowserInstanceProxyConfig({ mode: "inherit" }, {}), {
    mode: "system",
  });
  assert.deepEqual(
    buildBrowserInstanceProxyConfig(
      { mode: "inherit" },
      { httpProxy: "127.0.0.1:7890", httpProxyNoProxy: "localhost, 127.0.0.1" },
    ),
    {
      mode: "fixed_servers",
      proxyRules: "http://127.0.0.1:7890",
      proxyBypassRules: "localhost,127.0.0.1",
    },
  );
});

test("direct and system map to Electron modes", () => {
  assert.deepEqual(buildBrowserInstanceProxyConfig({ mode: "direct" }, {}), {
    mode: "direct",
  });
  assert.deepEqual(buildBrowserInstanceProxyConfig({ mode: "system" }, {}), {
    mode: "system",
  });
});

test("fixed proxy keeps protocol, port and bypass rules", () => {
  assert.deepEqual(
    buildBrowserInstanceProxyConfig(
      {
        mode: "fixed",
        protocol: "socks5",
        host: "10.0.0.8",
        port: 1080,
        bypassRules: ["localhost", "*.internal"],
      },
      {},
    ),
    {
      mode: "fixed_servers",
      proxyRules: "socks5://10.0.0.8:1080",
      proxyBypassRules: "localhost,*.internal",
    },
  );
});

test("invalid fixed endpoints fail instead of silently falling back to direct", () => {
  assert.throws(
    () =>
      buildBrowserInstanceProxyConfig(
        {
          mode: "fixed",
          protocol: "http",
          host: "bad host",
          port: 8080,
        },
        {},
      ),
    (error: unknown) => error instanceof BrowserProxyConfigError,
  );
});
