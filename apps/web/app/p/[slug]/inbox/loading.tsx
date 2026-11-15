import { Sk, SkPage } from '../skeleton';

// Inbox: two request cards with a title, meta line, proposed changes and an action row.
export default function Loading() {
  return (
    <SkPage>
      <div className="page-head"><Sk w="90px" h={22} /></div>
      <div className="stack">
        {[0, 1].map((i) => (
          <section className="card req" key={i}>
            <Sk w={i === 0 ? '58%' : '46%'} h={18} />
            <div className="card-meta"><Sk w="62%" h={12} /></div>
            <div className="sk-lines">
              {[0, 1, 2].map((j) => <Sk key={j} w={['82%', '70%', '76%'][j]} h={13} />)}
            </div>
            <div className="actions">
              <Sk w="92px" h={34} r={4} />
              <Sk w="64px" h={34} r={4} />
              <span className="gap" />
              <Sk w="104px" h={34} r={4} />
            </div>
          </section>
        ))}
      </div>
    </SkPage>
  );
}
