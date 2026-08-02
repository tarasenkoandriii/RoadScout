import { IsIn, IsInt, Max, Min } from 'class-validator';

export class ReportWaitDto {
  @IsIn(['UA_OUT', 'UA_IN'])
  direction!: 'UA_OUT' | 'UA_IN';

  @IsInt()
  @Min(0)
  @Max(1440)
  waitMinutes!: number;
}
