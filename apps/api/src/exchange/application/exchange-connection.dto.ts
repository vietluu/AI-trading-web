import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

import {
  ExchangeEnvironment,
  ExchangeInterval,
  ExchangeProvider,
} from "../domain/exchange.types";

export class CreateExchangeConnectionDto {
  @ApiProperty({ enum: ExchangeProvider })
  @IsEnum(ExchangeProvider)
  provider!: ExchangeProvider;

  @ApiProperty({ enum: ExchangeEnvironment })
  @IsEnum(ExchangeEnvironment)
  environment!: ExchangeEnvironment;

  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  displayName?: string;

  @ApiProperty({ description: "Accepted once and never returned" })
  @IsString()
  @MinLength(4)
  @MaxLength(512)
  apiKey!: string;

  @ApiProperty({ description: "Accepted once and never returned" })
  @IsString()
  @MinLength(4)
  @MaxLength(512)
  apiSecret!: string;

  @ApiPropertyOptional({ description: "Required for OKX; never returned" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  passphrase?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  testConnection?: boolean;
}

export class UpdateExchangeConnectionDto {
  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  displayName?: string;

  @ApiPropertyOptional({ enum: ExchangeEnvironment })
  @IsOptional()
  @IsEnum(ExchangeEnvironment)
  environment?: ExchangeEnvironment;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiPropertyOptional({ description: "Complete replacement; never returned" })
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(512)
  apiKey?: string;

  @ApiPropertyOptional({ description: "Complete replacement; never returned" })
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(512)
  apiSecret?: string;

  @ApiPropertyOptional({ description: "Required for an OKX replacement" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  passphrase?: string;
}

export class InstrumentQueryDto {
  @ApiPropertyOptional({
    enum: ["TRADING", "SUSPENDED", "PRE_TRADING", "UNKNOWN"],
  })
  @IsOptional()
  @IsString()
  status?: string;
}

export class DepthQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  depth?: number;
}

export class LimitQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;
}

export class KlineQueryDto extends LimitQueryDto {
  @ApiProperty({ enum: ExchangeInterval })
  @IsEnum(ExchangeInterval)
  interval!: ExchangeInterval;

  @ApiPropertyOptional({ format: "date-time" })
  @IsOptional()
  @Transform(({ value }) => new Date(String(value)))
  @IsDate()
  startTime?: Date;

  @ApiPropertyOptional({ format: "date-time" })
  @IsOptional()
  @Transform(({ value }) => new Date(String(value)))
  @IsDate()
  endTime?: Date;
}

export class OpenOrdersQueryDto {
  @ApiPropertyOptional({ example: "BTC-USDT" })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  symbol?: string;
}

export class OrderLookupQueryDto {
  @ApiProperty({ example: "BTC-USDT" })
  @IsString()
  @MaxLength(40)
  symbol!: string;
}
