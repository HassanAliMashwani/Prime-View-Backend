export interface DisplayStatusResult {
  displayStatus: 'available' | 'reserved' | 'booked' | 'allotted' | 'disputed';
  displayStatusReason?: string | null;
}

/**
 * P2-03 Single Resolver:
 * resolveDisplayStatus(plot, ownerAccountStatus) ->
 *   if plot.status === 'disputed' -> 'disputed'
 *   else if ownerAccountStatus === 'suspended' -> 'disputed'
 *   else -> plot.status
 */
export function resolveDisplayStatus(
  plot: { status: string; disputeReason?: string | null },
  ownerAccountStatus?: string | null
): DisplayStatusResult {
  if (plot.status === 'disputed') {
    return {
      displayStatus: 'disputed',
      displayStatusReason: plot.disputeReason || null,
    };
  }

  if (ownerAccountStatus === 'suspended') {
    return {
      displayStatus: 'disputed',
      displayStatusReason: 'Disputed — customer account suspended',
    };
  }

  return {
    displayStatus: plot.status as any,
    displayStatusReason: null,
  };
}

export function attachDisplayStatus<
  T extends { status: string; disputeReason?: string | null; currentOwner?: { accountStatus?: string | null } | null }
>(plot: T): T & DisplayStatusResult {
  const { displayStatus, displayStatusReason } = resolveDisplayStatus(
    plot,
    plot.currentOwner?.accountStatus
  );
  return {
    ...plot,
    displayStatus,
    displayStatusReason,
  };
}
