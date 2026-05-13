import JournalEntryPageHandlebarsSheet = foundry.applications.sheets.journal.JournalEntryPageHandlebarsSheet;

import type { DeepPartial } from 'fvtt-types/utils';
import localization from '../../state/localization';
import type { JournalEntryPageSheetExt } from '../../types/journal-sheet-augments';
import getImprovedReference from '../../util/getImprovedReference';
import replaceRecursiveMentions from '../../util/replaceMentions';
import type { KankaPageModel } from './models/KankaPageModel';

function assertType<T>(_value: unknown): asserts _value is T {}

type SystemData = foundry.data.fields.SchemaField.InitializedData<KankaPageModel.Schema>;

const templatesRaw = import.meta.glob('./pages/*.hbs', { eager: true });
assertType<Record<string, { default: string }>>(templatesRaw);
const templates: Record<string, { default: string }> = templatesRaw;

// Cast helper for accessing runtime properties not yet typed in fvtt-types stubs
function ext(instance: DefaultPageSheet): JournalEntryPageSheetExt {
    const raw: unknown = instance;
    assertType<JournalEntryPageSheetExt>(raw);
    return raw;
}

// Get the parent prototype for calling super methods that aren't typed in the stubs
const parentProto: JournalEntryPageSheetExt = (() => {
    const cls: unknown = JournalEntryPageHandlebarsSheet;
    assertType<{ prototype: JournalEntryPageSheetExt }>(cls);
    return cls.prototype;
})();

export default class DefaultPageSheet extends JournalEntryPageHandlebarsSheet {
    override get isEditable(): false {
        return false;
    }

    override _configureRenderParts(
        _options: foundry.applications.api.HandlebarsApplicationMixin.RenderOptions,
    ): Record<string, foundry.applications.api.HandlebarsApplicationMixin.HandlebarsTemplatePart> {
        return {
            content: {
                template: this.#resolveTemplate(),
                root: true,
            },
        };
    }

    async _prepareContentContext(context: Record<string, unknown>, _options: unknown): Promise<void> {
        const doc = ext(this).document;
        const systemRaw: unknown = doc.system;
        assertType<SystemData>(systemRaw);
        const system: SystemData = systemRaw;
        const references = { ...system.references };

        await Promise.all(
            Object.keys(references).map(async (id) => {
                const key = Number(id);
                const ref = references[key];
                if (ref) references[key] = await getImprovedReference(ref);
            }),
        );

        const snapshot = await replaceRecursiveMentions(system.snapshot, {
            relativeTo: doc,
            secrets: doc.isOwner,
        });

        const parentsVal: unknown = snapshot['parents'];
        if (Array.isArray(parentsVal)) {
            const parents: unknown[] = Array.from(parentsVal as unknown[]);
            parents.reverse();
            snapshot['parents'] = parents;
        }

        context['owner'] = doc.isOwner;
        context['data'] = {
            name: context['name'],
            system: {
                ...system,
                snapshot,
                references,
            },
        };
    }

    override async _prepareContext(
        options: DeepPartial<foundry.applications.api.ApplicationV2.RenderOptions>,
    ): Promise<JournalEntryPageHandlebarsSheet.RenderContext> {
        const context = await parentProto._prepareContext.call(this, options);
        const nameRaw: unknown = context['name'];
        const name = typeof nameRaw === 'string' ? nameRaw : undefined;
        if (name?.startsWith('KANKA.')) {
            context['name'] = localization.localize(name);
        }
        const ctxRaw: unknown = context;
        assertType<JournalEntryPageHandlebarsSheet.RenderContext>(ctxRaw);
        return ctxRaw;
    }

    #resolveTemplate(): string {
        const doc = ext(this).document;
        const systemR: unknown = doc.system;
        assertType<SystemData>(systemR);
        const system: SystemData = systemR;
        const entityType = system.type ?? 'common';
        const pageType = doc.type.split('.')[1];
        const template = templates[`./pages/${entityType}-${pageType}.hbs`] ?? templates[`./pages/common-${pageType}.hbs`];

        return template?.default ?? `./pages/${entityType}-${pageType}.hbs`;
    }
}
