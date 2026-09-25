import { AGENT_TOOL_POLICIES, AGENT_TOOLS, autonomyAtLeast, type AgentTool } from '@nexus/shared';
import type { AiActor } from '../../context.js';
import type { ComputerCapabilities } from '../computer/computer-provider.js';

export type GuardDecision =
  | { decision: 'allow'; risk: 'low' | 'medium' | 'high' }
  | { decision: 'needs_approval'; risk: 'low' | 'medium' | 'high'; reason: string }
  | { decision: 'deny'; risk: 'low' | 'medium' | 'high'; reason: string };

/**
 * Deterministic policy gate between the model's requested action and execution:
 *   known tool → permission → computer capability → autonomy/risk → (approval)
 * The model can never bypass this: it only proposes; this code decides.
 */
export function evaluateToolCall(
  ai: Pick<AiActor, 'permissions' | 'autonomy'>,
  tool: string,
  caps: ComputerCapabilities,
  opts: { preApproved?: boolean } = {},
): GuardDecision {
  if (!(AGENT_TOOLS as readonly string[]).includes(tool)) return { decision: 'deny', risk: 'high', reason: 'unknown_tool' };
  const policy = AGENT_TOOL_POLICIES[tool as AgentTool];
  if (policy.permission && !ai.permissions.has(policy.permission)) {
    return { decision: 'deny', risk: policy.risk, reason: `missing_permission:${policy.permission}` };
  }
  if (policy.requiresComputer) {
    const cap = tool === 'browser_action' ? caps.browser : caps.terminal;
    if (!cap) return { decision: 'deny', risk: policy.risk, reason: 'computer_capability_unavailable' };
  }
  if (opts.preApproved) return { decision: 'allow', risk: policy.risk };
  if (policy.autoApproveFrom === null || !autonomyAtLeast(ai.autonomy, policy.autoApproveFrom)) {
    return { decision: 'needs_approval', risk: policy.risk, reason: `autonomy_${ai.autonomy}_requires_approval` };
  }
  return { decision: 'allow', risk: policy.risk };
}

/** Redacts obviously sensitive-looking values before persisting tool inputs to logs. */
export function redactForLog(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === null || v === undefined) continue;
    if (/key|secret|token|password/i.test(k)) {
      out[k] = '[redacted]';
    } else if (typeof v === 'string' && v.length > 300) {
      out[k] = `${v.slice(0, 300)}… (${v.length} chars)`;
    } else {
      out[k] = v;
    }
  }
  return out;
}
