import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useWebSocketAdapter(new WsAdapter(app));
  app.setGlobalPrefix('api');
  app.enableCors({ origin: true });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`[server] listening on http://localhost:${port}`);
}

void bootstrap();
