import { IsString, IsEmail, IsArray, IsOptional, IsObject } from 'class-validator';

export class CreateSubAdminDto {
  @IsString()
  fullName: string;

  @IsEmail()
  email: string;

  @IsString()
  username: string;

  @IsString()
  password: string;

  @IsArray()
  assignedBlocks: string[];

  @IsObject()
  @IsOptional()
  permissions?: {
    can_reserve?: boolean;
    can_book?: boolean;
    can_create_customer?: boolean;
    can_view_customers?: boolean;
    can_view_sales_reports?: boolean;
    can_view_sales_history?: boolean;
    can_edit_content?: boolean;
    can_verify_receipts?: boolean;
  };
}
