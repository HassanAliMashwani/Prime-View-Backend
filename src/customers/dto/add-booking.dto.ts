import { IsString, IsNotEmpty, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { InstallmentPlanDto } from '../../plots/dto/book-plot.dto';

export class AddBookingDto {
  @IsString()
  @IsNotEmpty()
  plotId: string;

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

  @IsString()
  @IsOptional()
  lockToken?: string;
}
