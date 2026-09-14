import { IsString, IsNotEmpty, IsOptional, IsIn, IsObject } from 'class-validator';

export class CreateContentBlockDto {
  @IsIn(['plans', 'events'])
  section: 'plans' | 'events';

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsString()
  subtitle?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsString()
  @IsNotEmpty()
  content: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
