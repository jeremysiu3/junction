import {
  JunctionError, addEstimate, answerQuestion, askQuestion, cancelTask, checkInbox, claimTask, completeTask, findOwner, getBoard, joinTask, leaveTask,
  getSnapshot, markStuck, projectForMember, projectsFor, recordWork, reportPr, retryTask, searchContext, searchWork, sendTask, startTask, startWork,
  workerQueue, wrapUntrusted, writeContext,
  type Actor, type ContextEntry, type Db, type WorkStatus,
} from '@junction/core';

export type Args = Record<string, any>;
type Handler = (db: Db, actor: Actor, ctx: { projectId: string; repo: string | null }, a: Args) => Promise<string>;

const wrapped = (data: unknown) => wrapUntrusted(JSON.stringify(data, null, 2));
const idStatus = (t: { id: string; status: string }) => JSON.stringify({ id: t.id, status: t.status });
const KINDS = ['note', 'ownership', 'decision', 'update']; // search filter; write_context only takes note and decision
const WORK_STATUSES = ['in_progress', 'merged', 'abandoned'];
const PR_STATES = ['open', 'merged', 'closed'];
const STRING_ARRAYS = ['tags', 'paths', 'not_done', 'changes'];

// Each tool: required string args, optional string args, handler. Args use the snake_case names from the spec.
export const tools: Record<string, { req: string[]; opt?: string[]; run: Handler }> = {
  search_context: {
    req: ['query'], opt: ['kind'],
    run: async (db, actor, { projectId }, a) => {
      if (a.kind !== undefined && !KINDS.includes(a.kind)) throw new JunctionError('validation', `kind must be one of ${KINDS.join(', ')}`);
      const entries = await searchContext(db, actor, { projectId, query: a.query, kind: a.kind as ContextEntry['kind'] | undefined });
      const workItems = a.kind === undefined ? await searchWork(db, actor, { projectId, query: a.query }) : [];
      return wrapped({ entries, workItems });
    },
  },
  write_context: {
    req: ['kind', 'title', 'body'], opt: ['visibility', 'tags', 'replaces'],
    run: async (db, actor, { projectId }, a) =>
      JSON.stringify({ id: (await writeContext(db, actor, { projectId, kind: a.kind, title: a.title, body: a.body, tags: a.tags, visibility: a.visibility, replaces: a.replaces })).id }),
  },
  find_owner: { req: ['topic'], run: async (db, actor, { projectId }, a) => wrapped(await findOwner(db, actor, { projectId, topic: a.topic })) },
  send_task: {
    req: ['assignee', 'title', 'description', 'blocking_reason', 'changes'], opt: ['repo', 'work_item_id', 'not_done_item', 'not_duplicate_reason'],
    run: async (db, actor, { projectId }, a) =>
      idStatus(await sendTask(db, actor, {
        projectId, repo: a.repo, assignee: a.assignee, title: a.title, description: a.description, blockingReason: a.blocking_reason, changes: a.changes,
        notDuplicateReason: a.not_duplicate_reason, fromWorkItemId: a.work_item_id, fromItem: a.not_done_item,
      })),
  },
  check_inbox: { req: [], opt: ['peek'], run: async (db, actor, { projectId }, a) => wrapped(await checkInbox(db, actor, projectId, { peek: a.peek === true })) },
  add_estimate: { req: ['task_id', 'estimate_text'], run: async (db, actor, { projectId }, a) => idStatus(await addEstimate(db, actor, a.task_id, a.estimate_text, projectId)) },
  start_task: { req: ['task_id'], run: async (db, actor, { projectId }, a) => idStatus(await startTask(db, actor, a.task_id, projectId)) },
  complete_task: {
    req: ['task_id'], opt: ['evidence_url', 'evidence_note', 'branch'],
    run: async (db, actor, { projectId }, a) =>
      idStatus(await completeTask(db, actor, a.task_id, { evidenceUrl: a.evidence_url, evidenceNote: a.evidence_note, branch: a.branch }, projectId)),
  },
  ask_question: { req: ['task_id', 'question'], run: async (db, actor, { projectId }, a) => idStatus(await askQuestion(db, actor, a.task_id, a.question, projectId)) },
  answer_question: { req: ['task_id', 'answer'], run: async (db, actor, { projectId }, a) => idStatus(await answerQuestion(db, actor, a.task_id, a.answer, projectId)) },
  join_task: { req: ['task_id'], run: async (db, actor, { projectId }, a) => idStatus(await joinTask(db, actor, a.task_id, projectId)) },
  leave_task: { req: ['task_id'], run: async (db, actor, { projectId }, a) => idStatus(await leaveTask(db, actor, a.task_id, projectId)) },
  retry_task: { req: ['task_id'], run: async (db, actor, { projectId }, a) => idStatus(await retryTask(db, actor, a.task_id, projectId)) },
  // Each brief is wrapped already, so the queue as a whole is not.
  worker_queue: { req: [], run: async (db, actor, { projectId }) => JSON.stringify(await workerQueue(db, actor, projectId), null, 2) },
  claim_task: {
    req: ['task_id'],
    run: async (db, actor, { projectId }, a) => {
      const t = await claimTask(db, actor, a.task_id, projectId);
      return JSON.stringify({ id: t.id, status: t.status, branch: t.branch });
    },
  },
  mark_stuck: { req: ['task_id', 'reason'], run: async (db, actor, { projectId }, a) => idStatus(await markStuck(db, actor, a.task_id, a.reason, projectId)) },
  report_pr: {
    req: ['task_id', 'pr_url', 'state'],
    run: async (db, actor, { projectId }, a) => idStatus(await reportPr(db, actor, a.task_id, { prUrl: a.pr_url, state: a.state }, projectId)),
  },
  cancel_task: { req: ['task_id'], run: async (db, actor, { projectId }, a) => idStatus(await cancelTask(db, actor, a.task_id, projectId)) },
  get_board: { req: [], run: async (db, actor, { projectId }) => wrapped(await getBoard(db, actor, projectId)) },
  record_work: {
    req: ['key', 'title', 'summary', 'done', 'not_done'], opt: ['paths', 'area', 'status'],
    run: async (db, actor, { projectId, repo }, a) =>
      idStatus(await recordWork(db, actor, {
        projectId, repo, key: a.key, title: a.title, summary: a.summary, done: a.done, notDone: a.not_done,
        paths: a.paths, area: a.area, status: a.status as WorkStatus | undefined,
      })),
  },
  start_work: {
    req: ['about'], opt: ['paths', 'area'],
    run: async (db, actor, { projectId, repo }, a) => wrapped(await startWork(db, actor, { projectId, repo, about: a.about, paths: a.paths, area: a.area })),
  },
  get_snapshot: {
    req: [], opt: ['area', 'work_item_id'],
    run: async (db, actor, { projectId }, a) => wrapped(await getSnapshot(db, actor, { projectId, area: a.area, workItemId: a.work_item_id })),
  },
};

