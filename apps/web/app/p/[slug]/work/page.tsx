import { redirect } from 'next/navigation';

export default async function Work({ params }: { params: Promise<{ slug: string }> }) {
  redirect(`/p/${(await params).slug}/board`);
}
