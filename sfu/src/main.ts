import 'reflect-metadata';
import { config } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';

config();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableCors({ origin: true });

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  console.log(`[sfu] listening on http://localhost:${port}`);
}

void bootstrap();
