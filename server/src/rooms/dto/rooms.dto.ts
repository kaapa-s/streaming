import { IsArray, IsIn, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class CreateRoomDto {
  /** Human name only — the slug is server-minted so the invite link stays unguessable. */
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  declare title: string;
}

export class SetLayoutDto {
  @IsIn(['focus', 'pip-left', 'pip-right', 'grid'])
  declare cameraPreset: 'focus' | 'pip-left' | 'pip-right' | 'grid';

  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MinLength(1)
  declare featuredId: string | null;

  @IsArray()
  @IsString({ each: true })
  declare sceneScreenIds: string[];
}
