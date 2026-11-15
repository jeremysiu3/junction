import { Sk, SkPage } from '../skeleton';

// Board: four columns of request and work cards (counts 3, 2, 3, 2).
const COLUMNS = [3, 2, 3, 2];

export default function Loading() {
  return (
    <SkPage>
      <div className="page-head"><Sk w="90px" h={22} /></div>
      <div className="kb">
        {COLUMNS.map((n, c) => (
          <section key={c}>
            <h2 className="colh"><Sk w="110px" h={13} /></h2>
            <div className={`col${c === 2 ? ' hot' : ''}`}>
              {Array.from({ length: n }, (_, i) => (
                <div className="bcard" key={i}>
                  <div className="t"><Sk w={i % 2 ? '66%' : '84%'} h={14} /></div>
                  <div className="m"><Sk w="58%" h={11} /></div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </SkPage>
  );
}
