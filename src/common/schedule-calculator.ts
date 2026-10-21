import { FeeType, PaymentStatus } from '@prisma/client';

export interface ScheduleRow {
  seq: number;
  feeType: FeeType;
  label: string;
  installmentNumber: number | null;
  year: number;
  dueDate: Date;
  amountPaisa: number;
  amount: number;
  cumulativePaid: number;
  balance: number;
  status: PaymentStatus;
  paidAmount: number;
}

export interface GenerateFixedScheduleOptions {
  plotPriceRupees: number;
  planYears: number; // 1, 2, 3, 4, or 5
  bookingDate: Date | string;
}

export function generateFixedSchedule(options: GenerateFixedScheduleOptions): ScheduleRow[] {
  const { plotPriceRupees, planYears, bookingDate } = options;

  if (![1, 2, 3, 4, 5].includes(planYears)) {
    throw new Error('Invalid planYears: must be 1, 2, 3, 4, or 5');
  }

  const pricePaisa = Math.round(plotPriceRupees * 100);
  const downpaymentPaisa = Math.floor((pricePaisa * 250) / 1000);
  const monthlyPoolPaisa = Math.floor((pricePaisa * 382) / 1000);
  const biannualPoolPaisa = Math.floor((pricePaisa * 288) / 1000);
  const possessionPaisa = pricePaisa - (downpaymentPaisa + monthlyPoolPaisa + biannualPoolPaisa);

  const totalRows = planYears * 12;
  const biannualCount = planYears * 2;
  const monthlyCount = totalRows - 1 - biannualCount - 1;

  const baseMonthlyPaisa = Math.floor(monthlyPoolPaisa / monthlyCount);
  const lastMonthlyPaisa = monthlyPoolPaisa - baseMonthlyPaisa * (monthlyCount - 1);

  const baseBiannualPaisa = Math.floor(biannualPoolPaisa / biannualCount);
  const lastBiannualPaisa = biannualPoolPaisa - baseBiannualPaisa * (biannualCount - 1);

  // Parse booking date in Asia/Karachi (UTC+5)
  const bDate = typeof bookingDate === 'string' ? new Date(bookingDate) : bookingDate;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(bDate);
  const bYear = parseInt(parts.find((p) => p.type === 'year')!.value, 10);
  const bMonth = parseInt(parts.find((p) => p.type === 'month')!.value, 10); // 1-12
  const bDay = parseInt(parts.find((p) => p.type === 'day')!.value, 10);

  // Anchor at noon UTC (12:00:00.000Z) to prevent day shifting across timezones
  const makeUtcNoonDate = (y: number, m: number, d: number) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return new Date(`${y}-${pad(m)}-${pad(d)}T12:00:00.000Z`);
  };

  const schedule: ScheduleRow[] = [];
  let cumulativePaisa = 0;
  let monthlyIdx = 0;
  let biannualIdx = 0;

  for (let r = 1; r <= totalRows; r++) {
    let feeType: FeeType;
    let label: string;
    let installmentNumber: number | null = null;
    let amountPaisa = 0;
    let dueDate: Date;
    const billYear = r === 1 ? 0 : Math.ceil((r - 1) / 12);

    if (r === 1) {
      feeType = FeeType.plot_downpayment;
      label = 'Down payment';
      installmentNumber = 0;
      amountPaisa = downpaymentPaisa;
      dueDate = makeUtcNoonDate(bYear, bMonth, bDay);
    } else {
      const totalMonths = (bMonth - 1) + (r - 1);
      const curYear = bYear + Math.floor(totalMonths / 12);
      const curMonth = (totalMonths % 12) + 1;
      dueDate = makeUtcNoonDate(curYear, curMonth, 1);

      if (r === totalRows) {
        feeType = FeeType.plot_possession;
        label = 'Possession';
        installmentNumber = null;
        amountPaisa = possessionPaisa;
      } else if (r === totalRows - 1 || r % 6 === 0) {
        biannualIdx++;
        feeType = FeeType.plot_biannual;
        label = `Bi-Annual #${biannualIdx}`;
        installmentNumber = biannualIdx;
        amountPaisa = (biannualIdx === biannualCount) ? lastBiannualPaisa : baseBiannualPaisa;
      } else {
        monthlyIdx++;
        feeType = FeeType.plot_installment;
        label = 'Monthly installment';
        installmentNumber = monthlyIdx;
        amountPaisa = (monthlyIdx === monthlyCount) ? lastMonthlyPaisa : baseMonthlyPaisa;
      }
    }

    cumulativePaisa += amountPaisa;
    schedule.push({
      seq: r,
      feeType,
      label,
      installmentNumber,
      year: billYear,
      dueDate,
      amountPaisa,
      amount: amountPaisa / 100,
      cumulativePaid: cumulativePaisa / 100,
      balance: (pricePaisa - cumulativePaisa) / 100,
      status: r === 1 ? PaymentStatus.paid : PaymentStatus.pending,
      paidAmount: r === 1 ? downpaymentPaisa / 100 : 0,
    });
  }

  return schedule;
}