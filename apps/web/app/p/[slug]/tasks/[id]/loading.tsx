import { Sk, SkPage } from '../../skeleton';

// Task detail: one card with the status line, changes and description.
export default function Loading() {
  return (
    <SkPage>
      <div className="page-head">
        <p><Sk w="48px" h={12} /></p>
        <Sk w="320px" h={22} />
      </div>
      <div className="stack detail">
        <section className="card sk-lines">
          <div className="card-meta"><Sk w="72px" h={20} r={6} /><Sk w="40%" h={12} /></div>
          <Sk w="30%" h={12} />
          <Sk w="86%" h={13} />
          <Sk w="70%" h={13} />
          <Sk w="78%" h={13} />
        </section>
      </div>
    </SkPage>
  );
}
