import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

describe('Comprobación de estado (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const modulo: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = modulo.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /api/v1/salud responde con el estado del servicio', async () => {
    const respuesta = await request(app.getHttpServer())
      .get('/api/v1/salud')
      .expect(200);
    expect(respuesta.body.servicio).toBe('retiro-seguro-api');
    expect(respuesta.body).toHaveProperty('baseDatos');
  });
});
