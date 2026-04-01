export interface Position {
  coin: string;
  szi: string;           // signed size: + long, - short
  entryPx: string;
  positionValue: string;
  unrealizedPnl: string;
  realizedPnl: string;
  returnOnEquity: string;
  liquidationPx: string | null;
  leverage: { type: 'cross' | 'isolated'; value: number };
  marginUsed: string;
}

export interface MarginSummary {
  accountValue: string;
  totalNtlPos: string;
  totalRawUsd: string;
  totalMarginUsed: string;
  withdrawable: string;
}

export interface ClearinghouseState {
  assetPositions: { position: Position }[];
  marginSummary: MarginSummary;
  crossMarginSummary: MarginSummary;
  withdrawable: string;
}
