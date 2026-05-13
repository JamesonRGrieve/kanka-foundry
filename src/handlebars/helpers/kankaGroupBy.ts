import groupBy from '../../util/groupBy';

function assertType<T>(_value: unknown): asserts _value is T {}

type Args<T extends Record<string, unknown>> = Parameters<typeof groupBy<T>>;

export default function kankaGroupBy<T extends Record<string, unknown>>(data: Args<T>[0], property: string): Record<string, T[]> {
    const propRaw: unknown = property;
    assertType<Args<T>[1]>(propRaw);
    const groups = groupBy<T>(data ?? [], propRaw);
    return Object.fromEntries(groups.entries());
}
