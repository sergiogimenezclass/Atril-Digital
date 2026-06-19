import os
import time
import threading
import socket
import urllib3
import requests
import uvicorn

# Desactivar advertencias de certificados auto-firmados en las pruebas
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Importar app y funciones de main
from main import app, generate_self_signed_cert

SERVER_HOST = "127.0.0.1"
SERVER_PORT = 8001
BASE_URL = f"https://{SERVER_HOST}:{SERVER_PORT}"

class BackgroundServer(threading.Thread):
    def __init__(self):
        super().__init__()
        self.server = None
        self.daemon = True

    def run(self):
        ssl_key, ssl_cert = generate_self_signed_cert()
        config = uvicorn.Config(
            app, 
            host=SERVER_HOST, 
            port=SERVER_PORT, 
            ssl_keyfile=ssl_key, 
            ssl_certfile=ssl_cert,
            log_level="warning"
        )
        self.server = uvicorn.Server(config)
        self.server.run()

    def stop(self):
        if self.server:
            self.server.should_exit = True

def wait_for_server():
    retries = 10
    while retries > 0:
        try:
            # Intentar abrir un socket para verificar si el puerto está abierto
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(0.5)
            s.connect((SERVER_HOST, SERVER_PORT))
            s.close()
            return True
        except Exception:
            time.sleep(0.5)
            retries -= 1
    return False

def test_api():
    print("Iniciando pruebas de integración...")
    server_thread = BackgroundServer()
    server_thread.start()

    if not wait_for_server():
        print("ERROR: El servidor de prueba no se inició a tiempo.")
        sys.exit(1)

    print("Servidor de prueba iniciado. Enviando peticiones...")
    
    try:
        # 1. Probar endpoint /api/state
        print("Probando GET /api/state...")
        r = requests.get(f"{BASE_URL}/api/state", verify=False)
        assert r.status_code == 200, f"Código de estado incorrecto: {r.status_code}"
        data = r.json()
        print("Respuesta de /api/state:", data)
        assert "document" in data
        assert "document_name" in data
        assert "page" in data
        assert data["page"] == 1
        assert data["document_name"] == "partitura_muestra.pdf"

        # 2. Probar endpoint /api/documents
        print("Probando GET /api/documents...")
        r = requests.get(f"{BASE_URL}/api/documents", verify=False)
        assert r.status_code == 200
        data = r.json()
        print("Respuesta de /api/documents:", data)
        assert "documents" in data
        assert "partitura_muestra.pdf" in data["documents"]

        # 3. Probar endpoint /api/ips
        print("Probando GET /api/ips...")
        r = requests.get(f"{BASE_URL}/api/ips", verify=False)
        assert r.status_code == 200
        data = r.json()
        print("Respuesta de /api/ips:", data)
        assert "ips" in data
        assert len(data["ips"]) > 0
        assert "127.0.0.1" in data["ips"]

        # 4. Probar redirección raíz /
        print("Probando redirección en / ...")
        r = requests.get(f"{BASE_URL}/", verify=False, allow_redirects=False)
        assert r.status_code == 307 or r.status_code == 302
        assert r.headers["location"] == "/static/index.html"

        print("\n¡TODAS LAS PRUEBAS PASARON EXITOSAMENTE! (HTTP/HTTPS API OK)")

    except AssertionError as e:
        print(f"\nFALLO EN LA PRUEBA: {e}")
        raise e
    except Exception as e:
        print(f"\nERROR DURANTE LA PRUEBA: {e}")
        raise e
    finally:
        print("Deteniendo servidor de prueba...")
        server_thread.stop()
        server_thread.join(timeout=3)
        print("Servidor detenido.")

if __name__ == "__main__":
    import sys
    test_api()
