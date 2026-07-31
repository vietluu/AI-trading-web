import { ApiProperty } from "@nestjs/swagger";
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

export class RegisterDto {
  @ApiProperty({ example: "trader@example.com" })
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ example: "trader_one" })
  @IsString()
  @Length(3, 32)
  @Matches(/^[a-zA-Z0-9_-]+$/)
  username!: string;

  @ApiProperty({ minLength: 12 })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}

export class LoginDto {
  @ApiProperty({ example: "trader@example.com" })
  @IsString()
  @MaxLength(320)
  identifier!: string;

  @ApiProperty({ format: "password" })
  @IsString()
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}

export class VerifyEmailDto {
  @IsString()
  @Length(32, 128)
  token!: string;
}

export class TotpCodeDto {
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}

export class DisableTotpDto extends TotpCodeDto {
  @IsString()
  @MaxLength(128)
  currentPassword!: string;
}

export class ReauthenticateDto {
  @ApiProperty({ format: "password" })
  @IsString()
  @MaxLength(128)
  password!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: "trader@example.com" })
  @IsEmail()
  @MaxLength(320)
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: "Single-use password reset token" })
  @IsString()
  @Length(32, 128)
  token!: string;

  @ApiProperty({ format: "password", minLength: 12 })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  newPassword!: string;
}

export class ChangePasswordDto {
  @ApiProperty({ format: "password" })
  @IsString()
  @MaxLength(128)
  currentPassword!: string;

  @ApiProperty({ format: "password", minLength: 12 })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  newPassword!: string;
}
