import { IsEmail, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  declare email: string;

  @IsString()
  @MinLength(8)
  declare password: string;

  @IsString()
  @MinLength(1)
  declare name: string;
}

export class LoginDto {
  @IsEmail()
  declare email: string;

  @IsString()
  @MinLength(1)
  declare password: string;
}

export class RefreshDto {
  @IsString()
  @MinLength(1)
  declare refreshToken: string;
}
