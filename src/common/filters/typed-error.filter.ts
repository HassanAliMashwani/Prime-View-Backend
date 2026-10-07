import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class TypedErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    // Log actual exception
    console.error('ACTUAL EXCEPTION:', exception);

    const GENERIC_ERROR_MESSAGE = 'Something went wrong. Please try again.';

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      let message: any = '';

      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        message = (exceptionResponse as any).message || (exceptionResponse as any).error || '';
      } else if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      }

      const formattedMessage = Array.isArray(message) ? message.join(', ') : (message || exception.message);

      return response.status(status).json({
        statusCode: status,
        message: formattedMessage,
      });
    }

    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: GENERIC_ERROR_MESSAGE,
    });
  }
}


