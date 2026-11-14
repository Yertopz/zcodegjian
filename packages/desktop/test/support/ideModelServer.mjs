import { createServer } from "node:http";

/** 只在隔离 E2E 中使用：真实 CLI/工具/文件服务，模型响应由本机端口确定。 */
export async function startIdeModelServer() {
  const requests = [];
  const responseClosed = new WeakMap();
  const listeners = new Set();
  let filePath = "";
  let toolStep = 0;
  const server = createServer(async (req, res) => {
    if (req.method !== "POST") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ object: "list", data: [{ id: "ide-offline", object: "model" }] }));
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    requests.push(request);
    responseClosed.set(
      request,
      new Promise((resolve) =>
        res.once("close", () => resolve({ aborted: !res.writableFinished })),
      ),
    );
    for (const listener of listeners) listener(request);
    const optimization = JSON.stringify(request.messages).includes("你是谨慎的提示词文字编辑");
    // 标题生成也使用模型端口，但没有编码工具，不应消耗主轮次的工具夹具。
    const modify =
      JSON.stringify(request.messages).includes("IDE_E2E_MODIFY") &&
      request.tools?.some((tool) => tool.function?.name === "Read");
    const linkedPath = filePath.replaceAll("\\", "/").replace(/sample\.ts$/, "nested/linked.ts");
    let message = {
      role: "assistant",
      content: `IDE_E2E_DONE [sample.ts](<${filePath.replaceAll("\\", "/")}:1>) [linked.ts](<${linkedPath}:1>)`,
    };
    if (optimization) {
      // 模拟模型延迟，实际验证生成期间编辑草稿不会被迟到结果覆盖。
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (res.destroyed) return;
      const source = request.messages.findLast((item) => item.role === "user")?.content ?? "";
      message.content = `请清晰说明：${typeof source === "string" ? source : source.map((part) => part.text ?? "").join("")}`;
    }
    if (modify && toolStep < 2) {
      const name = toolStep === 0 ? "Read" : "Edit";
      const args =
        toolStep === 0
          ? { file_path: filePath }
          : { file_path: filePath, old_string: "external version", new_string: "agent version" };
      message = {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: `ide-call-${toolStep++}`,
            type: "function",
            function: { name, arguments: JSON.stringify(args) },
          },
        ],
      };
    }
    const finishReason = message.tool_calls ? "tool_calls" : "stop";
    if (request.stream) {
      res.setHeader("Content-Type", "text/event-stream");
      const delta = message.tool_calls
        ? {
            role: "assistant",
            tool_calls: message.tool_calls.map((tool, index) => ({ index, ...tool })),
          }
        : message;
      for (const choice of [
        { delta, finish_reason: null },
        { delta: {}, finish_reason: finishReason },
      ]) {
        res.write(
          `data: ${JSON.stringify({ id: "ide-fixture", object: "chat.completion.chunk", created: 1, model: "ide-offline", choices: [{ index: 0, ...choice }] })}\n\n`,
        );
      }
      res.end("data: [DONE]\n\n");
    } else {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          id: "ide-fixture",
          object: "chat.completion",
          created: 1,
          model: "ide-offline",
          choices: [{ index: 0, message, finish_reason: finishReason }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      );
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    requests,
    waitForRequest(predicate) {
      const existing = requests.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          listeners.delete(listener);
          reject(new Error("Model request timeout"));
        }, 30000);
        const listener = (request) => {
          if (predicate(request)) {
            clearTimeout(timer);
            listeners.delete(listener);
            resolve(request);
          }
        };
        listeners.add(listener);
      });
    },
    waitForResponseClosed(request) {
      return responseClosed.get(request);
    },
    url: `http://127.0.0.1:${server.address().port}/v1`,
    setFile(path) {
      filePath = path;
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
