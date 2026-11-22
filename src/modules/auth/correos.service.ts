import { Injectable } from '@nestjs/common';
import { html, Mailer } from '@nestjs/mail';

const formatoHora = new Intl.DateTimeFormat('es-CO', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'America/Bogota',
});

/** Los correos de la cuenta: activación y recuperación de contraseña. */
@Injectable()
export class CorreosService {
  constructor(private readonly mailer: Mailer) {}

  async enviarActivacion(
    correo: string,
    url: string,
    expira: Date,
  ): Promise<void> {
    await this.mailer.send({
      to: correo,
      subject: 'Active su cuenta de Retiro Seguro',
      html: html`
        <p>La I.E. Esteban Ochoa creó su cuenta en Retiro Seguro.</p>
        <p>Para activarla, defina su contraseña en este enlace:</p>
        <p><a href="${url}">Activar mi cuenta</a></p>
        <p>
          El enlace vence el ${formatoHora.format(expira)} y solo se puede usar
          una vez.
        </p>
        <p>Si usted no esperaba este correo, ignórelo.</p>
      `,
    });
  }

  async enviarRecuperacion(
    correo: string,
    url: string,
    expira: Date,
  ): Promise<void> {
    await this.mailer.send({
      to: correo,
      subject: 'Restablezca su contraseña de Retiro Seguro',
      html: html`
        <p>Recibimos una solicitud para restablecer su contraseña.</p>
        <p><a href="${url}">Definir una contraseña nueva</a></p>
        <p>
          El enlace vence en 30 minutos (${formatoHora.format(expira)}) y solo
          se puede usar una vez.
        </p>
        <p>
          Si usted no lo solicitó, ignore este correo: su contraseña no cambia.
        </p>
      `,
    });
  }
}
