import { FilterCondition, JsonObject, JsonValue, ListQuery, ListResult } from './types.js';

const RESERVED_PARAMS = new Set([
  '_sort',
  '_order',
  '_page',
  '_per_page',
  '_limit',
  '_start',
  '_end',
  'q'
]);

const OP_SUFFIXES: Array<{ suffix: string; op: FilterCondition['op'] }> = [
  { suffix: '_ne', op: 'ne' },
  { suffix: '_lt', op: 'lt' },
  { suffix: '_lte', op: 'lte' },
  { suffix: '_gt', op: 'gt' },
  { suffix: '_gte', op: 'gte' }
];

export function parseListQuery(raw: Record<string, string | string[] | undefined>): ListQuery {
  const filters: FilterCondition[] = [];

  for (const [key, rawValue] of Object.entries(raw)) {
    if (rawValue === undefined || RESERVED_PARAMS.has(key)) {
      continue;
    }

    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    let field = key;
    let op: FilterCondition['op'] = 'eq';

    for (const candidate of OP_SUFFIXES) {
      if (key.endsWith(candidate.suffix)) {
        field = key.slice(0, -candidate.suffix.length);
        op = candidate.op;
        break;
      }
    }

    filters.push({ field, op, values });
  }

  const sort = csv(raw._sort);
  const order = csv(raw._order).map((value) => (value.toLowerCase() === 'desc' ? 'desc' : 'asc'));

  return {
    q: first(raw.q),
    sort: sort.length > 0 ? sort : undefined,
    order: order.length > 0 ? order : undefined,
    page: parseIntMaybe(first(raw._page)),
    perPage: parseIntMaybe(first(raw._per_page)),
    start: parseIntMaybe(first(raw._start)),
    end: parseIntMaybe(first(raw._end)),
    limit: parseIntMaybe(first(raw._limit)),
    filters
  };
}

export function applyListQuery<T extends JsonObject>(rows: T[], query: ListQuery): ListResult<T> {
  let data = rows.filter((row) => passesFilters(row, query.filters));

  if (query.q) {
    const term = query.q.toLowerCase();
    data = data.filter((row) => JSON.stringify(row).toLowerCase().includes(term));
  }

  if (query.sort && query.sort.length > 0) {
    const order = query.order ?? [];
    data = [...data].sort((a, b) => compareRows(a, b, query.sort ?? [], order));
  }

  const total = data.length;

  if (query.page !== undefined) {
    const page = Math.max(1, query.page);
    const perPage = Math.max(1, query.perPage ?? query.limit ?? 10);
    const start = (page - 1) * perPage;
    const end = start + perPage;
    return {
      data: data.slice(start, end),
      total,
      page,
      perPage
    };
  }

  if (query.start !== undefined || query.end !== undefined) {
    const start = Math.max(0, query.start ?? 0);
    const end = query.end !== undefined ? Math.max(start, query.end) : undefined;
    data = data.slice(start, end);
  }

  if (query.limit !== undefined) {
    data = data.slice(0, Math.max(0, query.limit));
  }

  return { data, total };
}

function passesFilters(row: JsonObject, filters: FilterCondition[]): boolean {
  return filters.every((filter) => {
    const value = getPath(row, filter.field);
    return matchFilter(value, filter);
  });
}

function matchFilter(value: JsonValue | undefined, filter: FilterCondition): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => matchFilter(entry, filter));
  }

  switch (filter.op) {
    case 'eq':
      return filter.values.some((candidate) => stringify(value) === candidate);
    case 'ne':
      return filter.values.every((candidate) => stringify(value) !== candidate);
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

  const leftString = stringify(left);
  if (leftString < rightRaw) {
    return -1;
  }
  if (leftString > rightRaw) {
    return 1;
  }
  return 0;
}

function compareRows(
  a: JsonObject,
  b: JsonObject,
  sortFields: string[],
  order: Array<'asc' | 'desc'>
): number {
  for (let index = 0; index < sortFields.length; index += 1) {
    const field = sortFields[index] ?? 'id';
    const direction = order[index] ?? order[0] ?? 'asc';
    const left = getPath(a, field);
    const right = getPath(b, field);
    const compared = compareComparable(left, stringify(right));

    if (compared !== 0) {
      return direction === 'desc' ? -compared : compared;
    }
  }

  return compareComparable(getPath(a, 'id'), stringify(getPath(b, 'id')));
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

function stringify(value: JsonValue | undefined): string {
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

function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function csv(value: string | string[] | undefined): string[] {
  const input = first(value);
  if (!input) {
    return [];
  }

  return input
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseIntMaybe(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