// Core's text helpers throw a raw TypeError on non-strings, so check types here.
const TYPES: Record<string, { ok: (v: unknown) => boolean; label: string }> = {
  done: { ok: v => Array.isArray(v) && v.every(d => d && typeof d.text === 'string' && (d.evidence === undefined || typeof d.evidence === 'string')), label: 'an array of { text: string, evidence?: string }' },
  peek: { ok: v => typeof v === 'boolean', label: 'a boolean' },
  state: { ok: v => PR_STATES.includes(v as string), label: `one of ${PR_STATES.join(', ')}` },
  status: { ok: v => WORK_STATUSES.includes(v as string), label: `one of ${WORK_STATUSES.join(', ')}` },
  string: { ok: v => typeof v === 'string', label: 'a string' },
  strings: { ok: v => Array.isArray(v) && v.every(x => typeof x === 'string'), label: 'an array of strings' },
};

function checkArgs(spec: { req: string[]; opt?: string[] }, a: Args) {
  const check = (k: string, required: boolean) => {
    const t = TYPES[k in TYPES ? k : STRING_ARRAYS.includes(k) ? 'strings' : 'string'];
    if (!t.ok(a[k])) throw new JunctionError('validation', `${k} ${required ? 'is required and ' : ''}must be ${t.label}`);
  };
  for (const k of spec.req) check(k, true);
  for (const k of spec.opt ?? []) if (a[k] !== undefined) check(k, false);
}


export type AgentCaller = { userId: string; via: 'oauth' | 'worker' };

// Tools for the person's own interactive agent; a worker credential must not use them.
export const WORKER_BLOCKED = ['send_task', 'cancel_task', 'join_task', 'leave_task', 'check_inbox', 'answer_question', 'retry_task'];

const STATUS = { unauthorized: 401, forbidden: 403, not_found: 404, invalid_transition: 409, duplicate: 409, validation: 400, limit: 429 } as const;
export const STATUS_OF = (code: keyof typeof STATUS) => STATUS[code];

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export async function runTool(
  db: Db, caller: AgentCaller, tool: string, args: Args, opts: { project?: string | null; repo?: string | null },
): Promise<{ project: string; result: string }> {
  const spec = Object.hasOwn(tools, tool) ? tools[tool] : undefined;
  if (!spec) throw new JunctionError('not_found', 'Unknown tool');
  if (caller.via === 'worker' && WORKER_BLOCKED.includes(tool)) throw new JunctionError('forbidden', `worker credentials cannot ${tool}`);

  const { project: projectArg, ...rest } = args;
  if (projectArg !== undefined && typeof projectArg !== 'string') throw new JunctionError('validation', 'project must be a string');
  // The worker's header is its scope: text in an approved task must not steer a run into the user's other projects.
  if (caller.via === 'worker' && str(opts.project) && str(projectArg) && str(projectArg) !== str(opts.project))
    throw new JunctionError('forbidden', 'a worker run can only use its own project');
  let slug = str(projectArg) ?? str(opts.project);
  if (!slug) {
    const mine = await projectsFor(db, caller.userId);
    if (!mine.length) throw new JunctionError('validation', 'you are not in any Junction project yet; ask a project admin for an invite');
    if (mine.length !== 1)
      throw new JunctionError('validation', `project is required: add junction.json to the repo root with {"project": "<slug>"} and pass project on each call. Your projects: ${mine.map(p => p.slug).join(', ')}`);
    slug = mine[0].slug;
  }
  const project = await projectForMember(db, caller.userId, slug);
  const repo = str(rest.repo) ?? str(opts.repo);

  checkArgs(spec, rest);
  const result = await spec.run(db, { userId: caller.userId, type: 'agent' }, { projectId: project.id, repo }, rest);
  return { project: project.slug, result };
}
