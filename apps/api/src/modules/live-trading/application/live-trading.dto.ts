import { IsString, IsUUID, Length, Matches } from "class-validator";

export class ExecuteApprovedOrderDto {
  @IsUUID("4")
  connectionId!: string;

  @IsUUID("4")
  riskAssessmentId!: string;

  @IsString()
  @Length(8, 36)
  @Matches(/^[A-Za-z0-9_-]+$/)
  clientOrderId!: string;
}

export class SyncConnectionDto {
  @IsUUID("4")
  connectionId!: string;
}

export class CloseApprovedPositionDto extends ExecuteApprovedOrderDto {
  @IsString()
  @Matches(/^[A-Z0-9]{2,15}-[A-Z0-9]{2,15}$/)
  symbol!: string;
}
