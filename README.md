# Índice UV en el campus de la UNA

Portal público con las mediciones del índice de radiación ultravioleta de la estación UV-001, instalada en el campus de la Universidad Nacional de Asunción (San Lorenzo, Paraguay).

Trabajo Final de Grado de Juan Alberto Gamarra Aquino y José Emilio Velázquez Insaurralde, Ingeniería en Electrónica, Facultad Politécnica, UNA.

## Cómo funciona

El sitio es estático y se publica con GitHub Pages. No tiene backend: el servidor del laboratorio genera `data/data.json` cada 10 minutos, 2 minutos después de cada medición, y lo sube a este repositorio. Toda la visualización se calcula en el navegador.

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
  "calibration_version": "2026-10-TUV-v1 (preliminar)",
  "export_interval_minutes": 10,
  "measurement_interval_minutes": 10,
  "measurement_windows": [
    { "from": "2026-10-16", "start": "06:00", "end": "20:30" },
    { "from": "2026-11-01", "start": "05:30", "end": "21:00" }
  ],
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
  "current": { "measured_at": "2026-10-26T12:09:58-03:00", "uv_index": 12.1, "uv_intensity": 12.29, "estado": "valido" },
  "days": [
    { "date": "2026-10-26", "series": [[430, 0.6, 0.78, "estimado"], [730, 12.1, 12.29, "valido"]] }
  ]
}
```

Cada elemento de `series` es `[minuto del día en hora local, índice UV calibrado (1 decimal), intensidad en mW/cm², estado]`. El índice UV se calcula a partir de la intensidad con la calibración indicada en `calibration_version`; `estado` es `"valido"` o `"estimado"` (sol a menos de 32° de altura, el sensor queda parcialmente en sombra). Los minutos se ubican en una grilla de 5 minutos; la estación mide cada `measurement_interval_minutes`. `measurement_windows` indica la ventana de medición de la estación vigente desde cada fecha (hora local); "Datos recibidos" se calcula sobre los ciclos esperados en esa ventana y, si el campo falta, se usa 06:00–20:30. Las coordenadas se publican redondeadas a dos decimales. `days` contiene los últimos 30 días.

## Prueba local

```bash
python3 -m http.server 8000
```

Luego abrir `http://localhost:8000`. Abrir `index.html` directamente desde el disco no funciona, porque el navegador bloquea la lectura de `data.json`.
