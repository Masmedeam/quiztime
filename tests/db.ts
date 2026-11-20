import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';

// Exercise real SQLite constraints/transactions, using the same migrations as D1.
export function testDb() {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of ['0001_learning.sql', '0002_anonymous_workspaces.sql']) {
    sqlite.exec(readFileSync(new NodeURL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  class Statement {
    values: Array<string | number | null> = [];
    constructor(readonly sql: string) {}
    bind(...values: Array<string | number | null>) { this.values = values; return this; }
    async first() { return sqlite.prepare(this.sql).get(...this.values) ?? null; }
    async all() { return { results: sqlite.prepare(this.sql).all(...this.values) }; }
    async run() { return { meta: { changes: Number(sqlite.prepare(this.sql).run(...this.values).changes) } }; }
  }
  const db = {
    prepare: (sql: string) => new Statement(sql),
    async batch(statements: Statement[]) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  } as unknown as D1Database;
  return { db, sqlite };
}
