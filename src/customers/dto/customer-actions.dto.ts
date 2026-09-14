import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class AssignStrikeDto {
  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsString()
  @IsOptional()
  receiptId?: string;
}

export class ToggleSuspensionDto {
  @IsString()
  @IsNotEmpty()
  action: 'suspend' | 'activate';

  @IsString()
  @IsOptional()
  reason?: string;
}
