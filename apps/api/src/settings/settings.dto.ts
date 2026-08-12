import { Type } from "class-transformer";
import { ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class UpdateSettingsDto {
  @ApiPropertyOptional({ enum: ["dark", "light", "system"] })
  @IsOptional()
  @IsIn(["dark", "light", "system"])
  theme?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @ApiPropertyOptional({ enum: ["BINANCE", "OKX"] })
  @IsOptional()
  @IsIn(["BINANCE", "OKX"])
  preferredExchange?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(32, { each: true })
  preferredSymbols?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(16, { each: true })
  preferredTimeframes?: string[];

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  aiDailyBudget?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 125 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(125)
  defaultLeverage?: number;

  @ApiPropertyOptional({ enum: ["CONSERVATIVE", "MODERATE", "AGGRESSIVE"] })
  @IsOptional()
  @IsIn([
    "CONSERVATIVE",
    "MODERATE",
    "AGGRESSIVE",
    "conservative",
    "moderate",
    "aggressive",
  ])
  riskPreference?: string;

  @ApiPropertyOptional({ minimum: 0.001, maximum: 0.02 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 5 })
  @Min(0.001)
  @Max(0.02)
  maxRiskPerTrade?: number;
}
