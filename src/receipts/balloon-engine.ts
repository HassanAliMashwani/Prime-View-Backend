export interface PaymentRecordRow {
  id: string;
  installmentNumber: number | null;
  dueDate: Date | null;
  amount: number; // integer PKR
  paidAmount: number; // integer PKR
  status: string;
}

export interface Allocation {
  paymentRecordId: string;
  amountApplied: number; // integer PKR
  allocationType: 'full' | 'partial';
}

export interface BalloonResult {
  allocations: Allocation[];
  fullyCovered: number[];
  partial: { installmentNumber: number; amountApplied: number } | null;
  before: PaymentRecordRow[];
  after: PaymentRecordRow[];
  error?: string;
}

export function allocateBalloon(amountPkr: number, rows: PaymentRecordRow[]): BalloonResult {
  // Sort rows by dueDate, then installmentNumber
  const sortedRows = [...rows].sort((a, b) => {
    const timeA = a.dueDate ? a.dueDate.getTime() : 0;
    const timeB = b.dueDate ? b.dueDate.getTime() : 0;
    if (timeA !== timeB) return timeA - timeB;
    return (a.installmentNumber || 0) - (b.installmentNumber || 0);
  });

  const allocations: Allocation[] = [];
  const fullyCovered: number[] = [];
  let partial: { installmentNumber: number; amountApplied: number } | null = null;
  const after: PaymentRecordRow[] = JSON.parse(JSON.stringify(sortedRows)); // Deep copy to avoid mutating inputs

  let remaining = amountPkr;
  let totalOutstanding = 0;
  let firstOutstandingAmount = 0;
  let firstFound = false;

  for (const row of after) {
    const outstanding = row.amount - row.paidAmount;
    if (outstanding > 0) {
      totalOutstanding += outstanding;
      if (!firstFound) {
        firstOutstandingAmount = outstanding;
        firstFound = true;
      }
    }
  }

  // Enforce D6: amount < next outstanding -> error.
  if (amountPkr < firstOutstandingAmount) {
    return {
      allocations: [],
      fullyCovered: [],
      partial: null,
      before: rows,
      after: rows,
      error: `Balloon payment (${amountPkr}) cannot be less than the next outstanding installment (${firstOutstandingAmount}).`,
    };
  }

  // Enforce D7: amount > total outstanding -> error + max allowed.
  if (amountPkr > totalOutstanding) {
    return {
      allocations: [],
      fullyCovered: [],
      partial: null,
      before: rows,
      after: rows,
      error: `Balloon payment (${amountPkr}) exceeds the total outstanding balance (${totalOutstanding}). Maximum allowed is ${totalOutstanding}.`,
    };
  }

  for (let i = 0; i < after.length; i++) {
    const row = after[i];
    const outstanding = row.amount - row.paidAmount;

    if (outstanding > 0 && remaining > 0) {
      const applied = Math.min(remaining, outstanding);
      remaining -= applied;

      row.paidAmount += applied;
      if (row.paidAmount >= row.amount) {
        row.status = 'paid';
        allocations.push({
          paymentRecordId: row.id,
          amountApplied: applied,
          allocationType: 'full',
        });
        if (row.installmentNumber != null) {
          fullyCovered.push(row.installmentNumber);
        }
      } else {
        row.status = 'partially_paid';
        allocations.push({
          paymentRecordId: row.id,
          amountApplied: applied,
          allocationType: 'partial',
        });
        if (row.installmentNumber != null) {
          partial = {
            installmentNumber: row.installmentNumber,
            amountApplied: applied,
          };
        }
      }
    }
    
    // Convert Dates back since JSON.parse(JSON.stringify) turned them into strings
    if (typeof row.dueDate === 'string') {
      row.dueDate = new Date(row.dueDate);
    }
  }

  return {
    allocations,
    fullyCovered,
    partial,
    before: sortedRows, // Return the sorted original as "before"
    after,
  };
}
