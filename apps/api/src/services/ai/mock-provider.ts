import { AIProviderError, type AIProvider, type GenerateRequest, type StructuredRequest, type StructuredResult, type TextResult } from './provider.js';

export type MockFixture = (req: StructuredRequest<unknown>, callIndex: number) => unknown;

/**
 * DEVELOPMENT / TEST ONLY. Refused in production by env validation.
 * Outputs are clearly prefixed with [MOCK] so they can never be mistaken for real AI work.
 */
export class MockAIProvider implements AIProvider {
  readonly name = 'mock';
  readonly defaultModel = 'mock-model';
  readonly isMock = true;
  private calls = new Map<string, number>();

  constructor(private readonly fixtures: Record<string, MockFixture> = {}) {}

  setFixture(schemaName: string, fixture: MockFixture): void {
    this.fixtures[schemaName] = fixture;
  }

  private usage() {
    return { provider: this.name, model: this.defaultModel, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 };
  }

  async generateText(req: GenerateRequest): Promise<TextResult> {
    const last = req.messages[req.messages.length - 1]?.content ?? '';
    return { text: `[MOCK] ${last.slice(0, 200)}`, usage: this.usage() };
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const idx = this.calls.get(req.schemaName) ?? 0;
    this.calls.set(req.schemaName, idx + 1);
    const fixture = this.fixtures[req.schemaName];
    if (!fixture) throw new AIProviderError('provider_error', `[MOCK] no fixture for ${req.schemaName}`);
    const parsed = req.schema.safeParse(fixture(req as StructuredRequest<unknown>, idx));
    if (!parsed.success) throw new AIProviderError('invalid_output', `[MOCK] fixture invalid for ${req.schemaName}`);
    return { data: parsed.data, usage: this.usage() };
  }

  async streamText(req: GenerateRequest, onDelta: (delta: string) => void): Promise<TextResult> {
    const res = await this.generateText(req);
    onDelta(res.text);
    return res;
  }
}
