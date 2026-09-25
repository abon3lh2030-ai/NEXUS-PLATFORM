import type { MockFixture } from './mock-provider.js';

const nulls = {
  file_id: null,
  document_id: null,
  ai_employee_id: null,
  query: null,
  name: null,
  title: null,
  content: null,
  body: null,
  doc_type: null,
  memory_type: null,
  status: null,
  url: null,
  command: null,
  summary: null,
};

/**
 * Deterministic fixtures for DEVELOPMENT/TEST with AI_PROVIDER=mock.
 * All produced content is labelled [MOCK].
 */
export function mockFixtures(): Record<string, MockFixture> {
  return {
    agent_step: (req) => {
      const turn = Math.floor(req.messages.length / 2);
      if (turn === 0) return { phase: 'reading', progress_note: '[MOCK] Reading the task', tool: 'read_task', args: nulls };
      if (turn === 1) {
        return {
          phase: 'writing',
          progress_note: '[MOCK] Writing the report',
          tool: 'create_document',
          args: { ...nulls, title: '[MOCK] Report', doc_type: 'report', content: '# [MOCK] Report\n\nThis document was produced by the development mock AI provider. It is not real AI output.' },
        };
      }
      return { phase: 'writing', progress_note: '[MOCK] Finishing', tool: 'finish', args: { ...nulls, summary: '[MOCK] Completed with the development mock provider.' } };
    },
    nexus_step: () => ({ action: 'respond', tool: null, tool_input: null, message: '[MOCK] Nexus AI is running with the development mock provider. Configure ANTHROPIC_API_KEY for real answers.' }),
    meeting_ai: () => ({ summary: '[MOCK] Meeting summary', decisions: [], action_items: [] }),
    mission_summary: () => ({ summary: '[MOCK] Mission summary' }),
    presentation_deck: () => ({
      title: '[MOCK] Presentation',
      slides: [
        { kind: 'cover', role: null, title: '[MOCK] Presentation', subtitle: 'Development mock provider', points: null, note: 'AI employee', left_title: null, left_points: null, right_title: null, right_points: null, metrics: null, chart_type: null, categories: null, series: null, headers: null, rows: null, milestones: null, quote: null, attribution: null },
        { kind: 'bullets', role: 'executive_summary', title: '[MOCK] Summary', subtitle: null, points: ['[MOCK] Not real AI output'], note: null, left_title: null, left_points: null, right_title: null, right_points: null, metrics: null, chart_type: null, categories: null, series: null, headers: null, rows: null, milestones: null, quote: null, attribution: null },
        { kind: 'closing', role: null, title: 'Q&A', subtitle: '[MOCK]', points: null, note: null, left_title: null, left_points: null, right_title: null, right_points: null, metrics: null, chart_type: null, categories: null, series: null, headers: null, rows: null, milestones: null, quote: null, attribution: null },
      ],
    }),
    meeting_followup: () => ({ summary: '[MOCK] Summary', minutes: '[MOCK] Minutes', decisions: [], action_items: [], followup_email: { subject: '[MOCK] Follow-up', body: '[MOCK]' } }),
  };
}
