import {
  commentSchema,
  decisionSchema,
  departmentSchema,
  documentSchema,
  goalSchema,
  meetingSchema,
  memorySchema,
  missionSchema,
  projectSchema,
  taskSchema,
} from '@nexus/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { notFound, parse } from '../lib/errors.js';
import { actorOf, orgGuard } from '../plugins/auth.js';
import type { Services } from '../services/container.js';
import type { EntityName } from '../services/work-service.js';
import { idOf, localeQuery, params } from './helpers.js';

const SCHEMAS: Record<EntityName, z.ZodObject> = {
  departments: departmentSchema,
  goals: goalSchema,
  missions: missionSchema,
  projects: projectSchema,
  tasks: taskSchema,
  meetings: meetingSchema,
  documents: documentSchema,
  decisions: decisionSchema,
  memories: memorySchema,
};

const entityParam = z.object({ entity: z.enum(Object.keys(SCHEMAS) as [EntityName, ...EntityName[]]) });
const entityIdParam = entityParam.extend({ id: z.uuid() });

/** Keep only keys the client actually sent, so partial updates never reset fields to schema defaults. */
function onlySent(parsed: Record<string, unknown>, raw: unknown): Record<string, unknown> {
  const sent = raw && typeof raw === 'object' ? Object.keys(raw) : [];
  return Object.fromEntries(Object.entries(parsed).filter(([k]) => sent.includes(k)));
}

export async function workRoutes(app: FastifyInstance, s: Services) {
  const guard = { preHandler: orgGuard(s) };

  app.get('/work/:entity', guard, async (req) => {
    const { entity } = params(entityParam, req.params);
    return s.work.list(actorOf(req), entity, req.query as Record<string, string | undefined>);
  });

  app.get('/work/:entity/:id', guard, async (req) => {
    const { entity, id } = params(entityIdParam, req.params);
    return s.work.get(actorOf(req), entity, id);
  });

  app.post('/work/:entity', guard, async (req, reply) => {
    const { entity } = params(entityParam, req.params);
    const input = parse(SCHEMAS[entity], req.body) as Record<string, unknown>;
    return reply.code(201).send(await s.work.create(actorOf(req), entity, input));
  });

  app.patch('/work/:entity/:id', guard, async (req) => {
    const { entity, id } = params(entityIdParam, req.params);
    const input = onlySent(parse(SCHEMAS[entity].partial(), req.body) as Record<string, unknown>, req.body);
    return s.work.update(actorOf(req), entity, id, input);
  });

  app.delete('/work/:entity/:id', guard, async (req) => {
    const { entity, id } = params(entityIdParam, req.params);
    await s.work.remove(actorOf(req), entity, id);
    return { ok: true };
  });

  app.post('/work/tasks/:id/comments', guard, async (req) => {
    const body = parse(commentSchema, req.body);
    return s.work.addComment(actorOf(req), idOf(req.params), body.body, body.file_ids);
  });

  app.get('/work/documents/:id/versions/:version', guard, async (req) => {
    const { id, version } = params(z.object({ id: z.uuid(), version: z.coerce.number().int().min(1) }), req.params);
    await s.work.get(actorOf(req), 'documents', id);
    const { data } = await s.db.from('document_versions').select('*').eq('document_id', id).eq('version', version).maybeSingle();
    if (!data) throw notFound();
    return data;
  });

  // Meeting AI: summarize, extract decisions, create tasks
  app.post('/work/meetings/:id/ai/analyze', { preHandler: orgGuard(s, { permission: 'meetings.manage', feature: 'meetings' }) }, async (req) =>
    s.meetingAi.analyzeMeeting(actorOf(req), idOf(req.params), parse(localeQuery, req.query).locale),
  );
  app.post('/work/meetings/:id/ai/create-tasks', { preHandler: orgGuard(s, { permission: ['meetings.manage', 'work.create'], feature: 'meetings' }) }, async (req) =>
    s.meetingAi.createTasksFromMeeting(actorOf(req), idOf(req.params)),
  );
  app.post('/work/meetings/:id/ai/save-decisions', { preHandler: orgGuard(s, { permission: 'decisions.manage', feature: 'decisions' }) }, async (req) =>
    s.meetingAi.saveDecisionsFromMeeting(actorOf(req), idOf(req.params)),
  );
  app.post('/work/missions/:id/ai/summary', { preHandler: orgGuard(s, { permission: 'work.view' }) }, async (req) =>
    s.meetingAi.summarizeMission(actorOf(req), idOf(req.params), parse(localeQuery, req.query).locale),
  );

  app.get('/work/org-graph', guard, async (req) => {
    const a = actorOf(req);
    const [departments, members, ais] = await Promise.all([
      s.db.from('departments').select('id, name, parent_id, lead_member_id, lead_ai_employee_id, objective').eq('organization_id', a.orgId).is('deleted_at', null),
      s.orgs.listMembers(a),
      s.db.from('ai_employees').select('id, name, job_title, department_id, status, avatar_seed, manager_member_id').eq('organization_id', a.orgId).is('deleted_at', null),
    ]);
    return { owner_user_id: a.ownerUserId, departments: departments.data ?? [], members, ai_employees: ais.data ?? [] };
  });
}
