import { tinyComposerDocx } from "./composerDocumentFixture.mjs";
import assert from "node:assert/strict";

/** 复用同一隔离桌面/模型端口，真实拖入、预览、优化、撤销与发送；不建立第二份载荷。 */
export async function checkComposerEnhancements({ page, model, reports }) {
  const side = page.locator('[data-workspace-side-frame][aria-hidden="false"]');
  const input = side.locator('[contenteditable="true"]:not(.cm-content)');
  await input.fill("请帮我整理这段话 ");
  await input.evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.setData("text/uri-list", "https://example.com");
    element.dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
  });
  await page.waitForFunction(() =>
    Array.from(
      document.querySelectorAll(
        '[data-workspace-side-frame][aria-hidden="false"] [contenteditable="true"]',
      ),
    ).some((element) => element.textContent.includes("https://example.com")),
  );
  assert.equal(await input.locator("[data-inline-attachment]").count(), 0);
  await input.press("End");
  await input.evaluate(
    (element, docx) => {
      const transfer = new DataTransfer();
      const bytes = Uint8Array.from(
        atob(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        ),
        (value) => value.charCodeAt(0),
      );
      transfer.items.add(new File([bytes], "picture.png", { type: "image/png" }));
      transfer.items.add(
        new File(["文档预览内容\n  keep indent"], "notes.txt", { type: "text/plain" }),
      );
      transfer.items.add(
        new File([Uint8Array.from(atob(docx), (value) => value.charCodeAt(0))], "sample.docx", {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
      );
      element.dispatchEvent(
        new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
    },
    await tinyComposerDocx(),
  );
  await side.locator("[data-inline-attachment]").nth(2).waitFor();
  assert.equal(await input.locator("[data-inline-attachment]").count(), 3);
  await side.locator("[data-inline-attachment]").first().getByRole("button").first().dblclick();
  await page.getByRole("dialog").locator("img").first().waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await side.locator("[data-inline-attachment]").nth(1).getByRole("button").first().dblclick();
  await page
    .getByTestId("composer-file-preview")
    .getByText(/文档预览内容/)
    .waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await side.locator("[data-inline-attachment]").nth(2).getByRole("button").first().dblclick();
  await page
    .getByRole("dialog")
    .getByText("DOCX preview content", { exact: false })
    .waitFor({ timeout: 30000 });
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const heightBefore = (await input.boundingBox()).height;
  const handle = side.getByTestId("composer-resize");
  await handle.click({ trial: true });
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 120, { steps: 8 });
  await page.mouse.up();
  assert.ok((await input.boundingBox()).height > heightBefore + 50);
  await handle.focus();
  await page.keyboard.press("ArrowUp");
  const optimized = side.getByTestId("composer-optimize");
  await optimized.click();
  await page.getByTestId("composer-optimize-result").waitFor();
  assert.equal(await input.locator("[data-inline-attachment]").count(), 3);
  await page.getByTestId("composer-optimize-apply").click();
  assert.match(await input.innerText(), /请清晰说明/);
  assert.equal(await input.locator("[data-inline-attachment]").count(), 3);
  await input.press("ControlOrMeta+z");
  assert.doesNotMatch(await input.innerText(), /请清晰说明/);
  assert.equal(await input.locator("[data-inline-attachment]").count(), 3);
  await optimized.click();
  await input.press("ControlOrMeta+End");
  await page.keyboard.type(" later edit");
  await page.getByTestId("composer-optimize-result").waitFor();
  await page.getByTestId("composer-optimize-apply").click();
  assert.match(await input.innerText(), /later edit/);
  assert.doesNotMatch(await input.innerText(), /请清晰说明/);
  const requests = model.requests.filter((request) =>
    JSON.stringify(request.messages).includes("你是谨慎的提示词文字编辑"),
  );
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.model, "ide-offline");
    assert.equal(request.tools?.length ?? 0, 0);
    const body = JSON.stringify(request.messages);
    assert.match(body, /不得猜测用户意图/);
    assert.match(body, /REFERENCE_0/);
    assert.doesNotMatch(body, /base64|iVBOR|文档预览内容|attachment:/);
  }
  const beforeCancel = model.requests.length;
  await optimized.click();
  const cancelRequest = await model.waitForRequest(
    (request) =>
      model.requests.indexOf(request) >= beforeCancel &&
      JSON.stringify(request.messages).includes("你是谨慎的提示词文字编辑"),
  );
  await optimized.click();
  const cancelled = await model.waitForResponseClosed(cancelRequest);
  assert.equal(cancelled.aborted, true, "取消必须到达真实 CLI 的模型 HTTP 请求");
  assert.equal(await page.getByTestId("composer-optimize-result").count(), 0);
  assert.equal(await input.locator("[data-inline-attachment]").count(), 3);
  // 发送前故障保留原始附件和正文，随后实际发送核对正文中的引用呈现。
  await page.evaluate(() => {
    window.__zcodeTransportDelayE2E = { commandMs: 0, ackMs: 0, rejectBeforeSend: true };
  });
  await input.press("Enter");
  await page.waitForFunction(() => window.__zcodeTransportDelayE2E?.consumed === true);
  assert.equal(await input.locator("[data-inline-attachment]").count(), 3);
  await page.evaluate(() => {
    delete window.__zcodeTransportDelayE2E;
  });
  await input.press("Enter");
  await side.locator("[data-sent-inline-attachment]").nth(2).waitFor({ timeout: 60000 });
  assert.equal(await input.locator("[data-inline-attachment]").count(), 0);
  // 缩略图异步读取完成后才有预览按钮；不能只等外层标签出现就双击空占位。
  await side.locator("[data-sent-inline-attachment]").first().getByRole("button").dblclick();
  await page.getByRole("dialog").locator("img").first().waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await side.locator("[data-sent-inline-attachment]").nth(1).getByRole("button").dblclick();
  await page
    .getByTestId("composer-file-preview")
    .getByText(/文档预览内容/)
    .waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await side.locator("[data-sent-inline-attachment]").nth(2).getByRole("button").dblclick();
  await page
    .getByRole("dialog")
    .getByText("DOCX preview content", { exact: false })
    .waitFor({ timeout: 30000 });
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.screenshot({ path: `${reports}/composer-passed.png` });
  console.log(
    "Composer E2E: inline files, previews, resize, optimization, undo and failed-send recovery passed",
  );
}
