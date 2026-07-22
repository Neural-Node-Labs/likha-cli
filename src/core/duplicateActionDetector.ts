export interface ToolCallRecord {
  tool: string;
  args: unknown;
  observation: unknown;
}

export interface DuplicateActionViolation {
  tool: string;
  args: unknown;
  occurrences: number;
  reason: string;
}

/**
 * Flags a duplicate action ONLY when the exact same (tool, arguments) pair was called more
 * than once AND produced the exact same observation every time -- i.e. genuinely no new
 * information was gained by repeating it. This deliberately does NOT flag legitimate re-runs
 * (e.g. running the same test command again after an edit, which is expected and correct ReAct
 * behavior) because those produce a *different* observation once the underlying state changed.
 */
export function findDuplicateActions(calls: ToolCallRecord[]): DuplicateActionViolation[] {
  const groups = new Map<string, ToolCallRecord[]>();

  for (const call of calls) {
    const key = `${call.tool}::${stableStringify(call.args)}`;
    const list = groups.get(key) ?? [];
    list.push(call);
    groups.set(key, list);
  }

  const violations: DuplicateActionViolation[] = [];
  for (const [, group] of groups) {
    if (group.length < 2) continue;
    const observationStrings = group.map((c) => stableStringify(c.observation));
    const allIdentical = observationStrings.every((o) => o === observationStrings[0]);
    if (allIdentical) {
      violations.push({
        tool: group[0].tool,
        args: group[0].args,
        occurrences: group.length,
        reason: `Called ${group.length} times with identical arguments AND an identical observation every time -- no new information was gained by repeating it; the agent should have recognized this from its own message history instead of retrying blind.`,
      });
    }
  }
  return violations;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",")}}`;
}


