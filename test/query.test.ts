import { describe, expect, it } from 'vitest';
import { applyListQuery, parseListQuery } from '../src/core/query.js';

const rows = [
  { id: 1, title: 'hello', views: 12, active: true, tags: ['news', 'tech'] },
  { id: 2, title: 'world', views: 5, active: false, tags: ['life'] },
  { id: 3, title: 'hello again', views: 40, active: true, tags: ['tech'] }
];

describe('query parser', () => {
  it('parses sort and filters', () => {
    const parsed = parseListQuery({
      _sort: 'views,title',
      _order: 'desc,asc',
      title: 'hello',
      views_gte: '10'
    });

    expect(parsed.sort).toEqual(['views', 'title']);
    expect(parsed.order).toEqual(['desc', 'asc']);
    expect(parsed.filters).toEqual([
      { field: 'title', op: 'eq', values: ['hello'] },
      { field: 'views', op: 'gte', values: ['10'] }
    ]);
  });
});

describe('query execution', () => {
  it('applies filtering operators', () => {
    const result = applyListQuery(rows, parseListQuery({ views_gte: '10', views_lt: '20' }));
    expect(result.data.map((entry) => entry.id)).toEqual([1]);
  });

  it('applies full-text search', () => {
    const result = applyListQuery(rows, parseListQuery({ q: 'again' }));
    expect(result.data.map((entry) => entry.id)).toEqual([3]);
  });

  it('applies sorting and pagination', () => {
    const result = applyListQuery(
      rows,
      parseListQuery({ _sort: 'views', _order: 'desc', _page: '1', _per_page: '2' })
    );

    expect(result.total).toBe(3);
    expect(result.page).toBe(1);
    expect(result.perPage).toBe(2);
    expect(result.data.map((entry) => entry.id)).toEqual([3, 1]);
  });

  it('matches array filter values', () => {
    const result = applyListQuery(rows, parseListQuery({ tags: 'tech' }));
    expect(result.data.map((entry) => entry.id)).toEqual([1, 3]);
  });
});