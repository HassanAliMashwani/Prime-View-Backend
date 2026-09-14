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
    const requiredPermission = this.reflector.get<string>('permission', context.getHandler());

    if (!session) {
      return false; // Should be handled by JwtAuthGuard first
    }

    // Member sessions don't have permissions/assignedBlocks, they are identity-scoped in controllers
    if (session.role === 'customer') {
      return true;
    }

    if (requiredPermission && session.role !== 'super_admin') {
      if (!session.permissions || !session.permissions[requiredPermission]) {
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
