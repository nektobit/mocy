export type RouteMap = Record<string, string>;

interface CompiledRoute {
  target: string;
  keys: string[];
  regex: RegExp;
}

const MAX_PATTERN_LENGTH = 256;
const MAX_WILDCARDS = 4;
const MAX_PARAMS = 16;

export function compileRouteMap(map: RouteMap): CompiledRoute[] {
  return Object.entries(map).map(([pattern, target]) => compileRoute(pattern, target));
}

export function rewriteUrl(pathname: string, routes: CompiledRoute[]): string {
  for (const route of routes) {
    const rewritten = matchAndRewrite(pathname, route);
    if (rewritten) {
      return rewritten;
    }
  }

  return pathname;
}

function compileRoute(pattern: string, target: string): CompiledRoute {
  validatePattern(pattern);
  const keys: string[] = [];
  let wildcards = 0;
  let params = 0;
  let source = '';

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (!char) {
      continue;
    }

    if (char === '*') {
      wildcards += 1;
      if (wildcards > MAX_WILDCARDS) {
        throw invalidPattern(pattern, `exceeds wildcard limit (${MAX_WILDCARDS})`);
      }
      source += '(.*)';
      continue;
    }

    if (char === ':') {
      const match = pattern.slice(index + 1).match(/^[A-Za-z_][A-Za-z0-9_]*/);
      if (!match) {
        throw invalidPattern(pattern, 'contains invalid named parameter');
      }

      const key = match[0];
      params += 1;
      if (params > MAX_PARAMS) {
        throw invalidPattern(pattern, `exceeds named parameter limit (${MAX_PARAMS})`);
      }
      keys.push(key);
      source += '([^/]+)';
      index += key.length;
      continue;
    }

    source += escapeRegexCharacter(char);
  }

  return {
    target,
    keys,
    regex: new RegExp(`^${source}$`)
  };
}

function validatePattern(pattern: string): void {
  if (!pattern.startsWith('/')) {
    throw invalidPattern(pattern, 'must start with "/"');
  }

  if (pattern.length === 0) {
    throw invalidPattern(pattern, 'must not be empty');
  }

  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw invalidPattern(pattern, `exceeds max length (${MAX_PATTERN_LENGTH})`);
  }

  if (/\s/u.test(pattern)) {
    throw invalidPattern(pattern, 'must not contain whitespace');
  }
}

function invalidPattern(pattern: string, reason: string): Error {
  return new Error(`Invalid route pattern "${pattern}": ${reason}`);
}

function escapeRegexCharacter(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

function matchAndRewrite(pathname: string, route: CompiledRoute): string | null {
  const { keys, target, regex } = route;

  const match = pathname.match(regex);
  if (!match) {
    return null;
  }

  let output = target;
  keys.forEach((key, index) => {
    output = output.replace(`:${key}`, decodeURIComponent(match[index + 1] ?? ''));
  });

  for (let wildcardIndex = 1; wildcardIndex < match.length; wildcardIndex += 1) {
    output = output.replace(`$${wildcardIndex}`, decodeURIComponent(match[wildcardIndex] ?? ''));
  }

  return output;
}
