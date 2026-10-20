import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';

function containsRawError(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed) return false;

  // Uppercase constant error codes (e.g. BALLOON_ENGINE_ERROR, LOCKED_BY_ANOTHER, SLIP_NOT_FOUND)
  if (/^[A-Z0-9_]{3,}$/.test(trimmed)) {
    return true;
  }

  const lower = trimmed.toLowerCase();

  // Words "privilege", "escalation", "guard", "policy", "rls"
  if (
    lower.includes('privilege') ||
    lower.includes('escalation') ||
    lower.includes('guard') ||
    lower.includes('trigger') ||
    lower.includes('policy') ||
    lower.includes('row security') ||
    lower.includes('rls')
  ) {
    return true;
  }

  // Database / SQL / Prisma indicators
  if (
    lower.includes('prisma') ||
    lower.includes('connectorerror') ||
    lower.includes('connecterror') ||
    lower.includes('postgresql') ||
    lower.includes('postgres') ||
    lower.includes('pgbouncer') ||
    lower.includes('prepared statement') ||
    lower.includes('syntax error') ||
    lower.includes('errcode') ||
    lower.includes('sqlstate') ||
    lower.includes('database') ||
    lower.includes('table ') ||
    lower.includes('column ') ||
    lower.includes('relation ') ||
    lower.includes('violates ') ||
    lower.includes('constraint ') ||
    lower.includes('foreign key') ||
    lower.includes('duplicate key')
  ) {
    return true;
  }

  // SQL statements
  if (/\b(select|insert|update|delete|drop|alter|truncate|create)\b.*\b(from|into|table|where|set)\b/i.test(trimmed)) {
    return true;
  }

  // Table or model names
  if (/\b(adminuser|plot|booking|customer|auditentry|blockassignment|paymentschedule|depositslip)\b/i.test(trimmed)) {
    return true;
  }

  // Role names
  if (/\b(super_admin|sub_admin|system_sweep)\b/i.test(trimmed)) {
    return true;
  }

  // Permission flags
  if (/\bcan_[a-z0-9_]+\b/i.test(trimmed)) {
    return true;
  }

  // Stack traces, paths, or code brackets
  if (
    trimmed.includes('    at ') ||
    trimmed.includes('\n    at') ||
    trimmed.includes('node:internal') ||
    trimmed.includes('.ts:') ||
    trimmed.includes('.js:') ||
    trimmed.includes('\\') ||
    trimmed.includes('/src/') ||
    trimmed.includes('/dist/') ||
    trimmed.includes('/node_modules/') ||
    trimmed.includes('{') ||
    trimmed.includes('}') ||
    trimmed.includes('<') ||
    trimmed.includes('>')
  ) {
    return true;
  }

  // Length check (human plain sentences are under 200 chars)
  if (trimmed.length > 200) {
    return true;
  }

  return false;
}

@Catch()
export class TypedErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(TypedErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    // Log the real error on the server only
    if (exception instanceof Error) {
      this.logger.error(`Unhandled Exception: ${exception.message}`, exception.stack);
    } else {
      this.logger.error('Unhandled Exception:', exception);
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();

      // 401 stays 401 and says "Please sign in again."
      if (status === HttpStatus.UNAUTHORIZED) {
        return response.status(HttpStatus.UNAUTHORIZED).json({
          message: 'Please sign in again.',
        });
      }

      // 403 stays 403 and says "You do not have permission to do that."
      // Do not include the blocked permission name or the database rule.
      if (status === HttpStatus.FORBIDDEN) {
        return response.status(HttpStatus.FORBIDDEN).json({
          message: 'You do not have permission to do that.',
        });
      }

      // For server errors (5xx), always respond with 500 and the standard safe message
      if (status >= 500) {
        return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
          message: 'Something went wrong. Please try again.',
        });
      }

      const exceptionResponse = exception.getResponse();
      let rawMessage: any = '';

      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        rawMessage = (exceptionResponse as any).message || (exceptionResponse as any).error || '';
      } else if (typeof exceptionResponse === 'string') {
        rawMessage = exceptionResponse;
      }

      const formattedMessage = Array.isArray(rawMessage)
        ? rawMessage.join(', ')
        : (rawMessage || exception.message || '');

      // Check if the client-facing message contains any raw database error or internal term
      if (containsRawError(formattedMessage)) {
        return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
          message: 'Something went wrong. Please try again.',
        });
      }

      // Normal client form messages (e.g. missing field, taken email, taken username, photo https link, wrong current password)
      return response.status(status).json({
        message: formattedMessage,
      });
    }

    // For errors that are not HttpException (including Prisma, PostgreSQL, and runtime errors):
    // respond with status 500 and exactly: { "message": "Something went wrong. Please try again." }
    // Do not put the real message in message, error, or any other field.
    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      message: 'Something went wrong. Please try again.',
    });
  }
}
