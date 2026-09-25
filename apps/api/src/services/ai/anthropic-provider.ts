import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  AIProviderError,
  estimateCostUsd,
  type AIProvider,
  type AIUsage,
  type GenerateRequest,
  type StructuredRequest,
  type StructuredResult,
  type TextResult,
} from './provider.js';

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic';
  readonly isMock = false;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly defaultModel: string,
    private readonly effort: Effort,
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 2 });
  }

  private usage(model: string, u: { input_tokens: number; output_tokens: number }): AIUsage {
    return {
      provider: this.name,
      model,
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      estimatedCostUsd: estimateCostUsd(model, u.input_tokens, u.output_tokens),
    };
  }

  private checkStop(stopReason: string | null): void {
    if (stopReason === 'refusal') throw new AIProviderError('refusal', 'The model declined this request');
    if (stopReason === 'max_tokens') throw new AIProviderError('max_tokens', 'The model output hit the token limit');
  }

  private mapError(err: unknown): never {
    if (err instanceof AIProviderError) throw err;
    if (err instanceof Anthropic.RateLimitError) throw new AIProviderError('rate_limited', 'AI provider rate limited', true);
    if (err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError) {
      throw new AIProviderError('provider_error', 'AI provider unavailable', true);
    }
    if (err instanceof Anthropic.APIError) throw new AIProviderError('provider_error', `AI provider error (${err.status ?? 'n/a'})`);
    throw new AIProviderError('provider_error', err instanceof Error ? err.message : 'unknown AI error');
  }

  async generateText(req: GenerateRequest): Promise<TextResult> {
    const model = req.model ?? this.defaultModel;
    try {
      const stream = this.client.messages.stream({
        model,
        max_tokens: req.maxTokens ?? 16000,
        system: req.system,
        messages: req.messages,
        thinking: { type: 'adaptive' },
        output_config: { effort: this.effort },
      });
      const msg = await stream.finalMessage();
      this.checkStop(msg.stop_reason);
      const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      return { text, usage: this.usage(model, msg.usage) };
    } catch (err) {
      this.mapError(err);
    }
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const model = req.model ?? this.defaultModel;
    try {
      const msg = await this.client.messages.parse({
        model,
        max_tokens: req.maxTokens ?? 16000,
        system: req.system,
        messages: req.messages,
        thinking: { type: 'adaptive' },
        output_config: { effort: this.effort, format: zodOutputFormat(req.schema) },
      });
      this.checkStop(msg.stop_reason);
      if (msg.parsed_output === null || msg.parsed_output === undefined) {
        throw new AIProviderError('invalid_output', `Model output did not match schema ${req.schemaName}`);
      }
      // Re-validate with our own Zod schema — never trust model output shape.
      const checked = req.schema.safeParse(msg.parsed_output);
      if (!checked.success) throw new AIProviderError('invalid_output', `Schema validation failed for ${req.schemaName}`);
      return { data: checked.data, usage: this.usage(model, msg.usage) };
    } catch (err) {
      this.mapError(err);
    }
  }

  async streamText(req: GenerateRequest, onDelta: (delta: string) => void): Promise<TextResult> {
    const model = req.model ?? this.defaultModel;
    try {
      const stream = this.client.messages.stream({
        model,
        max_tokens: req.maxTokens ?? 16000,
        system: req.system,
        messages: req.messages,
        thinking: { type: 'adaptive' },
        output_config: { effort: this.effort },
      });
      stream.on('text', (delta) => onDelta(delta));
      const msg = await stream.finalMessage();
      this.checkStop(msg.stop_reason);
      const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      return { text, usage: this.usage(model, msg.usage) };
    } catch (err) {
      this.mapError(err);
    }
  }
}
