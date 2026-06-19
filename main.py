import os
import sys
import socket
import datetime
import ipaddress
import requests
import mimetypes
from typing import List
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, UploadFile, File
from fastapi.responses import JSONResponse, FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
import uvicorn

# Inicializar y corregir posibles mapeos de tipos MIME corruptos en el sistema operativo host
mimetypes.init()
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/javascript", ".mjs")

# Asegurar directorios requeridos al importar (para StaticFiles)
os.makedirs("uploads", exist_ok=True)
os.makedirs("static", exist_ok=True)


# --- Detección de IPs locales ---
def get_local_ips() -> List[str]:
    """Obtiene todas las direcciones IP locales (IPv4) de la máquina."""
    ips = ["127.0.0.1"]
    
    # Intenta obtener la IP mediante el hostname
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None):
            ip = info[4][0]
            if ":" not in ip and ip not in ips:
                ips.append(ip)
    except Exception:
        pass
        
    # Método alternativo usando un socket UDP hacia afuera
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        if ip not in ips:
            ips.append(ip)
        s.close()
    except Exception:
        pass
        
    return list(set(ips))

# --- Generación automática de certificados SSL ---
def generate_self_signed_cert(ssl_dir="ssl"):
    """Genera un certificado SSL auto-firmado válido para localhost y las IPs de la LAN."""
    key_path = os.path.join(ssl_dir, "key.pem")
    cert_path = os.path.join(ssl_dir, "cert.pem")
    
    if os.path.exists(key_path) and os.path.exists(cert_path):
        return key_path, cert_path
        
    print("Generando certificados SSL auto-firmados...")
    os.makedirs(ssl_dir, exist_ok=True)
    
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.primitives import serialization
    
    # Generar clave privada RSA
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
    )
    
    # Configurar nombres del emisor y sujeto
    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "AR"),
        x509.NameAttribute(NameOID.STATE_OR_PROVINCE_NAME, "Buenos Aires"),
        x509.NameAttribute(NameOID.LOCALITY_NAME, "Unisono"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Unisono"),
        x509.NameAttribute(NameOID.COMMON_NAME, "unisono.local"),
    ])
    
    # Agregar IPs de la LAN y localhost a los Nombres Alternativos (SANs)
    local_ips = get_local_ips()
    alt_names = [x509.DNSName("localhost"), x509.DNSName("unisono.local")]
    for ip in local_ips:
        try:
            alt_names.append(x509.IPAddress(ipaddress.ip_address(ip)))
        except ValueError:
            alt_names.append(x509.DNSName(ip))
            
    # Construir el certificado
    cert = x509.CertificateBuilder().subject_name(
        subject
    ).issuer_name(
        issuer
    ).public_key(
        private_key.public_key()
    ).serial_number(
        x509.random_serial_number()
    ).not_valid_before(
        datetime.datetime.utcnow() - datetime.timedelta(days=1)
    ).not_valid_after(
        # Válido por 10 años
        datetime.datetime.utcnow() + datetime.timedelta(days=365 * 10)
    ).add_extension(
        x509.SubjectAlternativeName(alt_names),
        critical=False,
    ).sign(private_key, hashes.SHA256())
    
    # Escribir la clave privada a archivo
    with open(key_path, "wb") as f:
        f.write(private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        ))
        
    # Escribir el certificado a archivo
    with open(cert_path, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))
        
    print(f"Certificado SSL auto-firmado generado con éxito en '{ssl_dir}/'.")
    return key_path, cert_path

# --- Descarga local de las librerías de PDF.js ---
def download_pdfjs(static_dir="static"):
    """Descarga PDF.js y su worker y los almacena localmente para funcionamiento sin internet."""
    lib_dir = os.path.join(static_dir, "js", "libs")
    os.makedirs(lib_dir, exist_ok=True)
    
    pdf_js_path = os.path.join(lib_dir, "pdf.min.js")
    pdf_worker_path = os.path.join(lib_dir, "pdf.worker.min.js")
    
    pdf_js_url = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"
    pdf_worker_url = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"
    
    try:
        if not os.path.exists(pdf_js_path):
            print(f"Descargando {pdf_js_url}...")
            r = requests.get(pdf_js_url, timeout=15)
            r.raise_for_status()
            with open(pdf_js_path, "wb") as f:
                f.write(r.content)
            print("Guardado pdf.min.js.")
            
        if not os.path.exists(pdf_worker_path):
            print(f"Descargando {pdf_worker_url}...")
            r = requests.get(pdf_worker_url, timeout=15)
            r.raise_for_status()
            with open(pdf_worker_path, "wb") as f:
                f.write(r.content)
            print("Guardado pdf.worker.min.js.")
    except Exception as e:
        print(f"Advertencia al descargar PDF.js: {e}")
        print("Si no hay internet, deberás colocar pdf.min.js y pdf.worker.min.js manualmente en static/js/libs/")

