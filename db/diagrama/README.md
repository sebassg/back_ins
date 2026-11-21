# Diagrama del modelo de datos

- **`er.mmd`** — fuente del diagrama entidad-relación, en sintaxis
  [Mermaid](https://mermaid.js.org/syntax/entityRelationshipDiagram.html).
  Es el archivo que se actualiza con cada HU que agregue o cambie tablas.
  Sin comentarios `%%`: el parser de `erDiagram` no los admite. Las notas van
  entre comillas al final de cada atributo.
- **`er.png`** — imagen generada a partir de `er.mmd`, para el informe y las
  revisiones de sprint.
- **`CHANGELOG.md`** — qué tablas agregó cada historia.
- `mermaid.json` y `puppeteer.json` — configuración del renderizado.

## Ver el diagrama

La forma rápida: pegar el contenido de `er.mmd` en <https://mermaid.live>, o
instalar en VS Code la extensión *Markdown Preview Mermaid Support*.

## Regenerar `er.png`

Requiere un Chromium o Chrome instalado. No hace falta agregar nada a las
dependencias del proyecto:

```bash
npx -y -p @mermaid-js/mermaid-cli -p puppeteer mmdc \
  -i db/diagrama/er.mmd -o db/diagrama/er.png \
  -c db/diagrama/mermaid.json -p db/diagrama/puppeteer.json \
  -b white --size 3600 --scale 2
```

Si Chromium está instalado en el sistema (en vez de descargado por puppeteer),
anteponga `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`.
