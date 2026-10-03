import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import type pg from "pg";
export async function testPool() {
  const p = new PGlite({ extensions: { vector } });
  await p.waitReady;
  let tail = Promise.resolve();
  const acquire = async () => {
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    const previous = tail;
    tail = next;
    await previous;
    return release;
  };
  const raw = async (sql: string, params?: any[]) => {
    if (!params?.length && sql.includes(";")) {
      const results = await p.exec(sql);
      return results.at(-1) ?? { rows: [], rowCount: 0 };
    }
    const result = await p.query(sql, params);
    return { ...result, rowCount: result.affectedRows ?? result.rows.length };
  };
  return {
    query: async (sql: string, params?: any[]) => {
      const release = await acquire();
      try {
        return await raw(sql, params);
      } finally {
        release();
      }
    },
    connect: async () => {
      const release = await acquire();
      return { query: raw, release };
    },
    end: () => p.close(),
  } as unknown as pg.Pool;
}
