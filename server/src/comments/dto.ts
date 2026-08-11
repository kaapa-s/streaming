import { Type } from 'class-transformer';
import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class StartCommentsSessionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  declare videoUrl?: string;
}

export class ReplyCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  declare text: string;
}

export class OverlayCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  declare author: string;

  @IsString()
  @MinLength(1)
  @MaxLength(280)
  declare text: string;
}

export class SetOverlayDto {
  /** Pass `null` to clear the on-screen comment. */
  @ValidateIf((_, value) => value !== null)
  @ValidateNested()
  @Type(() => OverlayCommentDto)
  declare comment: OverlayCommentDto | null;
}
