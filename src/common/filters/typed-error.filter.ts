import { ExceptionFilter, Catch, ArgumentsHost, HttpException, ForbiddenException } from '@nestjs/common';
import { Response } from 'express';

@Catch(HttpException)
export class TypedErrorFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    let reason = 'UNKNOWN_ERROR';
    let message = exception.message;

    if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
      reason = (exceptionResponse as any).reason || (exceptionResponse as any).error || reason;
      message = (exceptionResponse as any).message || message;
    }

    if (exception instanceof ForbiddenException) {
      if (typeof exceptionResponse === 'object' && ((exceptionResponse as any).reason || (exceptionResponse as any).error)) {
        reason = (exceptionResponse as any).reason || (exceptionResponse as any).error;
      } else {
        reason = 'PERMISSION_DENIED';
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
