// Profile picture, or the name's initial in a circle when there is none.
export function Avatar({ name, url, size }: { name: string; url?: string | null; size: number }) {
  return url
    ? <img src={url} alt="" width={size} height={size} className="avatar" referrerPolicy="no-referrer" />
    : <span className="avatar" aria-hidden="true" style={{ width: size, height: size, fontSize: size / 2 }}>{name.charAt(0).toUpperCase()}</span>;
}
