// Grey placeholder blocks for the loading.tsx files. Each skeleton reuses its page's real classes so the shapes line up.
export function SkPage({ children }: { children: React.ReactNode }) {
  return <div className="sk-page" role="status" aria-label="Loading">{children}</div>;
}

export function Sk({ w, h, r }: { w: string; h: number; r?: number }) {
  return <span className="sk" style={{ width: w, height: h, borderRadius: r }} />;
}

// Heading and two cards: settings, areas, account and setup.
export function SkGeneric() {
  return (
    <SkPage>
      <div className="page-head"><Sk w="140px" h={22} /></div>
      <div className="stack">
        {[0, 1].map((i) => (
          <section className="card sk-lines" key={i}>
            <Sk w="28%" h={12} />
            <Sk w="62%" h={14} />
            <Sk w="44%" h={12} />
          </section>
        ))}
      </div>
    </SkPage>
  );
}
