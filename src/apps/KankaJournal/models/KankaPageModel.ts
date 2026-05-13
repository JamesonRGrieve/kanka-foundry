import type Reference from '../../../types/Reference';

import DataSchema = foundry.data.fields.DataSchema;
import TypeDataModel = foundry.abstract.TypeDataModel;

// TypeDataModel requires BaseData/DerivedData type slots; we have no extra
// fields on top of the schema, so they're intentionally empty records.
// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace KankaPageModel {
    interface Schema extends DataSchema, ReturnType<(typeof KankaPageModel)['defineSchema']> {}
    type BaseData = Record<string, never>;
    type DerivedData = Record<string, never>;
}

class KankaPageModel extends TypeDataModel<KankaPageModel.Schema, JournalEntryPage> {
    static override defineSchema() {
        const { fields } = foundry.data;

        return {
            kankaId: new fields.NumberField({ required: true }),
            kankaEntityId: new fields.NumberField({ required: true }),
            campaignId: new fields.NumberField({ required: true }),
            type: new fields.StringField({ required: true, blank: false, trim: true }),
            name: new fields.StringField({ required: true, blank: false, trim: true }),
            img: new fields.StringField({ blank: false, trim: true }),
            version: new fields.StringField({ required: true, blank: false, trim: true }),
            snapshot: new fields.ObjectField<{ required: true; nullable: false }, Record<string, unknown>, Record<string, unknown>, Record<string, unknown>>({
                required: true,
                nullable: false,
            }),
            references: new fields.ObjectField<
                { required: true; nullable: false },
                Record<number, Reference>,
                Record<number, Reference>,
                Record<number, Reference>
            >({ required: true, nullable: false }),
            publicCount: new fields.NumberField({ required: false }),
            totalCount: new fields.NumberField({ required: false }),
        };
    }

    override prepareDerivedData(): void {
        const snapshot = this.snapshot;
        if (!snapshot['reminders'] && snapshot['entity_events']) {
            snapshot['reminders'] = snapshot['entity_events'];
        }
        if (this.type === 'journal' && !snapshot['author_id'] && snapshot['character_id']) {
            snapshot['author_id'] = snapshot['character_id'];
        }
        if (this.type === 'item' && !snapshot['creator_id'] && snapshot['character_id']) {
            snapshot['creator_id'] = snapshot['character_id'];
        }
    }
}

export { KankaPageModel };
