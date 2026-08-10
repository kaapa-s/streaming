import 'reflect-metadata';
import { config } from 'dotenv';
import { existsSync } from 'fs';
import { join } from 'path';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';

config();

function resolvePageDist(): string {
  const candidates = [
    join(__dirname, '..', 'page', 'dist'),
    join(process.cwd(), 'page', 'dist'),
  ];
  const found = candidates.find((p) => existsSync(join(p, 'index.html')));
  if (!found) {
    throw new Error(
      `compositor page dist not found (looked in ${candidates.join(', ')}). Run: npm run build --prefix page`,
    );
  }
  return found;
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useWebSocketAdapter(new WsAdapter(app));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.enableCors({ origin: true });

  const pageDist = resolvePageDist();
  app.useStaticAssets(pageDist, { prefix: '/compositor' });
  const expressApp = app.getHttpAdapter().getInstance() as {
    get: (path: string, handler: (req: unknown, res: { sendFile: (p: string) => void }) => void) => void;
  };
  const sendIndex = (_req: unknown, res: { sendFile: (p: string) => void }) => {
    res.sendFile(join(pageDist, 'index.html'));
  };
  expressApp.get('/compositor', sendIndex);
  expressApp.get('/compositor/', sendIndex);

  const port = Number(process.env.PORT ?? 3002);
  await app.listen(port);
  console.log(`[compositor] listening on http://localhost:${port}`);
  console.log(`[compositor] recorder page at http://127.0.0.1:${port}/compositor/`);
}

void bootstrap();
