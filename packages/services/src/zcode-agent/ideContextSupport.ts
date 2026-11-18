import { zcodeProtocolMethods, zcodeRuntimeCapabilitiesSchema } from "@zcode/shared";
import type { ZCodeProtocolClient } from "./zcodeProtocolClient.js";

const checks = new WeakMap<object, Promise<void>>();
/** Host 与 CLI 分别升级；发送前验证实际执行端，禁止旧 CLI 静默剥离 IDE 限制。 */
export function ensureIdeContextSupport(
  client: Pick<ZCodeProtocolClient, "request">,
): Promise<void> {
  const cached = checks.get(client);
  if (cached) return cached;
  const check = client
    .request(zcodeProtocolMethods.runtimeCapabilities, {}, zcodeRuntimeCapabilitiesSchema)
    .then((result) => {
      if (result.ideContextV1 !== true) throw new Error("proto.ideContextUnsupported");
    })
    .catch((cause: unknown) => {
      checks.delete(client);
      throw new Error("proto.ideContextUnsupported", { cause });
    });
  checks.set(client, check);
  return check;
}
