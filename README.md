# Unísono (Reemplazar por el nombre final)

Sistema de sincronización en tiempo real diseñado para directores de orquesta y agrupaciones corales. Permite transmitir y cambiar partituras o letras de forma simultánea en los dispositivos móviles de los músicos a través de una red WiFi local, eliminando la fricción física y acústica del paso de páginas en papel.

Desarrollado como proyecto de integración técnica por estudiantes de programación web y Python, priorizando una arquitectura cliente-servidor de bajo consumo de recursos y ejecución aislada sin dependencias de internet.

## Características Principales

* **Operación LAN:** Funciona de manera autónoma en una red local. No requiere conexión a internet externa.
* **Sincronización Bidireccional:** Utiliza WebSockets para garantizar que todos los dispositivos cliente se actualicen en el milisegundo exacto en que el director avanza la página.
* **Zero-Install Frontend:** Interfaz de usuario construida con HTML, CSS y Vanilla JS. Los coristas solo necesitan ingresar una IP local en sus navegadores móviles.
* **Gestión de Energía:** Implementación de la API de Wake Lock para evitar que las pantallas de los celulares se apaguen por inactividad durante un concierto.

## Arquitectura del Sistema

El proyecto opera bajo un modelo de nodo central:
1. **Host (Director):** Ejecuta un servidor asíncrono en Python que levanta simultáneamente los archivos estáticos y el servidor de señalización WebSocket.
2. **Clientes (Coristas):** Se conectan al nodo central consumiendo la interfaz de solo lectura, la cual reacciona a los eventos de broadcast emitidos por el host.

## Stack Tecnológico

* **Backend:** Python 3.x, FastAPI, Uvicorn.
* **Frontend:** HTML5, CSS3, JavaScript (ES6).

## Instalación y Ejecución Local

1. Clonar este repositorio:
   ```bash
   git clone https://github.com/sergiogimenezclass/Atril-Digital.git
   ```
