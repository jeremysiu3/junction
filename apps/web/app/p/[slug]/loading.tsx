import { Sk, SkPage } from './skeleton';

// Overview: news rows beside the background agent panel.
export default function Loading() {
  return (
    <SkPage>
      <div className="page-head"><Sk w="120px" h={22} /></div>
      <div className="two">
        <section>
          <h2 className="lbl"><Sk w="220px" h={12} /></h2>
          {[0, 1, 2].map((i) => (
            <div className="item" key={i}>
              <span className="dot sk" aria-hidden="true" />
              <div className="body">
                <div className="t"><Sk w={i === 1 ? '58%' : '72%'} h={14} /></div>
                <div className="m"><Sk w="36%" h={12} /></div>
              </div>
            </div>
          ))}
        </section>
        <aside className="agent">
          <div className="lbl-row"><h2 className="lbl"><Sk w="150px" h={12} /></h2></div>
          {[0, 1].map((i) => (
            <div className="task" key={i}>
              <div className="row">
                <div className="t"><Sk w={i === 0 ? '64%' : '52%'} h={14} /></div>
                <Sk w="72px" h={20} r={6} />
              </div>
              <div className="m"><Sk w="70%" h={12} /></div>
            </div>
          ))}
        </aside>
      </div>
    </SkPage>
  );
}
