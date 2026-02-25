import { describe, expect, it } from 'vitest';
import { compileRouteMap, rewriteUrl } from '../src/http/rewrite.js';

describe('route rewrite compilation', () => {
  it('rewrites named params and wildcard captures', () => {
    const routes = compileRouteMap({
      '/api/:resource/:id': '/:resource/$2',
      '/legacy/*': '/v1/$1'
    });

    expect(rewriteUrl('/api/posts/10', routes)).toBe('/posts/10');
    expect(rewriteUrl('/legacy/posts/10/comments', routes)).toBe('/v1/posts/10/comments');
  });

  it('returns original pathname when no rules match', () => {
    const routes = compileRouteMap({
      '/api/:resource/:id': '/:resource/$2'
    });

    expect(rewriteUrl('/health', routes)).toBe('/health');
  });
});

describe('route rewrite validation', () => {
  it('rejects patterns without leading slash', () => {
    expect(() => compileRouteMap({ 'api/:id': '/posts/:id' })).toThrow(
      'Invalid route pattern "api/:id": must start with "/"'
    );
  });

  it('rejects invalid named parameters', () => {
    expect(() => compileRouteMap({ '/api/:/id': '/posts/:id' })).toThrow(
      'Invalid route pattern "/api/:/id": contains invalid named parameter'
    );
  });

  it('rejects excessive wildcard count', () => {
    expect(() => compileRouteMap({ '/a/*/*/*/*/*': '/x/$1' })).toThrow(
      'Invalid route pattern "/a/*/*/*/*/*": exceeds wildcard limit (4)'
    );
  });

  it('rejects whitespace in route patterns', () => {
    expect(() => compileRouteMap({ '/bad path': '/x' })).toThrow(
      'Invalid route pattern "/bad path": must not contain whitespace'
    );
  });

  it('rejects overly long patterns', () => {
    const longPattern = `/${'a'.repeat(300)}`;
    expect(() => compileRouteMap({ [longPattern]: '/x' })).toThrow(
      `Invalid route pattern "${longPattern}": exceeds max length (256)`
    );
  });
});
