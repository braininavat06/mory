export function managedContent(path: string) {
  return /^src\/content\/(posts|pages)\/.+\.md$/.test(path)
    || path === 'src/data/categories.yaml' || path === 'src/data/series.yaml'
    || /^data\/series\/.+\.yaml$/.test(path);
}
