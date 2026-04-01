import Decimal from 'decimal.js';

export interface PaperPosition {
  coin: string;
  szi: Decimal;           // signed size: + long, - short
  entryPx: Decimal;
  unrealizedPnl: Decimal;
  realizedPnl: Decimal;
  marginUsed: Decimal;
}

export interface PositionUpdateResult {
  position: PaperPosition | null;  // null if fully closed
  realizedPnl: Decimal;
}

/**
 * Update a position with a new fill.
 * Returns the updated position (or null if closed) and realized PnL from the fill.
 */
export function applyFill(
  existing: PaperPosition | null,
  coin: string,
  fillSide: 'buy' | 'sell',
  fillSize: Decimal,
  fillPrice: Decimal,
  leverage: number,
): PositionUpdateResult {
  const signedFillSize = fillSide === 'buy' ? fillSize : fillSize.neg();

  if (!existing || existing.szi.isZero()) {
    // New position
    const marginUsed = fillSize.mul(fillPrice).div(leverage);
    return {
      position: {
        coin,
        szi: signedFillSize,
        entryPx: fillPrice,
        unrealizedPnl: new Decimal(0),
        realizedPnl: new Decimal(0),
        marginUsed,
      },
      realizedPnl: new Decimal(0),
    };
  }

  const sameDirection =
    (existing.szi.gt(0) && signedFillSize.gt(0)) ||
    (existing.szi.lt(0) && signedFillSize.lt(0));

  if (sameDirection) {
    // Adding to position — weighted average entry
    const totalSize = existing.szi.abs().add(fillSize);
    const newEntry = existing.entryPx
      .mul(existing.szi.abs())
      .add(fillPrice.mul(fillSize))
      .div(totalSize);
    const newSzi = existing.szi.add(signedFillSize);
    const marginUsed = totalSize.mul(newEntry).div(leverage);
    return {
      position: {
        coin,
        szi: newSzi,
        entryPx: newEntry,
        unrealizedPnl: new Decimal(0),
        realizedPnl: existing.realizedPnl,
        marginUsed,
      },
      realizedPnl: new Decimal(0),
    };
  }

  // Opposite direction — partial/full close, possibly flip
  const closedSize = Decimal.min(existing.szi.abs(), fillSize);
  const pnlPerUnit = existing.szi.gt(0)
    ? fillPrice.sub(existing.entryPx)     // closing long
    : existing.entryPx.sub(fillPrice);    // closing short
  const realized = pnlPerUnit.mul(closedSize);

  const remainingExisting = existing.szi.abs().sub(closedSize);
  const remainingFill = fillSize.sub(closedSize);

  if (remainingExisting.isZero() && remainingFill.isZero()) {
    // Exact close
    return { position: null, realizedPnl: realized };
  }

  if (remainingExisting.gt(0)) {
    // Partial close — keep same direction, same entry
    const newSzi = existing.szi.gt(0) ? remainingExisting : remainingExisting.neg();
    const marginUsed = remainingExisting.mul(existing.entryPx).div(leverage);
    return {
      position: {
        coin,
        szi: newSzi,
        entryPx: existing.entryPx,
        unrealizedPnl: new Decimal(0),
        realizedPnl: existing.realizedPnl.add(realized),
        marginUsed,
      },
      realizedPnl: realized,
    };
  }

  // Flip — close old, open new in opposite direction
  const newSzi = fillSide === 'buy' ? remainingFill : remainingFill.neg();
  const marginUsed = remainingFill.mul(fillPrice).div(leverage);
  return {
    position: {
      coin,
      szi: newSzi,
      entryPx: fillPrice,
      unrealizedPnl: new Decimal(0),
      realizedPnl: realized,
      marginUsed,
    },
    realizedPnl: realized,
  };
}

/**
 * Compute unrealized PnL for a position at a given mark price.
 */
export function computeUnrealizedPnl(position: PaperPosition, markPrice: Decimal): Decimal {
  return position.szi.mul(markPrice.sub(position.entryPx));
}

/**
 * Compute a simplified liquidation price.
 */
export function computeLiquidationPrice(
  position: PaperPosition,
  accountBalance: Decimal,
  maintenanceRate: Decimal,
): Decimal | null {
  if (position.szi.isZero()) return null;
  const absSize = position.szi.abs();
  const marginAvailable = accountBalance.mul(new Decimal(1).sub(maintenanceRate));

  if (position.szi.gt(0)) {
    // Long: liqPx = entryPx - marginAvailable / absSize
    return position.entryPx.sub(marginAvailable.div(absSize));
  }
  // Short: liqPx = entryPx + marginAvailable / absSize
  return position.entryPx.add(marginAvailable.div(absSize));
}
