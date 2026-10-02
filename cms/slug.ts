import { routeId } from '../src/lib/schema.ts';
import type { Draft } from './shared.ts';

export function postSlugWarning(slug: unknown, id: string, drafts: readonly Draft[]): string | null {
  if (typeof slug !== 'string' || !slug.trim()) return '글 주소 (slug)가 비어 있습니다. 게시 설정에서 주소를 입력해 주세요.';
  if (!routeId.safeParse(slug).success) return '글 주소 (slug)는 소문자 영문·숫자와 하이픈만 사용할 수 있습니다.';
  if (['oldest', 'updated', 'page'].includes(slug)) return '사이트에서 사용하는 예약 주소입니다. 다른 주소를 입력해 주세요.';
  if (drafts.some(d => d.kind === 'post' && d.id !== id && [d.value.data, d.published?.data].some(data => data && (data.slug === slug || data.aliases?.includes(slug)))))
    return '중복된 글 주소 (slug)입니다. 다른 글의 현재·이전 주소와 겹치지 않는 주소를 입력해 주세요.';
  return null;
}
