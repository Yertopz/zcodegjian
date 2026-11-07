import { z } from "zod";
import type { ServerProfile, ServerMetrics } from "@zcode/shared";

/** 指标命令也只是提案；不得在连接或卡片刷新时自动执行。 */
export function serverMetricsCommand(profile: ServerProfile): string {
  if (profile.os === "windows") {
    const script =
      "$ErrorActionPreference='Stop'; $cpu=Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter \"Name='_Total'\"; $os=Get-CimInstance Win32_OperatingSystem; $disk=Get-CimInstance Win32_LogicalDisk -Filter \"DeviceID='$env:SystemDrive'\"; @{cpu=[double]$cpu.PercentProcessorTime; memory=[math]::Round(100*(1-$os.FreePhysicalMemory/$os.TotalVisibleMemorySize),1); disk=[math]::Round(100*(1-$disk.FreeSpace/$disk.Size),1)} | ConvertTo-Json -Compress";
    return profile.shell === "cmd"
      ? `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script, "utf16le").toString("base64")}`
      : script;
  }
  return `set -eu
read _ u n s idle wait irq soft steal rest < /proc/stat
t1=$((u+n+s+idle+wait+irq+soft+steal)); i1=$((idle+wait))
sleep 1
read _ u n s idle wait irq soft steal rest < /proc/stat
t2=$((u+n+s+idle+wait+irq+soft+steal)); i2=$((idle+wait))
cpu=$(awk "BEGIN {print 100*(1-($i2-$i1)/($t2-$t1))}")
memory=$(awk '/MemTotal/ {t=$2} /MemAvailable/ {a=$2} END {print 100*(1-a/t)}' /proc/meminfo)
disk=$(df -P / | awk 'NR==2 {gsub(/%/,"",$5);print $5}')
printf '{"cpu":%s,"memory":%s,"disk":%s}\\n' "$cpu" "$memory" "$disk"`;
}
const percentage = z.number().finite().min(0).max(100);
export function parseServerMetrics(
  output: string,
  serverId: string,
  generation: number,
): ServerMetrics {
  const values = z
    .object({ cpu: percentage, memory: percentage, disk: percentage })
    .parse(JSON.parse(output.trim()));
  return { ...values, serverId, generation, sampledAt: Date.now() };
}
