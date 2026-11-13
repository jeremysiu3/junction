'use client';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useState } from 'react';

// The layout reads the cookie for the first render; this flips the class and remembers the choice.
export function SidebarToggle({ mini: initial }: { mini: boolean }) {
  const [mini, setMini] = useState(initial);
  const label = mini ? 'Expand sidebar' : 'Collapse sidebar';
  const Icon = mini ? PanelLeftOpen : PanelLeftClose;
  return (
    <button
      type="button"
      className="sidebar-toggle"
      title={label}
      aria-label={label}
      onClick={(e) => {
        const next = !mini;
        e.currentTarget.closest('.shell')?.classList.toggle('mini', next);
        document.cookie = `junction_sidebar=${next ? 'mini' : 'full'}; path=/; max-age=31536000; samesite=lax`;
        setMini(next);
      }}
    >
      <Icon size={18} aria-hidden="true" />
    </button>
  );
}
