/**
 * 代理可达性探针：登录写盘前先确认代理端口真的有人监听。
 *
 * 为什么需要：登录本身只写配置、不发模型请求，所以过去一个打错的端口
 * （实测把 7897 写成 7896）会「登录成功」，直到第一次聊天才以连接超时暴露，
 * 而错误信息里看不出问题出在代理上。
 *
 * 边界：只做一次 TCP 连接，不做 SOCKS5 / HTTP 协商 —— 探针的职责是抓
 * 「代理没启动 / 端口写错」，不是验证代理协议或鉴权是否正确。
 */
import { connect } from "node:net";

export const DEFAULT_PROXY_PROBE_TIMEOUT_MS = 3000;

/** 探针只需要地址三要素，避免为此依赖完整的代理配置对象。 */
export interface ProxyProbeTarget {
  readonly type: string;
  readonly host: string;
  readonly port: number;
}

export interface ProxyProbeOptions {
  readonly timeoutMs?: number;
}

/** 连不上就抛错（信息里带协议、主机、端口与原因）；连得上静默返回。 */
export async function probeProxyReachability(
  target: ProxyProbeTarget,
  options: ProxyProbeOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROXY_PROBE_TIMEOUT_MS;
  const display = `${target.type}://${target.host}:${target.port}`;
  try {
    await connectOnce(target.host, target.port, timeoutMs);
  } catch (error) {
    throw new Error(
      `代理无法连接：${display}（${describeProbeFailure(error, timeoutMs)}；请确认代理已启动、端口填写正确）`,
    );
  }
}

function connectOnce(host: string, port: number, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const socket = connect({ host, port });
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    socket.setTimeout(timeoutMs, () => {
      finish(new Error(`连接超时 ${timeoutMs}ms`));
    });
    socket.once("connect", () => {
      finish();
    });
    socket.once("error", (error: Error) => {
      finish(error);
    });
  });
}

function describeProbeFailure(error: unknown, timeoutMs: number): string {
  if (!(error instanceof Error)) return `连接失败（超时上限 ${timeoutMs}ms）`;
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ECONNREFUSED") return "拒绝连接，该端口没有监听";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return `主机名无法解析：${error.message}`;
  if (code === "ECONNRESET") return "连接被重置";
  return error.message || `连接失败（超时上限 ${timeoutMs}ms）`;
}
