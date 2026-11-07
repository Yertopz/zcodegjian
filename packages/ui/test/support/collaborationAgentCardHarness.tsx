import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { AgentSummary } from "@zcode/shared";
import { AgentListRow } from "../../src/settings/SubagentsSection.js";

const agent = {
  id: "reviewer",
  name: "reviewer",
  description: "Review code",
  path: "fixture",
  scope: "user",
  source: "user",
  enabled: true,
  tools: [],
} as AgentSummary;

function Harness() {
  const [actions, setActions] = useState<string[]>([]);
  const record = (action: string) => setActions((previous) => [...previous, action]);
  return (
    <main className="mx-auto w-full max-w-sm p-4">
      <AgentListRow
        agent={agent}
        isOperating={false}
        modelGroups={[]}
        modelSelectionLoading={false}
        modelSelectGroups={[]}
        onModelOverrideChange={async () => {}}
        onDelete={() => record("delete")}
        onEdit={() => record("edit")}
        onToggle={() => record("toggle")}
      />
      <output data-testid="actions">{actions.join(",")}</output>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);
