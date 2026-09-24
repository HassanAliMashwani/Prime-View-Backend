/**
 * Local Society Calendar (Pakistan, PKT = UTC+5) Installment Due Date Helpers.
 *
 * Rules:
 * - Recurring installment dueDate = day 5 of the month.
 * - First installment after booking = the next 5th STRICTLY AFTER booking date.
 *   e.g.
 *     Book 24 Sep or 29 Sep -> 5 Oct
 *     Book 5 Oct -> 5 Nov
 *     Book 3 Oct -> 5 Oct
 * - Later installments: 5th of each following period (step * frequency).
 */

export function fifthOfMonth(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 5, 0, 0, 0));
}

export function getSocietyDateParts(date: Date | string): { year: number; month: number; day: number } {
  const d = typeof date === 'string' ? new Date(date) : date;
  // Local Pakistan society calendar is UTC+5 (no DST)
  const pkTime = new Date(d.getTime() + 5 * 60 * 60 * 1000);
  return {
    year: pkTime.getUTCFullYear(),
    month: pkTime.getUTCMonth(),
    day: pkTime.getUTCDate(),
  };
}

export function nextFifthAfter(date: Date | string): Date {
  const { year, month, day } = getSocietyDateParts(date);
  // Strictly after date:
  // If day < 5, the 5th of this current month is strictly after.
  // If day >= 5, the 5th of current month is today or past, so next 5th is next month.
  if (day < 5) {
    return fifthOfMonth(year, month);
  } else {
    return fifthOfMonth(year, month + 1);
  }
}

export function calculateInstallmentDueDates(
  bookingDate: Date | string,
  numberOfInstallments: number,
  paidAfterEvery: number = 1
): Date[] {
  const firstDue = nextFifthAfter(bookingDate);
  const { year: startYear, month: startMonth } = getSocietyDateParts(firstDue);

  const dates: Date[] = [];
  const step = Math.max(1, Number(paidAfterEvery) || 1);
  for (let i = 0; i < numberOfInstallments; i++) {
    dates.push(fifthOfMonth(startYear, startMonth + i * step));
  }
  return dates;
}
