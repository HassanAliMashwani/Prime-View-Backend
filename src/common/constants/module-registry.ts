export interface ModuleRegistryItem {
  key: string;
  label: string;
  moduleId: string;
}

export const MODULE_REGISTRY: readonly ModuleRegistryItem[] = [
  { key: 'can_reserve', label: 'Reserve Plots', moduleId: 'reservations' },
  { key: 'can_book', label: 'Book Plots', moduleId: 'bookings' },
  { key: 'can_create_customer', label: 'Create Customer Accounts & Bookings', moduleId: 'customers' },
  { key: 'can_view_customers', label: 'View Customer Directory', moduleId: 'customers' },
  { key: 'can_view_sales_reports', label: 'View Sales History Reports', moduleId: 'sales' },
  { key: 'can_view_sales_history', label: 'View Sales History', moduleId: 'sales' },
  { key: 'can_edit_content', label: 'Edit Website Plans & Events (CMS)', moduleId: 'content' },
  { key: 'can_verify_receipts', label: 'Receipt Verification Authority', moduleId: 'receipts' },
  { key: 'can_view_inventory', label: 'View Inventory Overview', moduleId: 'inventory' },
  { key: 'can_view_master_plan', label: 'View Master Plan', moduleId: 'master_plan' },
] as const;

export type PermissionKey = typeof MODULE_REGISTRY[number]['key'];
