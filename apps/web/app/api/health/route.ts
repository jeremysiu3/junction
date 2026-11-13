// Cheap reachability probe for <Live />. Deliberately touches nothing (no DB, no auth).
export const GET = () => new Response(null, { status: 204 });