# --- Generación de una partitura PDF de muestra ---
def generate_sample_pdf(filepath: str):
    """Genera un PDF de muestra de 3 páginas con offsets de bytes calculados dinámicamente."""
    objects = []
    
    # Objeto 1: Catalog
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    # Objeto 2: Pages Catalog
    objects.append(b"<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>")
    
    # Contenidos de streams
    stream1 = (
        b"BT\n"
        b"/F1 24 Tf\n"
        b"50 750 Td\n"
        b"(UNISONO - ATRIL DIGITAL) Tj\n"
        b"/F1 16 Tf\n"
        b"0 -40 Td\n"
        b"(Esta es la Pagina 1 de la partitura de muestra.) Tj\n"
        b"0 -35 Td\n"
        b"(La sincronizacion en tiempo real esta activa.) Tj\n"
        b"0 -30 Td\n"
        b"(El director puede pasar las paginas.) Tj\n"
        b"ET"
    )
    
    stream2 = (
        b"BT\n"
        b"/F1 24 Tf\n"
        b"50 750 Td\n"
        b"(UNISONO - SEGUNDA PAGINA) Tj\n"
        b"/F1 16 Tf\n"
        b"0 -40 Td\n"
        b"(Esta es la Pagina 2 de la partitura.) Tj\n"
        b"0 -35 Td\n"
        b"(Los musicos ven esta pagina en sus dispositivos.) Tj\n"
        b"0 -30 Td\n"
        b"(La pantalla se mantendra encendida.) Tj\n"
        b"ET"
    )
    
    stream3 = (
        b"BT\n"
        b"/F1 24 Tf\n"
        b"50 750 Td\n"
        b"(UNISONO - TERCERA PAGINA) Tj\n"
        b"/F1 16 Tf\n"
        b"0 -40 Td\n"
        b"(Esta es la Pagina 3: Coda final y Cierre.) Tj\n"
        b"0 -35 Td\n"
        b"(El proyecto funciona de manera 100% local.) Tj\n"
        b"0 -30 Td\n"
        b"(Fin de la partitura de muestra.) Tj\n"
        b"ET"
    )
    
    # Objeto 3, 4, 5: Pages
    objects.append(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 6 0 R >> >> /Contents 7 0 R >>")
    objects.append(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 6 0 R >> >> /Contents 8 0 R >>")
    objects.append(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 6 0 R >> >> /Contents 9 0 R >>")
    
    # Objeto 6: Font
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")
    
    # Ensamblar contenido del PDF y calcular offsets de bytes exactos
    pdf_bytes = b"%PDF-1.4\n"
    offsets = {}
    compiled_objs = {}
    
    # Objetos del 1 al 6 (diccionarios estándar)
    for i in range(1, 7):
        compiled_objs[i] = f"{i} 0 obj\n".encode('ascii') + objects[i-1] + b"\nendobj\n"
        
    # Objetos 7, 8, 9 (objetos de stream con longitud calculada)
    for i, stream_content in enumerate([stream1, stream2, stream3], start=7):
        length = len(stream_content)
        compiled_objs[i] = (
            f"{i} 0 obj\n<< /Length {length} >>\nstream\n".encode('ascii') 
            + stream_content 
            + b"\nendstream\nendobj\n"
        )
        
    # Unir todos los objetos y guardar sus posiciones
    for i in range(1, 10):
        offsets[i] = len(pdf_bytes)
        pdf_bytes += compiled_objs[i]
        
    # Generar tabla xref
    startxref = len(pdf_bytes)
    pdf_bytes += b"xref\n0 10\n0000000000 65535 f\n"
    for i in range(1, 10):
        pdf_bytes += f"{offsets[i]:010d} 00000 n\n".encode('ascii')
        
    # Generar trailer y startxref
    pdf_bytes += b"trailer\n<< /Size 10 /Root 1 0 R >>\n"
    pdf_bytes += b"startxref\n"
    pdf_bytes += f"{startxref}\n".encode('ascii')
    pdf_bytes += b"%%EOF\n"
    
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(filepath, "wb") as f:
        f.write(pdf_bytes)
    print(f"Archivo de muestra PDF creado en {filepath}")

# --- Manejador de conexiones WebSocket ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        await self.broadcast_client_count()

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                disconnected.append(connection)
        
        for conn in disconnected:
            self.disconnect(conn)

    async def broadcast_client_count(self):
        await self.broadcast({
            "type": "client_count",
            "count": len(self.active_connections)
        })

manager = ConnectionManager()

# --- Configuración del estado global ---
class AppState:
    def __init__(self):
        self.current_document = "partitura_muestra.pdf"
        self.current_page = 1

state = AppState()

# --- Ciclo de vida de FastAPI ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Asegurar directorios
    os.makedirs("uploads", exist_ok=True)
    os.makedirs("static", exist_ok=True)
    
    # Cargar recursos locales
    download_pdfjs("static")
    
    # Generar PDF de muestra
    sample_pdf_path = os.path.join("uploads", "partitura_muestra.pdf")
    if not os.path.exists(sample_pdf_path):
        generate_sample_pdf(sample_pdf_path)
        
    yield

app = FastAPI(title="Unísono - Atril Digital", lifespan=lifespan)

# --- Rutas de API ---
@app.get("/api/state")
async def get_state():
    return {
        "document": f"/uploads/{state.current_document}",
        "document_name": state.current_document,
        "page": state.current_page
    }

@app.get("/api/documents")
async def list_documents():
    files = [f for f in os.listdir("uploads") if f.lower().endswith(".pdf")]
    return {"documents": files}

@app.post("/api/upload")
async def upload_document(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Solo se permiten archivos PDF.")
        
    file_path = os.path.join("uploads", file.filename)
    
    # Guardar archivo
    with open(file_path, "wb") as f:
        f.write(await file.read())
        
    # Actualizar estado
    state.current_document = file.filename
    state.current_page = 1
    
    # Notificar a los clientes
    await manager.broadcast({
        "type": "document_change",
        "document": f"/uploads/{state.current_document}",
        "document_name": state.current_document,
        "page": 1
    })
    
    return {"status": "success", "filename": file.filename}

@app.get("/api/ips")
async def get_ips():
    return {"ips": get_local_ips()}

# --- WebSocket Endpoint ---
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    
    # Enviar estado actual al cliente recién conectado
    await websocket.send_json({
        "type": "sync",
        "document": f"/uploads/{state.current_document}",
        "document_name": state.current_document,
        "page": state.current_page,
        "clients_count": len(manager.active_connections)
    })
    
    try:
        while True:
            data = await websocket.receive_json()
            command = data.get("command")
            
            if command == "change_page":
                page = data.get("page", 1)
                state.current_page = page
                await manager.broadcast({
                    "type": "page_change",
                    "page": page
                })
                
            elif command == "change_document":
                document_name = data.get("document", "")
                if document_name:
                    # Validar que exista el archivo
                    if os.path.exists(os.path.join("uploads", document_name)):
                        state.current_document = document_name
                        state.current_page = 1
                        await manager.broadcast({
                            "type": "document_change",
                            "document": f"/uploads/{state.current_document}",
                            "document_name": state.current_document,
                            "page": 1
                        })
                        
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        await manager.broadcast_client_count()
    except Exception:
        manager.disconnect(websocket)
        await manager.broadcast_client_count()

# --- Redirecciones convenientes ---
@app.get("/")
async def root_redirect():
    return RedirectResponse(url="/static/index.html")

@app.get("/director")
async def director_redirect():
    return RedirectResponse(url="/static/director.html")

# --- Servir archivos estáticos ---
app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

if __name__ == "__main__":
    ssl_key, ssl_cert = generate_self_signed_cert()
    
    print("\n" + "="*50)
    print("Iniciando servidor de Unísono en modo seguro (HTTPS)...")
    local_ips = get_local_ips()
    print("Los músicos pueden conectarse usando los siguientes enlaces:")
    for ip in local_ips:
        print(f"  https://{ip}:8000")
    print("="*50 + "\n")
    
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        ssl_keyfile=ssl_key,
        ssl_certfile=ssl_cert,
        reload=True
    )
