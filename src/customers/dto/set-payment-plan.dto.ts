import { IsString, IsNotEmpty, IsOptional, ValidateNested, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { InstallmentPlanDto } from '../../plots/dto/book-plot.dto';

export class SetPaymentPlanDto {
  @IsString()
  @IsNotEmpty()
  paymentType: 'one_time' | 'installment';

  @ValidateNested()
  @Type(() => InstallmentPlanDto)
  @IsOptional()
  installmentPlan?: InstallmentPlanDto;

  @IsString()
  @IsOptional()
  paperInstallmentRef?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  plotPrice?: number;
}
