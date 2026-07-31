import { CredentialProvider } from "@prisma/client";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEnum,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from "class-validator";

export class CreateCredentialDto {
  @ApiProperty({ enum: CredentialProvider })
  @IsEnum(CredentialProvider)
  provider!: CredentialProvider;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  label?: string;

  @ApiProperty({
    description: "Secret value; accepted once and never returned",
  })
  @IsString()
  @MinLength(4)
  @MaxLength(512)
  apiKey!: string;

  @ApiPropertyOptional({
    description: "Secret value; accepted once and never returned",
  })
  @IsOptional()
  @IsString()
  @Length(1, 512)
  secret?: string;

  @ApiPropertyOptional({
    description: "Secret value; accepted once and never returned",
  })
  @IsOptional()
  @IsString()
  @Length(1, 512)
  passphrase?: string;
}

export class UpdateCredentialDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  label?: string;

  @ApiPropertyOptional({ description: "Replacement secret value" })
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(512)
  apiKey?: string;

  @ApiPropertyOptional({ description: "Replacement secret value" })
  @IsOptional()
  @IsString()
  @Length(1, 512)
  secret?: string;

  @ApiPropertyOptional({ description: "Replacement secret value" })
  @IsOptional()
  @IsString()
  @Length(1, 512)
  passphrase?: string;
}
