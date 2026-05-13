function assertType<T>(_value: unknown): asserts _value is T {}

const cachedArguments = new Map<string, never[]>();

export default function hmrWrapHook<K extends Hooks.HookName>(hook: K, getCb: () => Hooks.Function<K>, type: 'on' | 'once' = 'on'): () => void {
    const rawHandler = (...args: never[]): void => {
        cachedArguments.set(hook, args);
        const cb: unknown = getCb();
        assertType<(...a: never[]) => void>(cb);
        cb(...args);
    };
    assertType<Hooks.Function<K>>(rawHandler);
    const eventHandler = rawHandler;

    if (type === 'once') Hooks.once(hook, eventHandler);
    else if (type === 'on') Hooks.on(hook, eventHandler);

    return () => {
        const args = cachedArguments.get(hook) ?? [];
        const cb: unknown = getCb();
        assertType<(...a: never[]) => void>(cb);
        cb(...args);
    };
}
