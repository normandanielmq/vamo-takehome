import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { CreateOfferPlanDto } from './dto/create-offer-plan.dto';
import { OfferPlanningService } from './offer-planning.service';

@Controller('offer-plans')
export class OfferPlanningController {
  constructor(private readonly service: OfferPlanningService) {}

  @Post()
  @HttpCode(200)
  create(@Body() dto: CreateOfferPlanDto) {
    const { plan, excludedDrivers, modelVersion, operationalProfile } = this.service.createPlan({
      route: {
        routeId: dto.route.routeId,
        market: dto.route.market,
        scheduledStart: dto.route.scheduledStart ? new Date(dto.route.scheduledStart) : undefined,
        stopCount: dto.route.stopCount,
        totalMiles: dto.route.totalMiles,
      },
      drivers: dto.availableDrivers,
    });
    return {
      routeId: dto.route.routeId ?? null,
      market: dto.route.market,
      scheduledStart: dto.route.scheduledStart ?? null,
      ...plan,
      excludedDrivers,
      modelVersion,
      operationalProfile,
      note: 'Probabilities and expected values are model estimates, not calibrated guarantees.',
    };
  }
}
