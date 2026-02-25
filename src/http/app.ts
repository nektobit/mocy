import express, { Response } from 'express';
import { parseListQuery } from '../core/query.js';
import { JsonObject } from '../core/types.js';
import { SqliteStore } from '../storage/sqliteStore.js';
import { compileRouteMap, RouteMap, rewriteUrl } from './rewrite.js';

export interface AppOptions {
  routeMap?: RouteMap;
  staticDir?: string;
  plugins?: Array<(app: express.Express) => void>;
}

export function createApp(store: SqliteStore, options: AppOptions = {}): express.Express {
  const app = express();
  const compiledRoutes = options.routeMap ? compileRouteMap(options.routeMap) : undefined;

  app.use(express.json({ limit: '10mb' }));
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    if (compiledRoutes) {
      req.url = rewriteUrl(req.path, compiledRoutes) + (req.url.includes('?') ? `?${req.url.split('?')[1]}` : '');
    }

    next();
  });

  if (options.staticDir) {
    app.use(express.static(options.staticDir));
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
