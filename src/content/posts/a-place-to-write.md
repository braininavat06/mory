---
id: 01K6F4J0M00000000000000001
title: 글을 남기는 작은 공간
slug: a-place-to-write
category: sample
publishedAt: 2026-09-29
updatedAt: 2026-10-01T22:01:10+09:00
status: archived
description: Markdown으로 글을 쓰고, 관심을 따라 기록을 쌓아가는 공간. 기능 검증을 위한 샘플 글입니다.
aliases:
  - first-note
---
이 글은 **Mory의 동작을 확인하기 위한 샘플**입니다. 내용과 분류는 실제 글을 준비하면서 바꿔주세요. 바꿀겁니다.

## 기록의 시작입니다

분야를 정해두기보다, 그때의 관심을 글로 남겨두려 합니다. *작은 기록*도 시간이 지나면 ==다시 읽을 이유==가 됩니다.[^record]

> [!note]
> 이 문서는 Markdown과 Obsidian 확장을 함께 확인합니다. 확인해주세요.

### 이어지는 글입니다

[[markdown-notes|다음 샘플 글]]로 이동할 수 있습니다. URL은 제목과 독립적인 slug를 사용합니다.

## 다양한 표현

- **굵게**, *기울임*, ~~취소선~~
- [x] 글 작성. 체크박스는 신기하긴 하네
- [ ] 다음 기록 준비

> 평범한 인용문도 그대로 쓸 수 있습니다.

| 요소 | 용도 |
| --- | --- |
| Markdown | 본문 |
| YAML | 메타데이터 |

```typescript
const writing = 'Mory';
console.log(writing);
```

인라인 수식 $E = mc^2$와 블록 수식도 지원합니다.

$$
\sum_{i=1}^{n} i = \frac{n(n+1)}{2}
$$

## 첨부파일

아래 파일은 로컬 renderer 검증용 fixture입니다.

![[image.webp|600]]

![[demo.mp4]]

## 외부 영상

https://www.youtube.com/watch?v=M7lc1UVf-VE

[영상 보기](https://www.youtube.com/watch?v=M7lc1UVf-VE)는 일반 링크를 유지합니다.

https://example.com/unsupported-video

[^record]: 각주는 본문 끝에 표시됩니다.
