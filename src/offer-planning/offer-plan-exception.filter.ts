import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Response } from 'express';
import { NoEligibleDriversError, UnsupportedMarketError } from './domain/errors';

@Catch(UnsupportedMarketError, NoEligibleDriversError)
export class OfferPlanExceptionFilter implements ExceptionFilter {
  catch(error: UnsupportedMarketError | NoEligibleDriversError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    res.status(422).json({
      statusCode: 422,
      error: error instanceof UnsupportedMarketError ? 'UnsupportedMarket' : 'NoEligibleDrivers',
      message: error.message,
    });
  }
}
