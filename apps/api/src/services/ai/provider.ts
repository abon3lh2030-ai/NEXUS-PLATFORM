import type { ZodType } from 'zod';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIUsage {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export interface GenerateRequest {
  system: string;
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
}

export interface StructuredRequest<T> extends GenerateRequest {
  schema: ZodType<T>;
  /** Stable name used for logging and by the mock provider to pick a fixture. */
  schemaName: string;
}

export interface TextResult {
  text: string;
  usage: AIUsage;
}

export interface StructuredResult<T> {
  data: T;
  usage: AIUsage;
}

/**
 * Provider-agnostic interface. Business logic (agents, Nexus AI, meetings…) depends only on
 * this, never on a vendor SDK.
 */
export interface AIProvider {
  readonly name: string;
  readonly defaultModel: string;
  readonly isMock: boolean;
  generateText(req: GenerateRequest): Promise<TextResult>;
  generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
  streamText(req: GenerateRequest, onDelta: (delta: string) => void): Promise<TextResult>;
}

export class AIProviderError extends Error {
  constructor(
    public readonly code: 'refusal' | 'invalid_output' | 'max_tokens' | 'provider_error' | 'rate_limited',
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'AIProviderError';
  }
}

/** USD per million tokens (input, output). Used for estimated cost only — the provider invoice is authoritative. */
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-fable-5-1': { input: 10, output: 50 },
  'claude-fable-5': { input: 10, output: 50 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICING[model] ?? PRICING['claude-opus-5']!;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

export const SUPPORTED_MODELS = Object.keys(PRICING);
