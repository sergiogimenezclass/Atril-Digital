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

### 1. Clonar este repositorio
```bash
git clone https://github.com/sergiogimenezclass/Atril-Digital.git
cd Atril-Digital
```

### 2. Configurar el Entorno Virtual (Recomendado)
Para mantener las dependencias aisladas del sistema operativo:
```bash
# Crear el entorno virtual
python3 -m venv venv

# Instalar las dependencias
venv/bin/pip install -r requirements.txt
```

### 3. Iniciar el Servidor
Ejecuta el script principal. En su primer arranque, el servidor descargará de forma automática las librerías `pdf.min.js` y `pdf.worker.min.js` para guardarlas localmente (permitiendo el posterior uso 100% offline) y generará los certificados SSL auto-firmados en la carpeta `ssl/`.
```bash
venv/bin/python main.py
```
*En la terminal se listarán las direcciones IP locales de red disponibles para que se conecten los músicos.*

---

## Guía de Uso

1. **Panel del Director (Host):**
   * Abre tu navegador en la computadora e ingresa a: `https://localhost:8000/director`
   * *Nota de Seguridad:* Al usar un certificado de seguridad auto-firmado local, el navegador mostrará una advertencia de "Conexión no privada". Haz clic en **Avanzado** -> **Acceder/Continuar (no seguro)**. Esto es completamente normal y seguro en redes locales (y obligatorio para que los celulares permitan la API de Wake Lock).
   * Pasa las páginas utilizando los botones **Anterior** / **Siguiente** en pantalla, o mediante atajos de teclado (**Flechas del teclado** o **Barra espaciadora**).
   * Sube partituras arrastrando tus archivos PDF al área designada.

2. **Panel de los Músicos (Clientes):**
   * Pídeles a los músicos que conecten sus teléfonos a la misma red WiFi que tu computadora.
   * Deben abrir el navegador móvil e ingresar la dirección IP de red LAN que se muestra en tu consola del servidor (por ejemplo, `https://192.168.1.15:8000`).
   * Para evitar que la pantalla de sus dispositivos móviles se apague por inactividad durante la presentación, indícales activar el interruptor de **Pantalla Activa** en el panel superior.

---

## Solución de Problemas Comunes de Red

### No se puede conectar al servidor desde el celular (`ERR_ADDRESS_UNREACHABLE` / `ERR_CONNECTION_TIMED_OUT`)

#### 1. Firewall bloqueando el puerto (Linux)
Por defecto, Linux suele tener activo un firewall que bloquea puertos entrantes como el `8000`.
Para permitir conexiones en este puerto, abre una terminal y ejecuta:
```bash
sudo ufw allow 8000/tcp
```
*(O puedes desactivar el firewall temporalmente con `sudo ufw disable` para pruebas).*

#### 2. Aislamiento de Clientes en el Router (Redes Públicas/Escuelas/Trabajo)
En redes compartidas grandes (oficinas, escuelas, universidades o redes WiFi públicas), el router suele bloquear la comunicación directa entre dispositivos conectados por seguridad (Client/AP Isolation).
* **Solución:** Activa la función de **"Compartir Internet" / "Hotspot"** en tu celular, conecta tu computadora a esa red WiFi generada por el móvil, y reinicia el servidor. El celular actuará como router sin aislamiento y asignará una nueva IP local que sí funcionará al instante.

