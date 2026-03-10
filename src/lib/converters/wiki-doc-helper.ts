import type { RecipeStack, EntryRef, WikiDocRef } from './types.ts';
import type { ConverterContext } from './context.ts';

export function uniqueRelatedStacks(
  ctx: ConverterContext,
  entries: EntryRef[],
  targetItemId: string,
  limit = 12,
): RecipeStack[] {
  const map = new Map<string, RecipeStack>();
  for (const entry of entries) {
    const wikiId = String(entry.id || '').trim();
    if (!wikiId || wikiId === targetItemId) continue;
    const nameHint = ctx.getItemNameByWikiId(wikiId);
    const stack = ctx.createStackFromEntry(
      {
        id: wikiId,
        count: entry.count > 0 ? entry.count : 1,
      },
      nameHint,
    );
    if (!stack) continue;
    const existing = map.get(stack.id);
    if (existing) existing.amount += stack.amount;
    else map.set(stack.id, stack);
  }
  return Array.from(map.values()).slice(0, limit);
}

export function makeDocParams(mode: 'source' | 'usage', ref: WikiDocRef): Record<string, unknown> {
  return {
    sectionType: mode,
    title: `${ref.chapterTitle}${ref.widgetTitle ? ` / ${ref.widgetTitle}` : ''}`,
    context: {
      groupTitle: ref.chapterTitle,
      widgetTitle: ref.widgetTitle,
      panelTitle: ref.tabTitle,
    },
    wikiDoc: ref.doc,
  };
}
