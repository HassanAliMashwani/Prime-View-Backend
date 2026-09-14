import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class TogglePlotAdjustmentDto {
  @IsBoolean()
  isAdjustment: boolean;

  @IsOptional()
  @IsString()
  reason?: string;
}
