declare module 'json-server/lib/app.js' {
  import { IncomingMessage, ServerResponse } from 'node:http';

  export function createApp(
    db: { data: Record<string, unknown> | null },
    options?: Record<string, unknown>
  ): {
    handler(req: IncomingMessage, res: ServerResponse): void;
  };
}