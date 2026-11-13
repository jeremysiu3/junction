import { createDb, type Db } from '@junction/core';

// Cached on globalThis so dev hot reload doesn't open a new pool each time.
const g = globalThis as unknown as { __junctionDb?: Db };
export const db = (g.__junctionDb ??= createDb(process.env.DATABASE_URL));
