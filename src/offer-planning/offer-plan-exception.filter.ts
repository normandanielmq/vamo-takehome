import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Response } from 'express';
import { NoEligibleDriversError, UnsupportedMarketError } from './domain/errors';

/** Maps planning domain errors to HTTP 422 responses. */
@Catch(UnsupportedMarketError, NoEligibleDriversError)
export class OfferPlanExceptionFilter implements ExceptionFilter {
  /**
   * Writes a 422 JSON response describing the error.
   * @param error - The domain error that was thrown.
   * @param host - Execution context used to access the HTTP response.
   */
  catch(error: UnsupportedMarketError | NoEligibleDriversError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    res.status(422).json({
      statusCode: 422,
      error: error instanceof UnsupportedMarketError ? 'UnsupportedMarket' : 'NoEligibleDrivers',
      message: error.message,
    });
  }
}
