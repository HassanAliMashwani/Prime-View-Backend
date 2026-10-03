import { ExceptionFilter, Catch, ArgumentsHost, HttpException, ForbiddenException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class TypedErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let reason = 'INTERNAL_SERVER_ERROR';
    let message = 'An unexpected server error occurred.';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        reason = (exceptionResponse as any).reason || (exceptionResponse as any).error || exception.name;
        message = (exceptionResponse as any).message || exception.message;
      } else if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      }

      if (exception instanceof ForbiddenException) {
        reason = reason || 'PERMISSION_DENIED';
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      reason = exception.name;
    }

    // Server Error Monitoring Hook:
    // Captures only route and error name. Strictly avoids passwords, tokens, or bodies.
    // Stays completely off until the owner configures ERROR_MONITORING_DSN.
    const monitoringDsn = process.env.ERROR_MONITORING_DSN;
    if (monitoringDsn && status >= 500) {
      const sanitizedRoute = request?.originalUrl ? request.originalUrl.split('?')[0] : 'unknown';
      const errorName = exception instanceof Error ? exception.name : 'UnknownError';
      const eventPayload = {
        timestamp: new Date().toISOString(),
        method: request?.method,
        route: sanitizedRoute,
        errorName,
        statusCode: status,
      };

      // Dispatches telemetry asynchronously to the configured monitoring DSN
      try {
        fetch(monitoringDsn, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(eventPayload),
        }).catch(() => {
          /* fail silent without impacting response */
        });
      } catch {
        /* fail silent */
      }
    }

    response.status(status).json({
      statusCode: status,
      reason,
      error: reason,
      message,
    });
  }
}

