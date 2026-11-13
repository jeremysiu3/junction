import { randomBytes } from 'node:crypto';
import { POSTGRES_LOCAL_DB_URL, approveTask, createDb, newWorkerToken, type Actor, type Db } from '../src';

// Fixtures that write the auth schema (users, sessions, OAuth clients and consents) connect as postgres, even when the
// suite runs as junction_app, which only reaches auth through junction_auth functions.
export const adminDb = () => createDb(POSTGRES_LOCAL_DB_URL);

export type FixtureUser = { id: string; name: string; email: string; token: string };

export async function makeProject(db: Db) {
  const suffix = randomBytes(4).toString('hex');
  const [project] = await db`insert into projects (slug, name) values (${'p-' + suffix}, 'Test project') returning id, slug`;

  const makeUser = async (name: string, role: 'admin' | 'member' = 'member'): Promise<FixtureUser> => {
    const email = `${name.toLowerCase()}-${suffix}@example.com`;
    const { token, hash } = newWorkerToken();
    const [u] = await db`insert into users (name, email) values (${name}, ${email}) returning id`;
    await db`insert into memberships (project_id, user_id, role) values (${project.id}, ${u.id}, ${role})`;
    await db`insert into worker_credentials (user_id, name, token_hash) values (${u.id}, 'test', ${hash})`;
    return { id: u.id, name, email, token };
  };
  const jeremy = await makeUser('Jeremy', 'admin');
  const jaxon = await makeUser('Jaxon');
  const scott = await makeUser('Scott');

  return { project: { id: project.id as string, slug: project.slug as string }, jeremy, jaxon, scott };
}

export const agent = (u: { id: string }): Actor => ({ userId: u.id, type: 'agent' });
export const human = (u: { id: string }): Actor => ({ userId: u.id, type: 'human' });

// Moves a task's events past the undo window, keeping their order.
export const age = (db: Db, taskId: string) =>
  db`update task_events set created_at = created_at - interval '16 seconds' where task_id = ${taskId}`;

// approveTask for tests that go on to claim or start the task.
export const approveAged = async (db: Db, actor: Actor, taskId: string) => {
  const t = await approveTask(db, actor, taskId);
  await age(db, taskId);
  return t;
};
