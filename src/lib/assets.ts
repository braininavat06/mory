// Provider-neutral object keys. No upload, deletion, or archive side effects.
export function assetUrl(filename: string, postId?: string, base = process.env.MORY_ASSET_BASE ?? '/fixtures'): string {
  const shared = filename.startsWith('shared/');
  const name = shared ? filename.slice(7) : filename;
  if (!name || name.split('/').some(part => !part || part === '.' || part === '..') || /[\\?#]/.test(name)) throw new Error(`잘못된 첨부파일 경로: ${filename}`);
  if (!shared && !postId) throw new Error(`Pages에서는 shared/ 첨부파일 경로를 사용하세요: ${filename}`);
  const key = shared ? `shared/${name}` : `posts/${postId}/${name}`;
  return `${base.replace(/\/$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

export const PUBLIC_ASSET_BASE = 'https://img.mory.place';
export interface AssetOwner { type: 'post' | 'page'; id: string }
export const managedImagePattern = /^mory-asset-([0-7][0-9A-HJKMNP-TV-Z]{25})\.(jpg|png|webp|gif)$/;
export function managedCandidate(filename: string): boolean { return filename.split('/').some(part=>part.startsWith('mory-asset-')); }
export function managedImage(filename: string): boolean { return managedImagePattern.test(filename); }
export function ownerKey(owner: AssetOwner, filename: string): string {
  if (!managedImage(filename) || (owner.type === 'post' ? !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(owner.id) : !['home', 'about'].includes(owner.id))) throw new Error('잘못된 이미지 참조입니다.');
  return `${owner.type === 'post' ? 'posts' : 'pages'}/${owner.id}/${filename}`;
}
export function resolveAssetUrl(filename: string, owner?: AssetOwner): string {
  if (managedCandidate(filename)) {
    if (!owner) throw new Error('이미지 소유 문서를 확인할 수 없습니다.');
    return `${PUBLIC_ASSET_BASE}/${ownerKey(owner, filename)}`;
  }
  return assetUrl(filename, owner?.type === 'post' ? owner.id : undefined);
}
