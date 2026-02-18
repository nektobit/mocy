export type RouteMap = Record<string, string>;

export function rewriteUrl(pathname: string, map: RouteMap): string {
  for (const [pattern, target] of Object.entries(map)) {
    const rewritten = matchAndRewrite(pathname, pattern, target);
    if (rewritten) {
      return rewritten;
    }
  }

  return pathname;
}

function matchAndRewrite(pathname: string, pattern: string, target: string): string | null {
  const keys: string[] = [];
  const regex = new RegExp(
    `^${pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\\\*/g, '(.*)')
      .replace(/:(\w+)/g, (_, key: string) => {
        keys.push(key);
        return '([^/]+)';
      })}$`
  );

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