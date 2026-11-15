import { Lockup } from '../lockup';
import { requireHuman } from '../../lib/human';
import { NewProject } from './new-project';

export default async function New() {
  await requireHuman('/new');
  return (
    <main className="auth">
      <div className="card">
        <div className="auth-lockup"><Lockup stacked /></div>
        <NewProject />
        <p className="muted"><a href="/">Cancel</a></p>
      </div>
    </main>
  );
}
