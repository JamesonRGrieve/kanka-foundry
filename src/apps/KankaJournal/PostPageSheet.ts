import JournalEntryPageTextSheet = foundry.applications.sheets.journal.JournalEntryPageTextSheet;

import type { DeepPartial } from 'fvtt-types/utils';
import localization from '../../state/localization';
import type { JournalEntryPageSheetExt } from '../../types/journal-sheet-augments';
import replaceRecursiveMentions from '../../util/replaceMentions';

function assertType<T>(_value: unknown): asserts _value is T {}

// Cast helper for accessing runtime properties not yet typed in fvtt-types stubs
function ext(instance: PostPageSheet): JournalEntryPageSheetExt {
    const raw: unknown = instance;
    assertType<JournalEntryPageSheetExt>(raw);
    return raw;
}

// Get the parent prototype for calling super methods that aren't typed in the stubs
const parentProto: JournalEntryPageSheetExt = (() => {
    const cls: unknown = JournalEntryPageTextSheet;
    assertType<{ prototype: JournalEntryPageSheetExt }>(cls);
    return cls.prototype;
})();

export default class PostPageSheet extends JournalEntryPageTextSheet {
    static override DEFAULT_OPTIONS = {
        classes: ['kanka-post'],
    };

    static VIEW_PARTS = {
        content: {
            template: 'templates/journal/pages/text/view.hbs',
            root: true,
        },
    };

    override get isEditable(): false {
        return false;
    }

    async _prepareContentContext(context: Record<string, unknown>, _options: unknown): Promise<void> {
        const textRaw: unknown = context['text'];
        let text: { content: string; enriched?: string } | undefined;
        if (textRaw !== null && typeof textRaw === 'object' && 'content' in textRaw) {
            assertType<{ content: string; enriched?: string }>(textRaw);
            text = textRaw;
        }
        if (!text?.content) return;
        const doc = ext(this).document;
        context['owner'] = doc.isOwner;
        text.enriched = await replaceRecursiveMentions(text.content, {
            relativeTo: doc,
            secrets: doc.isOwner,
        });
    }

    override async _prepareContext(
        options: DeepPartial<foundry.applications.api.ApplicationV2.RenderOptions>,
    ): Promise<JournalEntryPageTextSheet.RenderContext> {
        const context = await parentProto._prepareContext.call(this, options);
        const nameRaw: unknown = context['name'];
        const name = typeof nameRaw === 'string' ? nameRaw : undefined;
        if (name?.startsWith('KANKA.')) {
            context['name'] = localization.localize(name);
        }
        const ctxRaw: unknown = context;
        assertType<JournalEntryPageTextSheet.RenderContext>(ctxRaw);
        return ctxRaw;
    }
}
