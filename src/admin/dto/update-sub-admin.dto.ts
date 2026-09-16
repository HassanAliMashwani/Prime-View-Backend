import { IsString, IsArray, IsOptional, IsObject, IsIn } from 'class-validator';

export class UpdateSubAdminDto {
  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsIn(['active', 'suspended'])
  status?: 'active' | 'suspended';

  @IsOptional()
  @IsArray()
  assignedBlocks?: string[];

  @IsOptional()
  @IsObject()
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
