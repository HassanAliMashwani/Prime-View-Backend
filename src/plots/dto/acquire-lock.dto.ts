import { IsOptional, IsString, IsIn } from 'class-validator';

export class AcquireLockDto {
  @IsOptional()
  @IsString()
  @IsIn(['book', 'reserve', 'adjust'])
  reason?: 'book' | 'reserve' | 'adjust';
}
