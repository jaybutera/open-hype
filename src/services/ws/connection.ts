import { WS_URL } from '../../config/constants.ts';

type Handler = (data: unknown) => void;

export class HLWebSocket {
  private ws: WebSocket | null = null;
  private subs: Map<string, Set<Handler>> = new Map();
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private active = false;

  connect(): void {
    this.active = true;
    this.ws = new WebSocket(WS_URL);
    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      this.resubscribeAll();
    };
    this.ws.onmessage = (evt) => {
      try {
        this.dispatch(JSON.parse(evt.data));
      } catch {}
    };
    this.ws.onclose = () => {
      if (this.active) this.scheduleReconnect();
    };
    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  disconnect(): void {
    this.active = false;
    this.ws?.close();
    this.ws = null;
  }

  subscribe(channel: string, params: Record<string, unknown>, handler: Handler): () => void {
    const key = this.makeKey(channel, params);
    if (!this.subs.has(key)) this.subs.set(key, new Set());
    this.subs.get(key)!.add(handler);
    this.send({ method: 'subscribe', subscription: { type: channel, ...params } });
    return () => {
      this.subs.get(key)?.delete(handler);
      if (this.subs.get(key)?.size === 0) {
        this.subs.delete(key);
        this.send({ method: 'unsubscribe', subscription: { type: channel, ...params } });
      }
    };
  }

  private send(msg: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private dispatch(msg: { channel?: string; data?: unknown }): void {
    if (!msg.channel || msg.channel === 'subscriptionResponse') return;
    for (const [key, handlers] of this.subs) {
      if (key.startsWith(msg.channel + '|') || key === msg.channel + '|') {
        for (const h of handlers) h(msg.data);
      }
    }
  }

  private resubscribeAll(): void {
    for (const key of this.subs.keys()) {
      const { channel, params } = this.parseKey(key);
      this.send({ method: 'subscribe', subscription: { type: channel, ...params } });
    }
  }

  private scheduleReconnect(): void {
    setTimeout(() => {
      if (this.active) this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  private makeKey(channel: string, params: Record<string, unknown>): string {
    return channel + '|' + JSON.stringify(params);
  }

  private parseKey(key: string): { channel: string; params: Record<string, unknown> } {
    const idx = key.indexOf('|');
    return {
      channel: key.slice(0, idx),
      params: idx < key.length - 1 ? JSON.parse(key.slice(idx + 1)) : {},
    };
  }
}

export const ws = new HLWebSocket();
