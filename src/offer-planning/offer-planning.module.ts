import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { HistoryModule } from '../history/history.module';
import { DEFAULT_PLANNING_CONFIG } from './domain/offer-planning.config';
import { OfferModelRegistry, PLANNING_CONFIG } from './offer-model.registry';
import { OfferPlanExceptionFilter } from './offer-plan-exception.filter';
import { OfferPlanningController } from './offer-planning.controller';
import { OfferPlanningService } from './offer-planning.service';

@Module({
  imports: [HistoryModule],
  controllers: [OfferPlanningController],
  providers: [
    OfferModelRegistry,
    OfferPlanningService,
    { provide: PLANNING_CONFIG, useValue: DEFAULT_PLANNING_CONFIG },
    { provide: APP_FILTER, useClass: OfferPlanExceptionFilter },
  ],
})
/** Wires the offer planning controller, service, model registry, config and exception filter. */
export class OfferPlanningModule {}
