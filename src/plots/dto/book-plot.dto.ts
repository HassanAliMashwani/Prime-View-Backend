import { IsString, IsNotEmpty, IsOptional, IsEnum, ValidateNested, IsNumber } from 'class-validator';
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
  phone: string;

  @IsString()
  @IsOptional()
  cnic?: string;

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
  nokCnic?: string;
}

export class InstallmentPlanDto {
  @IsNumber()
  @IsOptional()
  totalPayment?: number;

  @IsNumber()
  @IsOptional()
  downpayment?: number;

  @IsNumber()
  @IsOptional()
  planYears?: number;

  @IsNumber()
  @IsOptional()
  years?: number;

  @IsNumber()
  @IsOptional()
  paidAfterEveryMonths?: number;

  @IsNumber()
  @IsOptional()
  paidAfterEvery?: number;

  @IsNumber()
  @IsOptional()
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

  @IsNumber()
  @IsOptional()
  salePrice?: number;

  @IsNumber()
  @IsOptional()
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
