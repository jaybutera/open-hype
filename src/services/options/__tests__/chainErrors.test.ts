import { describe, it, expect } from 'vitest';
import { ChainFetchError, classifyChainError } from '../chainErrors';

describe('classifyChainError', () => {
  it('classifies 404 as not_found with friendly copy', () => {
    const err = classifyChainError({ status: 404 });
    expect(err).toBeInstanceOf(ChainFetchError);
    expect(err.kind).toBe('not_found');
    expect(err.status).toBe(404);
    expect(err.message).toMatch(/no options/i);
  });

  it('classifies 429 as rate_limited', () => {
    const err = classifyChainError({ status: 429 });
    expect(err.kind).toBe('rate_limited');
    expect(err.message).toMatch(/rate.limited/i);
  });

  it('classifies 5xx as upstream', () => {
    const err = classifyChainError({ status: 503 });
    expect(err.kind).toBe('upstream');
    expect(err.message).toMatch(/unreachable/i);
  });

  it('classifies TypeError (fetch failed) as network', () => {
    const err = classifyChainError({ thrown: new TypeError('Failed to fetch') });
    expect(err.kind).toBe('network');
    expect(err.message).toMatch(/connection/i);
  });

  it('extracts embedded upstream status from proxy body (502 wrapping a 404)', () => {
    const err = classifyChainError({
      status: 502,
      body: { error: 'yahoo options 404' },
    });
    expect(err.kind).toBe('not_found');
    expect(err.status).toBe(502);
  });

  it('extracts embedded upstream status from proxy body (502 wrapping a 429)', () => {
    const err = classifyChainError({
      status: 502,
      body: { error: 'yahoo options 429' },
    });
    expect(err.kind).toBe('rate_limited');
  });

  it('recognizes parse errors from missing field messages', () => {
    const err = classifyChainError({
      thrown: new Error('Yahoo response missing optionChain.result'),
    });
    expect(err.kind).toBe('parse');
  });

  it('falls back to unknown for unrecognized errors', () => {
    const err = classifyChainError({ thrown: new Error('something broke') });
    expect(err.kind).toBe('unknown');
    expect(err.message).toMatch(/something broke/);
  });

  it('accepts string bodies', () => {
    const err = classifyChainError({ status: 502, body: 'rate limit reached' });
    expect(err.kind).toBe('rate_limited');
  });

  it('extracts from body.cause when error is missing', () => {
    const err = classifyChainError({
      status: 502,
      body: { cause: 'too many requests from this ip' },
    });
    expect(err.kind).toBe('rate_limited');
  });

  it('preserves original message when nothing matches', () => {
    const err = classifyChainError({ thrown: new Error('weird failure') });
    expect(err.kind).toBe('unknown');
    expect(err.message).toContain('weird failure');
  });
});
