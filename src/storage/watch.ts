import chokidar from 'chokidar';

export interface FileWatcher {
  close(): Promise<void>;
}

export function watchFile(path: string, onChange: () => Promise<void>): FileWatcher {
  let timer: NodeJS.Timeout | undefined;
  const watcher = chokidar.watch(path, {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 250,
      pollInterval: 50
    }
  });

  watcher.on('change', () => {
    if (timer) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      void onChange();
    }, 150);
  });

  return {
    async close() {
      if (timer) {
        clearTimeout(timer);
      }
      await watcher.close();
    }
  };
}