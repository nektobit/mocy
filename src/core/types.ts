export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface DbSchema {
  [resource: string]: JsonValue;
}

export interface ResourceRecord {
  id: string;
  value: JsonObject;
}

export interface ListQuery {
  q?: string | undefined;
  sort?: string[] | undefined;
  order?: Array<'asc' | 'desc'> | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
  start?: number | undefined;
  end?: number | undefined;
  limit?: number | undefined;
  filters: FilterCondition[];
}

export interface FilterCondition {
  field: string;
  op: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte';
  values: string[];
}

export interface ListResult<T> {
  data: T[];
  total: number;
  page?: number;
  perPage?: number;
}
