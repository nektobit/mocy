import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DbSchema,
  FilterCondition,
  JsonObject,
  JsonValue,
  ListQuery,
  ListResult,
  ResourceRecord
} from '../core/types.js';

interface RawRecord {
  id: string;
  data: string;
}

interface RawDataRecord {
  data: string;
}

const MAX_GENERATED_ID_ATTEMPTS = 128;

export type IdGenerationMode = 'safe' | 'compat';

export interface StorageInit {
  sourcePath: string;
  sqlitePath: string;
  idMode?: IdGenerationMode;
}

export class SqliteStore {
  private readonly db: Database.Database;
  private readonly sourcePath: string;
  private readonly idMode: IdGenerationMode;

  public constructor(config: StorageInit) {
    this.sourcePath = config.sourcePath;
    this.idMode = config.idMode ?? 'safe';
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
          const usedIds = new Set<string>();
          value.forEach((entry, index) => {
            const normalized = normalizeRecord(entry, String(index + 1), {
              isTaken: (candidate) => usedIds.has(candidate),
              nextId: () => this.generateCandidateId()
            });
            if (usedIds.has(normalized.id)) {
              throw new Error(`Duplicate id "${normalized.id}" in source collection "${resource}"`);
            }
            usedIds.add(normalized.id);
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

  public queryCollection(resource: string, query: ListQuery): ListResult<JsonObject> {
    const whereClauses: string[] = ['resource = ?'];
    const whereParams: unknown[] = [resource];

    this.addFilterClauses(query, whereClauses, whereParams);

    const whereSql = whereClauses.join(' AND ');
    const totalRow = this.db
      .prepare(`SELECT COUNT(*) AS total FROM records WHERE ${whereSql};`)
      .get(...whereParams) as { total: number } | undefined;
    const total = totalRow?.total ?? 0;

    const orderBy = this.buildOrderByClause(query);
    const pagination = this.buildPaginationClause(query);
    const rows = this.db
      .prepare(`SELECT data FROM records WHERE ${whereSql}${orderBy.sql}${pagination.sql};`)
      .all(...whereParams, ...orderBy.params, ...pagination.params) as RawDataRecord[];

    const data = rows.map((row) => JSON.parse(row.data) as JsonObject);
    if (pagination.page !== undefined && pagination.perPage !== undefined) {
      return {
        data,
        total,
        page: pagination.page,
        perPage: pagination.perPage
      };
    }

    return { data, total };
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
    const id = input.id === undefined ? this.generateUniqueId(resource) : toIdString(input.id);
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

  private addFilterClauses(query: ListQuery, clauses: string[], params: unknown[]): void {
    for (const filter of query.filters) {
      clauses.push('mocy_filter_match(data, ?, ?, ?) = 1');
      params.push(filter.field, filter.op, JSON.stringify(filter.values));
    }

    if (query.q) {
      clauses.push("LOWER(data) LIKE ? ESCAPE '\\'");
      params.push(`%${escapeLikePattern(query.q.toLowerCase())}%`);
    }
  }

  private buildOrderByClause(query: ListQuery): { sql: string; params: unknown[] } {
    if (!query.sort || query.sort.length === 0) {
      return {
        sql: ' ORDER BY rowid ASC',
        params: []
      };
    }

    const orderParts: string[] = [];
    const params: unknown[] = [];
    const order = query.order ?? [];

    query.sort.forEach((field, index) => {
      const direction = order[index] ?? order[0] ?? 'asc';
      orderParts.push(`mocy_sort_numeric_rank(data, ?) ASC`);
      params.push(field);
      orderParts.push(`mocy_sort_numeric_value(data, ?) ${direction.toUpperCase()}`);
      params.push(field);
      orderParts.push(`mocy_sort_text_value(data, ?) ${direction.toUpperCase()}`);
      params.push(field);
    });

    orderParts.push('mocy_sort_numeric_rank(data, ?) ASC');
    params.push('id');
    orderParts.push('mocy_sort_numeric_value(data, ?) ASC');
    params.push('id');
    orderParts.push('mocy_sort_text_value(data, ?) ASC');
    params.push('id');

    return {
      sql: ` ORDER BY ${orderParts.join(', ')}`,
      params
    };
  }

  private buildPaginationClause(query: ListQuery): {
    sql: string;
    params: number[];
    page?: number;
    perPage?: number;
  } {
    if (query.page !== undefined) {
      const page = Math.max(1, query.page);
      const perPage = Math.max(1, query.perPage ?? query.limit ?? 10);
      return {
        sql: ' LIMIT ? OFFSET ?',
        params: [perPage, (page - 1) * perPage],
        page,
        perPage
      };
    }

    let offset = 0;
    let limit: number | undefined;

    if (query.start !== undefined || query.end !== undefined) {
      offset = Math.max(0, query.start ?? 0);
      if (query.end !== undefined) {
        limit = Math.max(offset, query.end) - offset;
      }
    }

    if (query.limit !== undefined) {
      const normalizedLimit = Math.max(0, query.limit);
      limit = limit !== undefined ? Math.min(limit, normalizedLimit) : normalizedLimit;
    }

    if (limit !== undefined) {
      return {
        sql: ' LIMIT ? OFFSET ?',
        params: [limit, offset]
      };
    }

    if (offset > 0) {
      return {
        sql: ' LIMIT -1 OFFSET ?',
        params: [offset]
      };
    }

    return {
      sql: '',
      params: []
    };
  }

  private configure(): void {
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.registerSqlFunctions();
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

  private registerSqlFunctions(): void {
    this.db.function(
      'mocy_filter_match',
      (data: string, field: string, op: string, valuesJson: string): number => {
        const record = parseDataRecord(data);
        if (!record || !isFilterOperator(op)) {
          return 0;
        }

        let values: string[];
        try {
          const parsed = JSON.parse(valuesJson) as unknown;
          if (!Array.isArray(parsed)) {
            return 0;
          }
          values = parsed.map((entry) => String(entry));
        } catch {
          return 0;
        }

        const filter: FilterCondition = {
          field,
          op,
          values
        };

        return matchFilter(getPath(record, field), filter) ? 1 : 0;
      }
    );

    this.db.function('mocy_sort_text_value', (data: string, field: string): string => {
      const record = parseDataRecord(data);
      if (!record) {
        return '';
      }

      return stringifyValue(getPath(record, field));
    });

    this.db.function('mocy_sort_numeric_value', (data: string, field: string): number | null => {
      const record = parseDataRecord(data);
      if (!record) {
        return null;
      }

      const numeric = asNumber(getPath(record, field));
      return Number.isFinite(numeric) ? numeric : null;
    });

    this.db.function('mocy_sort_numeric_rank', (data: string, field: string): number => {
      const record = parseDataRecord(data);
      if (!record) {
        return 1;
      }

      const numeric = asNumber(getPath(record, field));
      return Number.isFinite(numeric) ? 0 : 1;
    });
  }

  private ensureDirectory(dir: string): void {
    mkdirSync(dir, { recursive: true });
  }

  private generateUniqueId(resource: string): string {
    for (let attempt = 0; attempt < MAX_GENERATED_ID_ATTEMPTS; attempt += 1) {
      const candidate = this.generateCandidateId();
      if (!this.get(resource, candidate)) {
        return candidate;
      }
    }

    throw new Error(
      `Unable to generate unique id for resource "${resource}" after ${MAX_GENERATED_ID_ATTEMPTS} attempts`
    );
  }

  private generateCandidateId(): string {
    return this.idMode === 'compat' ? compatId() : safeId();
  }
}

interface IdGenerationContext {
  isTaken: (id: string) => boolean;
  nextId: () => string;
}

function normalizeRecord(
  value: JsonValue,
  fallbackId: string,
  idGeneration: IdGenerationContext
): { id: string; record: JsonObject } {
  if (isObject(value)) {
    if (value.id === undefined) {
      const id = generateUniqueImportId(idGeneration);
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

function generateUniqueImportId(context: IdGenerationContext): string {
  for (let attempt = 0; attempt < MAX_GENERATED_ID_ATTEMPTS; attempt += 1) {
    const candidate = context.nextId();
    if (!context.isTaken(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Unable to generate unique id during import after ${MAX_GENERATED_ID_ATTEMPTS} attempts`);
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

function parseDataRecord(value: string): JsonObject | null {
  try {
    const parsed = JSON.parse(value) as JsonValue;
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isFilterOperator(value: string): value is FilterCondition['op'] {
  return value === 'eq' || value === 'ne' || value === 'lt' || value === 'lte' || value === 'gt' || value === 'gte';
}

function matchFilter(value: JsonValue | undefined, filter: FilterCondition): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => matchFilter(entry, filter));
  }

  switch (filter.op) {
    case 'eq':
      return filter.values.some((candidate) => stringifyValue(value) === candidate);
    case 'ne':
      return filter.values.every((candidate) => stringifyValue(value) !== candidate);
    case 'lt':
      return filter.values.some((candidate) => compareComparable(value, candidate) < 0);
    case 'lte':
      return filter.values.some((candidate) => compareComparable(value, candidate) <= 0);
    case 'gt':
      return filter.values.some((candidate) => compareComparable(value, candidate) > 0);
    case 'gte':
      return filter.values.some((candidate) => compareComparable(value, candidate) >= 0);
    default:
      return false;
  }
}

function compareComparable(left: JsonValue | undefined, rightRaw: string): number {
  const leftNumber = asNumber(left);
  const rightNumber = Number(rightRaw);

  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }

  const leftString = stringifyValue(left);
  if (leftString < rightRaw) {
    return -1;
  }
  if (leftString > rightRaw) {
    return 1;
  }
  return 0;
}

function getPath(source: JsonValue, path: string): JsonValue | undefined {
  if (!path) {
    return source;
  }

  const parts = path.split('.');
  let current: JsonValue | undefined = source;

  for (const part of parts) {
    if (current === null || current === undefined || Array.isArray(current) || typeof current !== 'object') {
      return undefined;
    }
    current = current[part];
  }

  return current;
}

function stringifyValue(value: JsonValue | undefined): string {
  if (value === undefined) {
    return '';
  }
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function asNumber(value: JsonValue | undefined): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    return Number(value);
  }
  return Number.NaN;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function compatId(): string {
  return randomBytes(2).toString('hex');
}

function safeId(): string {
  return randomBytes(8).toString('hex');
}
