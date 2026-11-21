import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/** Comprobación de estado: confirma que la API responde y que la BD contesta. */
@Controller('salud')
export class SaludController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get()
  async estado() {
    let baseDatos = 'ok';
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      baseDatos = 'sin conexión';
    }
    return {
      servicio: 'retiro-seguro-api',
      estado: baseDatos === 'ok' ? 'ok' : 'degradado',
      baseDatos,
      momento: new Date().toISOString(),
    };
  }
}
