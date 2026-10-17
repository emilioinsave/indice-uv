# Índice UV en el campus de la UNA

Portal público con las mediciones del índice de radiación ultravioleta de la estación UV-001, instalada en el campus de la Universidad Nacional de Asunción (San Lorenzo, Paraguay).

Trabajo Final de Grado de Juan Alberto Gamarra Aquino y José Emilio Velázquez Insaurralde, Ingeniería en Electrónica, Facultad Politécnica, UNA.

## Cómo funciona

El sitio es estático y se publica con GitHub Pages. No tiene backend: el servidor del laboratorio genera `data/data.json` cada 15 minutos y lo sube a este repositorio. Toda la visualización se calcula en el navegador.

```
index.html              página
assets/css/styles.css   estilos (modo claro y oscuro)
assets/js/app.js        carga de datos, modelo solar, gráficos SVG y tablas
assets/img/             logo de la FPUNA
data/data.json          datos publicados por el servidor
```

## Formato de `data/data.json`

```json
{
  "schema_version": 1,
  "is_sample": false,
  "generated_at": "2026-10-02T14:45:00-03:00",
  "utc_offset_minutes": -180,
  "export_interval_minutes": 15,
  "measurement_interval_minutes": 5,
  "stale_after_minutes": 30,
  "station": {
    "id": "UV-001",
    "name": "Estación UV-001",
    "place": "Campus de la UNA, San Lorenzo, Paraguay",
    "latitude": -25.34,
    "longitude": -57.52,
    "sensor": "DFRobot SEN0642 (RS485/Modbus)",
    "uv_index_range": [0, 15]
  },
  "current": { "measured_at": "2026-10-02T14:40:00-03:00", "uv_index": 9, "uv_intensity": 0.89 },
  "days": [
    { "date": "2026-10-02", "series": [[600, 6, 0.61], [605, 6, 0.63]] }
  ]
}
```

Cada elemento de `series` es `[minuto del día en hora local, índice UV, intensidad en mW/cm²]`. Las coordenadas se publican redondeadas a dos decimales. `days` contiene los últimos 30 días.

## Prueba local

```bash
python3 -m http.server 8000
```

Luego abrir `http://localhost:8000`. Abrir `index.html` directamente desde el disco no funciona, porque el navegador bloquea la lectura de `data.json`.
