export type Side = 'buy' | 'sell';
export type TIF = 'Gtc' | 'Ioc' | 'Alo';
export type TpSl = 'tp' | 'sl';

export interface LimitOrderType {
  limit: { tif: TIF };
}

export interface TriggerOrderType {
  trigger: {
    isMarket: boolean;
    triggerPx: string;
    tpsl: TpSl;
  };
}

export type OrderType = LimitOrderType | TriggerOrderType;

export interface OrderWire {
  a: number;       // asset index
  b: boolean;      // isBuy
  p: string;       // price
  s: string;       // size
  r: boolean;      // reduceOnly
  t: OrderType;
  c?: string;      // cloid
}

export interface OrderRequest {
  coin: string;
  side: Side;
  price: string;
  size: string;
  reduceOnly: boolean;
  orderType: OrderType;
  cloid?: string;
  /** Link TP/SL to an entry order — they won't activate until the parent fills. */
  parentOid?: string;
}

export interface OpenOrder {
  coin: string;
  oid: number;
  side: Side;
  limitPx: string;
  sz: string;
  origSz: string;
  orderType: string;
  triggerPx?: string;
  tpsl?: TpSl;
  timestamp: number;
}

export interface PlaceOrderResult {
  success: boolean;
  oid?: number | string;
  error?: string;
  filled?: { totalSz: string; avgPx: string };
}
