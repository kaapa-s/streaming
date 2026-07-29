import { IsString, Matches, MinLength } from 'class-validator';

export class CreateRoomDto {
  @IsString()
  @MinLength(1)
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'slug must be alphanumeric, hyphen, or underscore',
  })
  declare slug: string;
}
