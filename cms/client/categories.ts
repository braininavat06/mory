export type CategoryRegistry = Record<string, { name: string; order: number }>;
export function orderedCategories(data: CategoryRegistry) {
  return Object.entries(data).sort((a, b) => a[1].order - b[1].order || a[0].localeCompare(b[0], 'en'));
}
export function moveCategory(data: CategoryRegistry, id: string, direction: -1 | 1): CategoryRegistry {
  const entries = orderedCategories(data), index = entries.findIndex(([key]) => key === id), target = index + direction;
  if (index < 0 || target < 0 || target >= entries.length) return data;
  [entries[index], entries[target]] = [entries[target], entries[index]];
  return Object.fromEntries(entries.map(([key, category], i) => [key, { ...category, order: (i + 1) * 10 }]));
}
