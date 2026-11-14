/** 独立文本生成的在途取消句柄；不持有会话、聊天输入或已接受队列。 */
export class WorkspaceTextRequests {
  private readonly requests = new Map<
    string,
    { workspaceKey: string; controller: AbortController }
  >();

  begin(
    workspaceKey: string,
    operationId: string,
    externalSignal?: AbortSignal,
  ): { signal: AbortSignal; dispose: () => void } {
    if (!operationId.trim() || operationId.length > 128 || this.requests.has(operationId))
      throw new Error("Invalid or duplicate text operation ID");
    if (externalSignal && typeof externalSignal.addEventListener !== "function")
      throw new Error("AbortSignal is in-process only; use operationId across RPC");
    const controller = new AbortController();
    const abort = () => controller.abort();
    externalSignal?.addEventListener("abort", abort, { once: true });
    if (externalSignal?.aborted) abort();
    this.requests.set(operationId, { workspaceKey, controller });
    return {
      signal: controller.signal,
      dispose: () => {
        externalSignal?.removeEventListener("abort", abort);
        this.requests.delete(operationId);
      },
    };
  }

  cancel(workspaceKey: string, operationId: string): boolean {
    const request = this.requests.get(operationId);
    if (!request || request.workspaceKey !== workspaceKey) return false;
    request.controller.abort();
    return true;
  }
}
