// Provider-neutral object keys. No upload, deletion, or archive side effects.
export function assetUrl(filename: string, postId?: string, base = process.env.MORY_ASSET_BASE ?? '/fixtures'): string {
  const shared = filename.startsWith('shared/');
  const name = shared ? filename.slice(7) : filename;
  if (!name || name.split('/').some(part => !part || part === '.' || part === '..') || /[\\?#]/.test(name)) throw new Error(`잘못된 첨부파일 경로: ${filename}`);
  if (!shared && !postId) throw new Error(`Pages에서는 shared/ 첨부파일 경로를 사용하세요: ${filename}`);
  const key = shared ? `shared/${name}` : `posts/${postId}/${name}`;
  return `${base.replace(/\/$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`;
}
