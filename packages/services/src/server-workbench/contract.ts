import type { Event } from "@zcode/rpc";
import {
  ServiceChannels,
  type ServerWorkbenchSnapshot,
  type ServerWorkbenchRequest,
  type ServerWorkbenchResult,
} from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

/** 窗口 Local Host 是服务器运行事实和一次性批准的唯一所有者；远端 workspace 不注册此服务。 */
export interface IServerWorkbenchService {
  snapshot(): Promise<ServerWorkbenchSnapshot>;
  perform(request: ServerWorkbenchRequest): Promise<ServerWorkbenchResult>;
  readonly onDidChange: Event<ServerWorkbenchSnapshot>;
  readonly onTerminalData: Event<import("@zcode/shared").ServerTerminalData>;
}
export const IServerWorkbenchService = createServiceDescriptor<IServerWorkbenchService>(
  ServiceChannels.ServerWorkbench,
);
