export async function api<T>(path: string, method = 'GET', value?: unknown): Promise<T> {
  const response = await fetch(path, { method, headers: value === undefined ? {} : { 'Content-Type': 'application/json' }, body: value === undefined ? undefined : JSON.stringify(value) });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error ?? '서버에 연결하지 못했습니다.'), { status: response.status });
  return result;
}
