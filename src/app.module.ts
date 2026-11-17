import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app.config';
import { HistoryModule } from './history/history.module';
import { OfferPlanningModule } from './offer-planning/offer-planning.module';

/** Root module wiring configuration, history and offer planning. */
@Module({ imports: [AppConfigModule, HistoryModule, OfferPlanningModule] })
export class AppModule {}
