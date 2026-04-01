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
  const data = await res.json();
  return data as T;
}

export async function postExchange<T>(body: object): Promise<T> {
  const res = await fetch(`${API_BASE}/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return data as T;
}
