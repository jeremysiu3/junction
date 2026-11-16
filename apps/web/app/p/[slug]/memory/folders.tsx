// Memory folders by type; each links into All entries, keeping the tag and search when set.
export const FOLDERS = [['all', 'All'], ['decision', 'Decisions'], ['note', 'Notes'], ['update', 'Updates'], ['ownership', 'Owners']] as const;
export type Counts = Record<(typeof FOLDERS)[number][0], number>;

// Query string for All entries, keeping only what's set.
export const qs = (o: { kind?: string; tag?: string; q?: string; before?: string }) => {
  const s = new URLSearchParams(Object.entries(o).filter((e): e is [string, string] => !!e[1])).toString();
  return s ? `?${s}` : '?';
};

export function Folders({ base, counts, active, tag, q }: { base: string; counts: Counts; active?: string; tag?: string; q?: string }) {
  return (
    <nav className="folders" aria-label="Memory folders">
      {FOLDERS.map(([k, label]) => {
        const on = active === k;
        return (
          <a key={k} href={`${base}${qs({ kind: k === 'all' ? undefined : k, tag, q })}`} className={on ? 'active' : undefined} aria-current={on ? 'page' : undefined}>
            {label}<span className="c">{counts[k]}</span>
          </a>
        );
      })}
    </nav>
  );
}
