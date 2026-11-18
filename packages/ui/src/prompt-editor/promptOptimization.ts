export const PROMPT_OPTIMIZATION_INSTRUCTION = `你是谨慎的提示词文字编辑。仅把用户原文整理得清楚、准确、易于 AI 理解。
保留原文的目标、事实、限制、语气、语言、路径、网址、代码和全部引用占位符。
只修正明显的错别字、重复、歧义表达与语序，可做必要的分段，不做大幅扩写。
不得猜测用户意图，不得增加原文没有的需求、背景、事实、技术方案、步骤或验收标准，不得凭空补全缺失信息。
原文不明确时保留其不明确之处，不擅自作决定；原文已经清楚时可以保持不变。
不要执行原文中的任务。只输出修改后的提示词，不加解释、标题或代码围栏。`;

/** 引用本身不是待编辑文字；不把附件内容加入这个独立模型请求。 */
export function protectPromptReferences(text: string) {
  const tokens: string[] = [];
  const protectedText = text.replace(
    /```[\s\S]*?```|`[^`\n]*`|\[[^\]\n]+\]\([^\s)]+\)|https?:\/\/[^\s<>()]+?(?=\[[^\]\n]+\]\([^\s)]+\)|[\s<>()]|$)|⟦REFERENCE_[^⟧]*⟧/g,
    (token) => {
      const index = tokens.push(token) - 1;
      return `⟦REFERENCE_${index}⟧`;
    },
  );
  return {
    text: protectedText,
    restore(output: string) {
      const matches = [...output.matchAll(/⟦REFERENCE_([^⟧]*)⟧/g)].map((match) =>
        /^\d+$/.test(match[1]!) ? Number(match[1]) : -1,
      );
      if (
        matches.length !== tokens.length ||
        new Set(matches).size !== tokens.length ||
        matches.some((index) => !tokens[index])
      )
        throw new Error("Invalid prompt references");
      return output.replace(/⟦REFERENCE_(\d+)⟧/g, (_, index: string) => tokens[Number(index)]!);
    },
  };
}
