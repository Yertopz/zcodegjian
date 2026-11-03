import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile, access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, join } from "node:path";

export async function prepareServerRdp() {
  if (process.platform !== "win32") return;
  const root = resolve(import.meta.dirname, "..");
  const source = join(root, "native/server-rdp/ServerRdp.cs");
  const hash = createHash("sha256")
    .update(await readFile(source))
    .digest("hex")
    .slice(0, 16);
  // Dev 工作区可能继承 Low 完整性标签，helper 必须在普通用户自己的 Medium 目录生成。
  const cache = join(process.env.LOCALAPPDATA, "ZCode-CE", "server-rdp", hash);
  const executable = join(cache, "ZCode.ServerRdp.exe");
  await mkdir(cache, { recursive: true });
  if (
    !(await access(executable).then(
      () => true,
      () => false,
    ))
  ) {
    const compiler = join(process.env.SystemRoot, "Microsoft.NET/Framework64/v4.0.30319/csc.exe");
    await promisify(execFile)(
      compiler,
      [
        "/nologo",
        "/target:exe",
        "/platform:anycpu",
        `/out:${executable}`,
        "/reference:System.Windows.Forms.dll",
        "/reference:System.Drawing.dll",
        "/reference:System.Web.Extensions.dll",
        "/reference:Microsoft.CSharp.dll",
        source,
      ],
      { windowsHide: true },
    );
  }
  const result = await promisify(execFile)(executable, ["--probe"], { windowsHide: true });
  if (!JSON.parse(result.stdout).available) throw new Error("Windows RDP ActiveX is unavailable");
  const resources = join(root, "resources/server-rdp");
  await mkdir(resources, { recursive: true });
  await writeFile(join(resources, "ZCode.ServerRdp.exe"), await readFile(executable));
  await writeFile(join(resources, "manifest.json"), JSON.stringify({ hash }));
  return executable;
}
if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  await prepareServerRdp();
}
