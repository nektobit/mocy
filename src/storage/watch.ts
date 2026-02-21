import chokidar from 'chokidar';

export interface FileWatcher {
  close(): Promise<void>;
}

export function watchFile(path: string, onChange: () => Promise<void>): FileWatcher {
  const watcher = chokidar.watch(path, {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 250,
      pollInterval: 50
    }
  });

  watcher.on('change', () => {
    void onChange();
  });

  return {
    async close() {
      await watcher.close();
    }
  };
}
