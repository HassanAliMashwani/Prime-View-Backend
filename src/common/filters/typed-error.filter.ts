import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class TypedErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    // Log one line only: request failed
    console.error('request failed');

    const GENERIC_ERROR_MESSAGE = 'Something went wrong. Please try again.';

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      let message = '';

      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        message = (exceptionResponse as any).message || '';
      } else if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      }

      if (message === 'Invalid credentials.' || message === 'Invalid credentials') {
        return response.status(status).json({
          message: 'Invalid credentials.',
        });
      }

      if (
        message === 'Account locked due to too many failed attempts.' ||
        message.startsWith('Account locked due to too many failed attempts')
      ) {
        return response.status(status).json({
          message: 'Account locked due to too many failed attempts.',
        });
      }
    }

    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      message: GENERIC_ERROR_MESSAGE,
    });
  }
}


