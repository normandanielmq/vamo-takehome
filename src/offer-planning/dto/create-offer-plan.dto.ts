import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsInt, IsISO8601, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString,
  Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

export class RouteDto {
  @IsOptional() @IsString() routeId?: string;
  @IsString() @IsNotEmpty() @MaxLength(32) market!: string;
  @IsOptional() @IsISO8601() scheduledStart?: string;
  @IsInt() @Min(1) stopCount!: number;
  @IsNumber() @IsPositive() totalMiles!: number;
}

export class AvailableDriverDto {
  @IsString() @IsNotEmpty() driverId!: string;
  @IsOptional() @IsNumber() @Min(0) @Max(5) rating?: number;
  @IsOptional() @IsInt() @Min(0) routesCompleted90d?: number;
}

export class CreateOfferPlanDto {
  @ValidateNested() @Type(() => RouteDto) route!: RouteDto;

  @ValidateNested({ each: true })
  @Type(() => AvailableDriverDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  availableDrivers!: AvailableDriverDto[];
}
