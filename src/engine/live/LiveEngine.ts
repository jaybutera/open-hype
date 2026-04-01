import type { OrderRequest, PlaceOrderResult } from '../../types/order.ts';

/**
 * Live engine - delegates to real Hyperliquid exchange API.
 * Stub for now; signing implementation needed for real trading.
 */
export class LiveEngine {
  async placeOrder(_req: OrderRequest): Promise<PlaceOrderResult> {
    return { success: false, error: 'Live trading not yet implemented' };
  }

  async cancelOrder(_coin: string, _orderId: string): Promise<boolean> {
    return false;
  }

  async cancelAllOrders(_coin?: string): Promise<void> {}
}
