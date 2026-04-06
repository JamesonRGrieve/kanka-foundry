// Migrate from old journal entry format to new page based format
export default async function migrate(): Promise<void> {
    const journals = Array.from(game.journal?.values() ?? []).filter((e) => e.getFlag('kanka-foundry', 'id'));

    for (const entry of journals) {
        const pages = Array
            .from(entry.pages.values())
            .filter((page) => ['kanka-foundry.character-profile'].includes(page.type));

        await entry.updateEmbeddedDocuments('JournalEntryPage', pages.map((page) => {
            const sys = page.system as unknown as Record<string, Record<string, unknown>>;
            const personality = sys.snapshot.personality as { entry_parsed?: string; entry?: string }[];
            return {
                _id: page._id,
                system: {
                    snapshot: {
                        ...sys.snapshot,
                        personality: personality.map((p) => ({ ...p, entry_parsed: p.entry_parsed ?? p.entry })),
                    },
                },
            };
        }) as JournalEntryPage.UpdateData[]);
    }
}
