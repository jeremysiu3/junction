import { Sk, SkPage } from '../../skeleton';

// Work detail: one card with the field list and the done / not-done lists.
export default function Loading() {
  return (
    <SkPage>
      <div className="page-head">
        <p><Sk w="48px" h={12} /></p>
        <Sk w="280px" h={22} />
      </div>
      <div className="stack detail">
        <section className="card sk-lines">
          <Sk w="30%" h={12} />
          <Sk w="86%" h={13} />
          <Sk w="70%" h={13} />
          <Sk w="78%" h={13} />
        </section>
      </div>
    </SkPage>
  );
}
