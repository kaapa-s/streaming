import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class InternalSecretGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.COMPOSITOR_INTERNAL_SECRET?.trim();
    if (!expected) {
      throw new UnauthorizedException('COMPOSITOR_INTERNAL_SECRET is not configured');
    }
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const headerRaw = req.headers['x-internal-secret'];
    const authRaw = req.headers.authorization;
    const header = Array.isArray(headerRaw) ? headerRaw[0] : headerRaw;
    const auth = Array.isArray(authRaw) ? authRaw[0] : authRaw;
    const bearer =
      auth && auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
    const provided = (header ?? '').trim() || bearer;
    if (!provided || provided !== expected) {
      throw new UnauthorizedException('invalid internal secret');
    }
    return true;
  }
}
