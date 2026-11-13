import { redirect } from 'next/navigation';

export default async function Areas({ params }: { params: Promise<{ slug: string }> }) {
  redirect(`/p/${(await params).slug}/settings`);
}
