export function signal(initialValue) {
  let value = initialValue;
  const subscribers = new Set();

  return {
    get() {
      return value;
    },
    set(nextValue) {
      if (Object.is(nextValue, value)) {
        return;
      }
      value = nextValue;
      for (const subscriber of subscribers) {
        subscriber(value);
      }
    },
    update(updater) {
      this.set(updater(value));
    },
    subscribe(subscriber, options = { emitImmediately: true }) {
      subscribers.add(subscriber);
      if (options.emitImmediately) {
        subscriber(value);
      }
      return () => subscribers.delete(subscriber);
    }
  };
}

export function computed(compute, dependencies) {
  const output = signal(compute());
  const recompute = () => output.set(compute());
  const disposers = dependencies.map((dependency) =>
    dependency.subscribe(recompute, { emitImmediately: false })
  );

  return {
    ...output,
    dispose() {
      for (const dispose of disposers) {
        dispose();
      }
    }
  };
}

export function effect(run, dependencies) {
  run();
  const disposers = dependencies.map((dependency) =>
    dependency.subscribe(() => {
      run();
    }, { emitImmediately: false })
  );

  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}
