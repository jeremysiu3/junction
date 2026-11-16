import { deleteContextAction } from '../actions';

// Confirm step behind a disclosure, like removing a member.
export function DeleteEntry({ slug, id, title, back }: { slug: string; id: string; title: string; back?: 'entries' }) {
  return (
    <details>
      <summary>Delete</summary>
      <form action={deleteContextAction}>
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="id" value={id} />
        {back && <input type="hidden" name="back" value={back} />}
        <p className="m">Delete &ldquo;{title}&rdquo; for everyone? This can&apos;t be undone.</p>
        <button className="danger">Confirm delete</button>
      </form>
    </details>
  );
}
