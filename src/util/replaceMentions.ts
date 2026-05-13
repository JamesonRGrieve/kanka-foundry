import { findEntryByEntityId } from '../foundry/journalEntries';

type EnrichOptions = Parameters<typeof foundry.applications.ux.TextEditor.implementation.enrichHTML>[1];

function assertType<T>(_value: unknown): asserts _value is T {}

function replaceMentions(text: string): string {
    const el = $(`<div>${text}</div>`);

    el.find('a.entity-mention[data-id]').each((_, link): void => {
        const $link = $(link);
        const entityId = Number($link.data('id'));
        const label = $link.html();
        const journalEntry = findEntryByEntityId(entityId);

        if (journalEntry?.visible) {
            $link.replaceWith(journalEntry.link);
            return;
        }

        if (game.settings?.get('kanka-foundry', 'disableExternalMentionLinks')) {
            $link.replaceWith(label);
        }
    });

    return el.html();
}

function isObject(obj: unknown): obj is Record<string, unknown> {
    return typeof obj === 'object' && obj !== null;
}

export default async function replaceRecursiveMentions<T>(input: T, enrichOptions: EnrichOptions = {}): Promise<T> {
    if (typeof input === 'string') {
        const enriched: unknown = await foundry.applications.ux.TextEditor.implementation.enrichHTML(replaceMentions(input), {
            ...enrichOptions,
            links: false,
        });
        assertType<T>(enriched);
        return enriched;
    }

    if (Array.isArray(input)) {
        const results: unknown = await Promise.all(input.map(async (item: unknown) => replaceRecursiveMentions(item, enrichOptions)));
        assertType<T>(results);
        return results;
    }

    if (isObject(input)) {
        const newObject: Record<string, unknown> = {};
        await Promise.all(
            Object.keys(input).map(async (key) => {
                newObject[key] = await replaceRecursiveMentions(input[key], enrichOptions);
            }),
        );

        assertType<T>(newObject);
        return newObject;
    }

    return input;
}
