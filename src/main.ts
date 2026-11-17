import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { loadAppConfig } from './config/app.config';

/**
 * Creates the Nest app with strict request validation and Swagger docs, then starts listening.
 * @returns A promise that resolves once the server is listening.
 * @throws If the app fails to start or the configuration is invalid.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Vamo Route Offer Ranking')
      .setDescription('Ranks drivers and picks a starting price for a new route.')
      .setVersion('0.1.0')
      .build(),
  );
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs/json' });
  await app.listen(loadAppConfig().port);
}

void bootstrap();
