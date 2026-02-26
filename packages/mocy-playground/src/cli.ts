#!/usr/bin/env node
import {
  DEFAULT_PLAYGROUND_HOST,
  DEFAULT_PLAYGROUND_PORT,
  startPlaygroundServer,
  type RunningPlaygroundServer
} from './server.js';

interface CliOptions {
  apiBaseUrl: string;
  host: string;
  port: number;
}

const USAGE = `
Usage: mocy-playground [options]

Options:
  --api <url>     mocy API base URL (default: http://localhost:3000)
  --host <host>   playground host (default: 127.0.0.1)
  --port <port>   playground port (default: 4173)
  -h, --help      show this help
`;

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const running = await startPlaygroundServer({
    apiBaseUrl: options.apiBaseUrl,
    host: options.host,
    port: options.port
  });

  process.stdout.write(`mocy-playground is running at ${running.url}\n`);
  process.stdout.write(`Connected API base URL: ${options.apiBaseUrl}\n`);

  registerShutdown(running);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    apiBaseUrl: 'http://localhost:3000',
    host: DEFAULT_PLAYGROUND_HOST,
    port: DEFAULT_PLAYGROUND_PORT
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '-h' || token === '--help') {
      process.stdout.write(USAGE);
      process.exit(0);
    }

    if (token === '--api') {
      options.apiBaseUrl = requireValue(argv, ++index, '--api');
      continue;
    }

    if (token === '--host') {
      options.host = requireValue(argv, ++index, '--host');
      continue;
    }

    if (token === '--port') {
      const rawPort = requireValue(argv, ++index, '--port');
      const port = Number.parseInt(rawPort, 10);
      if (!Number.isFinite(port) || Number.isNaN(port) || port <= 0 || port > 65535) {
        throw new Error(`Invalid port "${rawPort}"`);
      }
      options.port = port;
      continue;
    }

    throw new Error(`Unknown argument "${token}"`);
  }

  return options;
}

function requireValue(argv: string[], index: number, flagName: string): string {
  const value = argv[index];
  if (!value || value.startsWith('-')) {
    throw new Error(`Missing value for ${flagName}`);
  }
  return value;
}

function registerShutdown(running: RunningPlaygroundServer): void {
  let closing = false;

  const shutdown = (signal: NodeJS.Signals): void => {
    if (closing) {
      return;
    }
    closing = true;

    void running
      .close()
      .catch((error: unknown) => {
        process.stderr.write(`Failed to close playground server: ${(error as Error).message}\n`);
      })
      .finally(() => {
        process.exit(signal === 'SIGINT' ? 130 : 0);
      });
  };

  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.stderr.write(USAGE);
  process.exitCode = 1;
});
