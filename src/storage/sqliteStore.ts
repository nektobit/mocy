import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DbSchema, JsonObject, JsonValue, ResourceRecord } from '../core/types.js';

interface RawRecord {
  id: string;
  data: string;
}

export interface StorageInit {
  sourcePath: string;
  sqlitePath: string;
}

export class SqliteStore {
  private readonly db: Database.Database;
  private readonly sourcePath: string;

  public constructor(config: StorageInit) {
    this.sourcePath = config.sourcePath;
    const dbDir = path.dirname(config.sqlitePath);
    this.ensureDirectory(dbDir);
    this.db = new Database(config.sqlitePath);
    this.configure();
  }

  public close(): void {
    this.db.close();
  }

  public importData(input: DbSchema): void {
    const transaction = this.db.transaction((payload: DbSchema) => {
      this.db.exec('DELETE FROM records;');
      this.db.exec('DELETE FROM singular;');

      const insertRecord = this.db.prepare(
        'INSERT INTO records(resource, id, id_type, data) VALUES (?, ?, ?, ?);'
      );
      const insertSingular = this.db.prepare('INSERT INTO singular(resource, data) VALUES (?, ?);');

      for (const [resource, value] of Object.entries(payload)) {
        if (Array.isArray(value)) {
          value.forEach((entry, index) => {
            const normalized = normalizeRecord(entry, String(index + 1));
            insertRecord.run(resource, normalized.id, 'string', JSON.stringify(normalized.record));
          });
          continue;
        }

        if (isObject(value)) {
          insertSingular.run(resource, JSON.stringify(value));
          continue;
        }
      }
    });

    transaction(input);
  }

  public async importFromJsonFile(): Promise<void> {
    const contents = await readFile(this.sourcePath, 'utf8');
    const parsed = JSON.parse(contents) as DbSchema;
    this.importData(parsed);
  }

  public listResources(): string[] {
    const records = this.db
      .prepare('SELECT DISTINCT resource FROM records UNION SELECT resource FROM singular ORDER BY resource;')
      .all() as Array<{ resource: string }>;
    return records.map((entry) => entry.resource);
  }

  public list(resource: string): ResourceRecord[] {
    const rows = this.db
      .prepare('SELECT id, data FROM records WHERE resource = ? ORDER BY rowid;')
      .all(resource) as RawRecord[];

    return rows.map((row) => {
      const value = JSON.parse(row.data) as JsonObject;
      return {
        id: row.id,
        value
      };
    });
  }

  public get(resource: string, id: string): JsonObject | null {
    const row = this.db
      .prepare('SELECT data FROM records WHERE resource = ? AND id = ? LIMIT 1;')
      .get(resource, id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as JsonObject) : null;
  }

