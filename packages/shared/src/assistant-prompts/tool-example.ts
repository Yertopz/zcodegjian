/**
 * 示例参数只维护一份对象；序列化后的正文也是契约测试的输入，避免说明与被测样例分叉。
 * Tool/Arguments 是提示词文档格式，不是执行入口或额外权限。
 */
export function toolExample(name: string, input: Record<string, unknown>): string {
  return `Tool: ${name}\nArguments: ${JSON.stringify(input)}`;
}
