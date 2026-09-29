# Finance Tracker

Aplicación web personal para el control de finanzas. Permite registrar ingresos y gastos, revisar resúmenes mensuales por categoría y administrar apartados de ahorro con metas definidas.

## Características

- Registro de movimientos (ingresos, gastos y ahorro) con monto, categoría, fecha y nota opcional.
- Categorías personalizables, creadas y editadas desde la misma interfaz.
- Resumen mensual con balance, total de ingresos y total de gastos.
- Desglose de gastos por categoría.
- Apartados de ahorro con meta objetivo, depósitos y retiros, y saldo acumulado independiente del mes en curso.
- Modo claro y oscuro, con preferencia guardada localmente.
- Diseño enfocado en uso móvil, pensado para instalarse como aplicación web progresiva (PWA).

## Estructura del proyecto

```
index.html   Estructura de la interfaz
styles.css   Estilos y temas
app.js       Lógica de la aplicación y manejo de datos
```

## Almacenamiento de datos

La aplicación guarda su información mediante una capacidad de base de datos disponible al publicarse como artifact en Claude. Cuando esa conexión no está disponible, los datos se almacenan de forma local en el navegador (`localStorage`) sin pérdida de funcionalidad.

## Uso

El proyecto no requiere instalación ni dependencias externas. Basta con abrir `index.html` en un navegador, o publicar el artifact para habilitar el almacenamiento persistente y el uso desde distintos dispositivos.

## Estado

Proyecto de desarrollo personal, en construcción iterativa.
