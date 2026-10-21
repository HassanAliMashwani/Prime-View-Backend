import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

@Injectable()
export class PermissionScopeGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const session = request.user;
    const params = request.params;
    const query = request.query;
    const requiredPermission = this.reflector.getAllAndOverride<string>('permission', [
      context.getHandler(),
      context.getClass(),
    ]);
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    if (!session) {
      return false; // Should be handled by JwtAuthGuard first
    }

    // Member sessions don't have permissions/assignedBlocks, they are identity-scoped in controllers
    if (session.role === 'customer') {
      if (requiredPermission) {
        throw new ForbiddenException({
          reason: 'PERMISSION_DENIED',
          message: 'Society member accounts cannot access administrative endpoints.',
        });
      }
      return true;
    }

    if (requiredPermission && session.role !== 'super_admin') {
      // 1. Group 1: Reserve, Book, Sort Reservations, and Master Plan
      if (['can_reserve', 'can_book', 'can_view_master_plan'].includes(requiredPermission)) {
        const hasBox1 = Boolean(
          session.permissions?.can_reserve &&
          session.permissions?.can_book &&
          session.permissions?.can_view_master_plan
        );
        if (!hasBox1) {
          throw new ForbiddenException({ reason: 'PERMISSION_DENIED', message: 'You do not have the required permission' });
        }
      }
      // 2. Group 2: Create Customer Account and View Customer Directory
      else if (['can_create_customer', 'can_view_customers'].includes(requiredPermission)) {
        const hasBox2 = Boolean(
          session.permissions?.can_create_customer &&
          session.permissions?.can_view_customers
        );
        if (!hasBox2) {
          throw new ForbiddenException({ reason: 'PERMISSION_DENIED', message: 'You do not have the required permission' });
        }
      }
      // 3. Group 3: View Sales History
      else if (['can_view_sales_reports', 'can_view_sales_history'].includes(requiredPermission)) {
        const hasBox3 = Boolean(
          session.permissions?.can_view_sales_reports &&
          session.permissions?.can_view_sales_history
        );
        if (!hasBox3) {
          throw new ForbiddenException({ reason: 'PERMISSION_DENIED', message: 'You do not have the required permission' });
        }
      }
      // Standalone modules
      else if (!session.permissions || !session.permissions[requiredPermission]) {
        throw new ForbiddenException({ reason: 'PERMISSION_DENIED', message: 'You do not have the required permission' });
      }
    }

    // Scope check: if there's a blockId in params (e.g. GET /plots?blockId=XYZ or /blocks/:blockId),
    // we can check it here. If the blockId is NOT in params (e.g. GET /plots/:id),
    // the guard passes the scope check and leaves the resource-level scope validation to the service layer.
    const blockIdParam = params.blockId || query.blockId;

    if (blockIdParam && session.role !== 'super_admin') {
      if (!session.assignedBlocks || !session.assignedBlocks.includes(blockIdParam)) {
        throw new ForbiddenException({ reason: 'OUT_OF_SCOPE', message: 'You do not have access to this block' });
      }
    }

    return true;
  }
}
