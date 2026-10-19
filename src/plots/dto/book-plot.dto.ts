import { IsString, IsNotEmpty, IsOptional, IsEnum, ValidateNested, IsNumber, Matches } from 'class-validator';
import { Type } from 'class-transformer';

export class CustomerInfoDto {
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @IsString()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^(?:0\d{10}|0\d{3}-\d{7})$/, {
    message: 'Phone number cannot be greater than 11 digits and must follow 03XXXXXXXXX or 03XX-XXXXXXX format.',
  })
  phone: string;

  @IsString()
  @IsOptional()
  @Matches(/^\d{5}-\d{7}-\d{1}$/, {
    message: 'CNIC must be exactly 13 digits in 00000-0000000-0 format.',
  })
  cnic?: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsOptional()
  fatherOrHusbandName?: string;

  @IsString()
  @IsOptional()
  mailingAddress?: string;

  @IsString()
  @IsOptional()
  nokName?: string;

  @IsString()
  @IsOptional()
  @Matches(/^\d{5}-\d{7}-\d{1}$/, {
    message: 'Nominee CNIC must be exactly 13 digits in 00000-0000000-0 format.',
  })
  nokCnic?: string;
}

export class InstallmentPlanDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  totalPayment?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  downpayment?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  planYears?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  years?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  paidAfterEveryMonths?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  paidAfterEvery?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  numberOfInstallments?: number;
}

export class BookPlotDto {
  @IsString()
  @IsOptional()
  customerId?: string;

  @ValidateNested()
  @Type(() => CustomerInfoDto)
  @IsOptional()
  customer?: CustomerInfoDto;

  @IsString()
  @IsNotEmpty()
  paymentType: 'one_time' | 'installment';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  salePrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  downPayment?: number;

  @ValidateNested()
  @Type(() => InstallmentPlanDto)
  @IsOptional()
  installmentPlan?: InstallmentPlanDto;

  @IsString()
  @IsOptional()
  reservationId?: string;

  /**
   * Test-only failure simulation flag.
   * Strictly gated behind process.env.ENABLE_TEST_SIMULATIONS === 'true'.
   * In production, this field is completely ignored (no-op).
   */
  @IsOptional()
  simulateRollback?: boolean;
}
