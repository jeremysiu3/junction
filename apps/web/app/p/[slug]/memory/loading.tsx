import { Sk, SkPage } from '../skeleton';

// Memory: a row of key-context blocks above the activity log.
export default function Loading() {
  return (
    <SkPage>
      <div className="page-head"><Sk w="110px" h={22} /></div>
      <section className="sec">
        <h2 className="lbl"><Sk w="120px" h={12} /></h2>
        <div className="mem-grid">
          {[0, 1, 2].map((i) => (
            <div className="kc" key={i}>
              <div className="t"><Sk w={['78%', '64%', '70%'][i]} h={14} /></div>
              <div className="m"><Sk w={['38%', '30%', '34%'][i]} h={11} /></div>
              <div className="m" style={{ marginTop: 8 }}><Sk w="60px" h={12} /></div>
            </div>
          ))}
        </div>
      </section>
      <section>
          <h2 className="lbl"><Sk w="40px" h={12} /></h2>
          <div className="log">
            {[88, 72, 80, 64, 76].map((w, i) => (
              <div className="ev" key={i}>
                <span className="time"><Sk w="28px" h={11} /></span>
                <div className="x"><Sk w={`${w}%`} h={13} /></div>
              </div>
            ))}
          </div>
      </section>
    </SkPage>
  );
}
