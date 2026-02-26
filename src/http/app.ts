import express, { Response } from 'express';
import path from 'node:path';
import { parseListQuery } from '../core/query.js';
import { JsonObject } from '../core/types.js';
import { SqliteStore } from '../storage/sqliteStore.js';
import { compileRouteMap, RouteMap, rewriteUrl } from './rewrite.js';

export interface RequestLogEntry {
  method: string;
  path: string;
  status: number;
  durationMs: number;
}

export interface AppOptions {
  routeMap?: RouteMap;
  staticDir?: string;
  playgroundDir?: string;
  requestLogger?: (entry: RequestLogEntry) => void;
  plugins?: Array<(app: express.Express) => void>;
}

export function createApp(store: SqliteStore, options: AppOptions = {}): express.Express {
  const app = express();
  const compiledRoutes = options.routeMap ? compileRouteMap(options.routeMap) : undefined;
  const requestLogger = options.requestLogger;

  app.use(express.json({ limit: '10mb' }));
  if (requestLogger) {
    app.use((req, res, next) => {
      const startedAt = process.hrtime.bigint();
      res.on('finish', () => {
        const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        requestLogger({
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          durationMs: elapsedMs
        });
      });
      next();
    });
  }

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    if (compiledRoutes && !req.path.startsWith('/playground')) {
      req.url = rewriteUrl(req.path, compiledRoutes) + (req.url.includes('?') ? `?${req.url.split('?')[1]}` : '');
    }

    next();
  });

  if (options.staticDir) {
    app.use(express.static(options.staticDir));
  }

  if (options.playgroundDir) {
    const playgroundDir = path.resolve(options.playgroundDir);
    const playgroundIndexPath = path.join(playgroundDir, 'index.html');

    app.get('/playground/config.json', (req, res) => {
      const protocol = req.protocol || 'http';
      const host = req.get('host');
      if (!host) {
        res.status(500).json({ error: 'Unable to resolve request host' });
        return;
      }
      res.json({ apiBaseUrl: `${protocol}://${host}` });
    });

    app.get('/playground', (_req, res) => {
      res.sendFile(playgroundIndexPath);
    });

    app.use(
      '/playground',
      express.static(playgroundDir, {
        index: 'index.html'
      })
    );
  }

  options.plugins?.forEach((plugin) => {
    plugin(app);
  });

  app.get('/', (_req, res) => {
    res.json({
      resources: store.listResources()
    });
  });

  app.get('/:resource', (req, res) => {
    const { resource } = req.params;
    if (!resource) {
      notFound(res);
      return;
    }

    if (store.hasCollection(resource)) {
      const query = parseListQuery(req.query as Record<string, string | string[] | undefined>);
      const result = store.queryCollection(resource, query);

      if (result.page !== undefined && result.perPage !== undefined) {
        const pages = Math.max(1, Math.ceil(result.total / result.perPage));
        const pageResponse = {
          first: 1,
          prev: result.page > 1 ? result.page - 1 : null,
          next: result.page < pages ? result.page + 1 : null,
          last: pages,
          pages,
          items: result.total,
          data: result.data
        };
        res.json(pageResponse);
        return;
      }

      res.json(result.data);
      return;
    }

    const singular = store.getSingular(resource);
    if (singular) {
      res.json(singular);
      return;
    }

    notFound(res);
  });

  app.get('/:resource/:id', (req, res) => {
    const { resource, id } = req.params;
    if (!resource || !id) {
      notFound(res);
      return;
    }

    const row = store.get(resource, id);
    if (!row) {
      notFound(res);
      return;
    }

    res.json(row);
  });

  app.post('/:resource', (req, res) => {
    const { resource } = req.params;
    if (!resource || !store.hasCollection(resource)) {
      notFound(res);
      return;
    }

    if (!isObject(req.body)) {
      res.status(400).json({ error: 'Body must be an object' });
      return;
    }

    try {
      const created = store.create(resource, req.body);
      res.setHeader('Location', `/${resource}/${String(created.id)}`);
      res.status(201).json(created);
    } catch (error) {
      res.status(409).json({ error: (error as Error).message });
    }
  });

  app.put('/:resource/:id', (req, res) => {
    const { resource, id } = req.params;
    if (!resource || !id) {
      notFound(res);
      return;
    }

    if (store.hasCollection(resource)) {
      if (!isObject(req.body)) {
        res.status(400).json({ error: 'Body must be an object' });
        return;
      }
      const updated = store.replace(resource, id, req.body);
      if (!updated) {
        notFound(res);
        return;
      }
      res.json(updated);
      return;
    }

    if (!isObject(req.body)) {
      res.status(400).json({ error: 'Body must be an object' });
      return;
    }

    res.json(store.replaceSingular(resource, req.body));
  });

  app.patch('/:resource/:id', (req, res) => {
    const { resource, id } = req.params;
    if (!resource || !id || !store.hasCollection(resource)) {
      notFound(res);
      return;
    }

    if (!isObject(req.body)) {
      res.status(400).json({ error: 'Body must be an object' });
      return;
    }

    const updated = store.patch(resource, id, req.body);
    if (!updated) {
      notFound(res);
      return;
    }

    res.json(updated);
  });

  app.patch('/:resource', (req, res) => {
    const { resource } = req.params;
    if (!resource || !store.hasSingular(resource)) {
      notFound(res);
      return;
    }

    if (!isObject(req.body)) {
      res.status(400).json({ error: 'Body must be an object' });
      return;
    }

    res.json(store.patchSingular(resource, req.body));
  });

  app.delete('/:resource/:id', (req, res) => {
    const { resource, id } = req.params;
    if (!resource || !id || !store.hasCollection(resource)) {
      notFound(res);
      return;
    }

    const removed = store.delete(resource, id);
    if (!removed) {
      notFound(res);
      return;
    }

    res.json(removed);
  });

  app.delete('/:resource', (req, res) => {
    const { resource } = req.params;
    if (!resource || !store.hasSingular(resource)) {
      notFound(res);
      return;
    }

    const removed = store.deleteSingular(resource);
    if (!removed) {
      notFound(res);
      return;
    }

    res.json(removed);
  });

  app.use((_req, res) => {
    notFound(res);
  });

  return app;
}

function isObject(input: unknown): input is JsonObject {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function notFound(res: Response): void {
  res.status(404).json({});
}
