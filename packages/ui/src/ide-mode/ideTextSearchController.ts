import { nanoid } from "nanoid/non-secure";
import type {
  IFileService,
  WorkspaceTextSearchResult,
  WorkspaceTextSearchTarget,
} from "@zcode/services";

export interface IdeTextSearchState {
  busy: boolean;
  query: string;
  result: WorkspaceTextSearchResult | null;
  error: "failed" | "cancelFailed" | null;
}
const emptyState: IdeTextSearchState = { busy: false, query: "", result: null, error: null };

/** 每个作用域/服务连接一个控制器；React 只订阅快照，不另建一份已接受搜索状态。 */
export function createIdeTextSearchController(
  service: Pick<IFileService, "searchWorkspaceText" | "cancelWorkspaceTextSearch">,
  target: Omit<WorkspaceTextSearchTarget, "requestId">,
) {
  const fixedTarget = { ...target };
  let state = emptyState;
  let sequence = 0;
  let active: WorkspaceTextSearchTarget | null = null;
  const listeners = new Set<() => void>();
  function publish(next: IdeTextSearchState) {
    state = next;
    listeners.forEach((listener) => listener());
  }
  function stop(notifyFailure: boolean) {
    const generation = ++sequence;
    const previous = active;
    active = null;
    if (previous)
      void Promise.resolve()
        .then(() => service.cancelWorkspaceTextSearch(previous))
        .catch(() => {
          if (notifyFailure && sequence === generation)
            publish({ ...emptyState, error: "cancelFailed" });
        });
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    search(query: string, caseSensitive: boolean) {
      stop(false);
      const generation = ++sequence;
      if (!query) {
        publish(emptyState);
        return;
      }
      const request = { ...fixedTarget, requestId: `ide-search-${nanoid()}` };
      active = request;
      publish({ busy: true, query, result: null, error: null });
      // 先固定作用域与请求快照；回包只认序号，连接/工作区释放后不能恢复旧结果。
      void Promise.resolve()
        .then(() => {
          if (sequence !== generation) return null;
          return service.searchWorkspaceText({ ...request, query, caseSensitive });
        })
        .then((result) => {
          if (!result || sequence !== generation) return;
          active = null;
          publish(result.cancelled ? emptyState : { busy: false, query, result, error: null });
        })
        .catch(() => {
          if (sequence !== generation) return;
          active = null;
          publish({ busy: false, query, result: null, error: "failed" });
        });
    },
    cancel() {
      stop(true);
      publish(emptyState);
    },
    dispose() {
      stop(false);
    },
  };
}
