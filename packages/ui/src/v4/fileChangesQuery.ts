import type { ConversationSnapshot } from "@zcode/shared/zcode-protocol-v4";
import type { ConversationStoreStatus } from "./conversationProjectionStore.js";

type Authority = Pick<ConversationSnapshot, "revision" | "logEpoch">;
interface RevisionStore {
  getState(): { status: ConversationStoreStatus; snapshot: Authority | null };
  subscribe(listener: () => void): () => void;
  recoverFromStaleAuthority(): void;
}

/** 查询与轮次终态投影可能交错；只在权威版本推进后重查一次，不用超时猜同步。 */
export async function queryFileChangesWithRecovery<T>(
  base: Authority,
  store: RevisionStore | null | undefined,
  query: (authority: Authority) => Promise<T>,
): Promise<T> {
  try {
    return await query(base);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "proto.staleRevision" || !store) throw error;
    const authority = await new Promise<Authority>((resolve, reject) => {
      let off = () => {};
      let settled = false;
      const inspect = () => {
        const state = store.getState();
        const next = state.snapshot;
        if (
          state.status === "closed" ||
          state.status === "error" ||
          (next && next.logEpoch !== base.logEpoch)
        ) {
          settled = true;
          off();
          reject(error);
        } else if (state.status === "live" && next && next.revision !== base.revision) {
          settled = true;
          off();
          resolve(next);
        }
      };
      off = store.subscribe(inspect);
      inspect();
      if (!settled) store.recoverFromStaleAuthority();
    });
    return query(authority);
  }
}
