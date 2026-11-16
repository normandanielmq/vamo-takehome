import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CreateOfferPlanDto } from './dto/create-offer-plan.dto';
import { OfferPlanningService } from './offer-planning.service';

@ApiTags('offer-plans')
@Controller('offer-plans')
export class OfferPlanningController {
  constructor(private readonly service: OfferPlanningService) {}

  @Post()
  @ApiOperation({ summary: 'Rank drivers, group them into waves and pick a starting price for a route' })
  @ApiResponse({ status: 200, description: 'Offer plan (probabilities are model estimates)' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 422, description: 'Market not in the data, or every driver excluded' })
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
