import { setupState } from '@junction/core';
import { db } from '../../../../lib/db';
import { origin } from '../../../../lib/origin';
import { projectFromSlug } from '../../../../lib/project';
import { Live } from '../live';
import { WorkerStep } from './worker-step';

export default async function Setup({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { actor, project } = await projectFromSlug(slug);
  const [o, { agentConnected, workerSeen }] = await Promise.all([origin(), setupState(db, actor, project.id)]);
  return (
    <>
      <div className="page-head"><h1>Set up {project.name}</h1><Live /></div>
      <div className="card">
        <h2 className="lbl">Step 1 · Connect your agent {agentConnected && <span className="p-ok">✓ Agent connected</span>}</h2>
        <h4>Claude Code</h4>
        <pre className="snippet">{`claude mcp add --transport http --scope user junction ${o}/mcp`}</pre>
        <p className="muted">Then run <code>/mcp</code> in Claude Code to sign in.</p>
        <h4>Cursor</h4>
        <p className="muted">In <code>~/.cursor/mcp.json</code>:</p>
        <pre className="snippet">{`{"mcpServers":{"junction":{"url":"${o}/mcp"}}}`}</pre>
        <h4>Codex</h4>
        <pre className="snippet">{`codex mcp add junction --url ${o}/mcp\ncodex mcp login junction`}</pre>
        <h4>Repo file</h4>
        <pre className="snippet">{`{"project":"${project.slug}","repo":"your-repo"}`}</pre>
        <p className="muted">Save as <code>junction.json</code>. Commit this at the root of each repo for this project.</p>
      </div>
      <div className="card" style={{ marginTop: 'var(--space-4)' }}>
        <WorkerStep slug={project.slug} origin={o} seen={workerSeen} />
      </div>
      <p className="box-link"><a href={`/p/${project.slug}`}>Skip for now</a></p>
    </>
  );
}