  public getSingular(resource: string): JsonObject | null {
    const row = this.db
      .prepare('SELECT data FROM singular WHERE resource = ? LIMIT 1;')
      .get(resource) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as JsonObject) : null;
  }

  public hasCollection(resource: string): boolean {
    const row = this.db
      .prepare('SELECT 1 AS has_row FROM records WHERE resource = ? LIMIT 1;')
      .get(resource) as { has_row: number } | undefined;
    return row !== undefined;
  }

  public hasSingular(resource: string): boolean {
    const row = this.db
      .prepare('SELECT 1 AS has_row FROM singular WHERE resource = ? LIMIT 1;')
      .get(resource) as { has_row: number } | undefined;
    return row !== undefined;
  }

  public create(resource: string, input: JsonObject): JsonObject {
    const newRecord = { ...input };
    const id = input.id === undefined ? this.generateNextId() : toIdString(input.id);
    newRecord.id = id;

    const existing = this.get(resource, id);
    if (existing) {
      throw new Error(`Duplicate id "${id}" for resource "${resource}"`);
    }

    this.db
      .prepare('INSERT INTO records(resource, id, id_type, data) VALUES (?, ?, ?, ?);')
      .run(resource, id, 'string', JSON.stringify(newRecord));

    return newRecord;
  }

  public replace(resource: string, id: string, input: JsonObject): JsonObject | null {
    const current = this.get(resource, id);
    if (!current) {
      return null;
    }

    const currentId = toIdString(current.id ?? id);
    const nextRecord = { ...input, id: currentId };

    this.db
      .prepare('UPDATE records SET data = ?, id_type = ? WHERE resource = ? AND id = ?;')
      .run(JSON.stringify(nextRecord), 'string', resource, id);

    return nextRecord;
  }

  public patch(resource: string, id: string, patch: JsonObject): JsonObject | null {
    const current = this.get(resource, id);
    if (!current) {
      return null;
    }

    const nextRecord = {
      ...current,
      ...patch,
      id: toIdString(current.id ?? id)
    };

    this.db
      .prepare('UPDATE records SET data = ?, id_type = ? WHERE resource = ? AND id = ?;')
      .run(JSON.stringify(nextRecord), 'string', resource, id);

    return nextRecord;
  }

  public delete(resource: string, id: string): JsonObject | null {
    const existing = this.get(resource, id);
    if (!existing) {
      return null;
    }

    this.db.prepare('DELETE FROM records WHERE resource = ? AND id = ?;').run(resource, id);
    return existing;
  }

  public replaceSingular(resource: string, input: JsonObject): JsonObject {
    this.db
      .prepare(
        `INSERT INTO singular(resource, data)
         VALUES (?, ?)
         ON CONFLICT(resource) DO UPDATE SET data = excluded.data;`
      )
      .run(resource, JSON.stringify(input));
    return input;
  }

  public patchSingular(resource: string, patch: JsonObject): JsonObject {
    const existing = this.getSingular(resource) ?? {};
    const next = {
      ...existing,
      ...patch
    };
    this.replaceSingular(resource, next);
    return next;
  }

  public deleteSingular(resource: string): JsonObject | null {
    const existing = this.getSingular(resource);
    if (!existing) {
      return null;
    }

    this.db.prepare('DELETE FROM singular WHERE resource = ?;').run(resource);
    return existing;
  }

  public async exportToJsonFile(targetPath = this.sourcePath): Promise<void> {
    const snapshot = this.snapshot();
    const contents = `${JSON.stringify(snapshot, null, 2)}\n`;
    await writeFile(targetPath, contents, 'utf8');
  }

  public snapshot(): DbSchema {
    const result: DbSchema = {};

    const collectionRows = this.db
      .prepare('SELECT resource, data FROM records ORDER BY resource, rowid;')
      .all() as Array<{ resource: string; data: string }>;

    for (const row of collectionRows) {
      if (!Array.isArray(result[row.resource])) {
        result[row.resource] = [];
      }
      (result[row.resource] as JsonValue[]).push(JSON.parse(row.data) as JsonObject);
    }

    const singularRows = this.db
      .prepare('SELECT resource, data FROM singular ORDER BY resource;')
      .all() as Array<{ resource: string; data: string }>;

    for (const row of singularRows) {
      result[row.resource] = JSON.parse(row.data) as JsonObject;
    }

    return result;
  }

  private configure(): void {
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS records (
        resource TEXT NOT NULL,
        id TEXT NOT NULL,
        id_type TEXT NOT NULL CHECK(id_type IN ('number', 'string')),
        data TEXT NOT NULL,
        PRIMARY KEY(resource, id)
      );
      CREATE TABLE IF NOT EXISTS singular (
        resource TEXT NOT NULL PRIMARY KEY,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_records_resource ON records(resource);
      CREATE INDEX IF NOT EXISTS idx_records_id ON records(id);
    `);
  }

  private ensureDirectory(dir: string): void {
    mkdirSync(dir, { recursive: true });
  }

  private generateNextId(): string {
    return randomId();
  }
}

function normalizeRecord(value: JsonValue, fallbackId: string): { id: string; record: JsonObject } {
  if (isObject(value)) {
    if (value.id === undefined) {
      const id = randomId();
      return {
        id,
        record: {
          ...value,
          id
        }
      };
    }

    if (typeof value.id === 'number' || typeof value.id === 'string' || typeof value.id === 'boolean') {
      const id = toIdString(value.id);
      return {
        id,
        record: {
          ...value,
          id
        }
      };
    }

    const id = JSON.stringify(value.id);
    return {
      id,
      record: {
        ...value,
        id
      }
    };
  }

  return {
    id: fallbackId,
    record: {
      id: fallbackId,
      value
    }
  };
}

function isObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toIdString(value: JsonValue | undefined): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value === null || value === undefined) {
    return '';
  }
  return JSON.stringify(value);
}

function randomId(): string {
  return randomBytes(2).toString('hex');
}
