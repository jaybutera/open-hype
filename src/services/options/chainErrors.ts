export type ChainErrorKind =
  | 'not_found'
  | 'rate_limited'
  | 'network'
  | 'upstream'
  | 'parse'
  | 'unknown';

export interface ChainFetchErrorShape {
  kind: ChainErrorKind;
  status?: number;
  message: string;
}

export class ChainFetchError extends Error {
  readonly kind: ChainErrorKind;
  readonly status?: number;
  constructor(params: ChainFetchErrorShape) {
    super(params.message);
    this.name = 'ChainFetchError';
    this.kind = params.kind;
    this.status = params.status;
  }
}

function looksLikeRateLimit(text: string, status?: number): boolean {
  if (status === 429) return true;
  const t = text.toLowerCase();
  return (
    t.includes('rate') && (t.includes('limit') || t.includes('limited'))
  ) || t.includes('too many requests');
}

function looksLikeNotFound(text: string, status?: number): boolean {
  if (status === 404) return true;
  const t = text.toLowerCase();
  return t.includes('not found') || t.includes('no data') || t.includes('no options');
}

/**
 * Upstream /api/options/:symbol returns `{ error, cause }` with status 502 on
 * handshake/upstream failures. Map the embedded Yahoo status to a richer kind
 * when possible.
 */
export function classifyChainError(params: {
  status?: number;
  body?: unknown;
  thrown?: unknown;
}): ChainFetchError {
  const { status, body, thrown } = params;
  const bodyMsg = extractBodyMessage(body);
  const thrownMsg = thrown instanceof Error ? thrown.message : thrown ? String(thrown) : '';
  const combined = [bodyMsg, thrownMsg].filter(Boolean).join(' | ');

  // Embedded upstream status from proxy message (e.g. "yahoo options 404")
  const embedded = /\b(\d{3})\b/.exec(combined);
  const embeddedStatus = embedded ? Number(embedded[1]) : undefined;

  if (thrown instanceof TypeError) {
    return new ChainFetchError({
      kind: 'network',
      message: 'Connection failed — check your network and retry.',
    });
  }

  if (status === 404 || embeddedStatus === 404 || looksLikeNotFound(combined, status)) {
    return new ChainFetchError({
      kind: 'not_found',
      status: status ?? embeddedStatus,
      message: 'No options listed for this symbol.',
    });
  }

  if (status === 429 || embeddedStatus === 429 || looksLikeRateLimit(combined, status)) {
    return new ChainFetchError({
      kind: 'rate_limited',
      status: status ?? embeddedStatus,
      message: 'Rate-limited by data provider — try again in a moment.',
    });
  }

  if (status && status >= 500) {
    return new ChainFetchError({
      kind: 'upstream',
      status,
      message: 'Data provider is unreachable. Retry shortly.',
    });
  }

  if (combined.toLowerCase().includes('missing')) {
    return new ChainFetchError({
      kind: 'parse',
      status,
      message: 'Received an unexpected chain format from the data provider.',
    });
  }

  return new ChainFetchError({
    kind: 'unknown',
    status,
    message: combined || 'Chain fetch failed.',
  });
}

function extractBodyMessage(body: unknown): string {
  if (!body) return '';
  if (typeof body === 'string') return body;
  if (typeof body === 'object') {
    const b = body as { error?: unknown; cause?: unknown; message?: unknown };
    const parts: string[] = [];
    if (typeof b.error === 'string') parts.push(b.error);
    if (typeof b.cause === 'string') parts.push(b.cause);
    if (typeof b.message === 'string') parts.push(b.message);
    return parts.join(' ');
  }
  return '';
}
