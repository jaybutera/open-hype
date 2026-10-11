import { API_BASE } from '../../config/constants.ts';

export class HLApiError extends Error {
  constructor(public data: unknown) {
    super(typeof data === 'string' ? data : JSON.stringify(data));
    this.name = 'HLApiError';
  }
}

export async function postInfo<T>(body: object): Promise<T> {
  const res = await fetch(`${API_BASE}/info`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new HLApiError(`info ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data as T;
}
