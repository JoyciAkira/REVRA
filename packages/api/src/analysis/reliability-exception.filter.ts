/**
 * Maps domain rule violations to explicit HTTP semantics:
 *   contract violations → 409 (the request conflicts with a reliability rule)
 *   unknown resources   → 404
 *   malformed payloads  → 400 with the schema issues
 * The error body always names the PRD contract that was hit.
 */
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { KernelRuleError } from '@revra/kernel';
import { ZodError } from 'zod';

@Catch()
export class ReliabilityExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();

    // Eccezioni HTTP di Nest (guard auth): mantengono il loro status.
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code =
        status === HttpStatus.UNAUTHORIZED ? 'UNAUTHORIZED' : status === HttpStatus.FORBIDDEN ? 'FORBIDDEN' : 'HTTP_ERROR';
      response.status(status).json({ error: { code, message: exception.message } });
      return;
    }

    if (exception instanceof KernelRuleError) {
      const status =
        exception.code === 'RESULT_NOT_FOUND' ? 404 : exception.code === 'TENANT_MISMATCH' ? 403 : 409;
      response.status(status).json({
        error: { code: exception.code, message: exception.message.replace(/^\w+:\s*/, '') },
      });
      return;
    }
    if (exception instanceof ZodError) {
      response.status(400).json({
        error: {
          code: 'INVALID_PAYLOAD',
          message: 'request failed contract validation',
          issues: exception.issues,
        },
      });
      return;
    }
   // A4: errori di tipo/struttura su input malformato (es. Buffer.from su number,
   // accesso a proprietà di null/undefined) sono MALFORMED_INPUT 400, non 500.
   // Questo chiude il gate fuzzing: payload patologico → 4xx di validazione, mai crash.
   if (exception instanceof TypeError) {
     response.status(400).json({
       error: {
         code: 'MALFORMED_INPUT',
         message: exception.message,
       },
     });
     return;
   }

   const message = exception instanceof Error ? exception.message : 'unexpected error';
   response.status(500).json({ error: { code: 'INTERNAL', message } });
  }
}
