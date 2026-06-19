// Configurar worker de PDF.js localmente
pdfjsLib.GlobalWorkerOptions.workerSrc = '/static/js/libs/pdf.worker.min.js';

let pdfDoc = null;
let currentNumPage = 1;
let currentDocUrl = '';
let ws = null;
let wakeLock = null;
let headerTimeout = null;
let renderInProgress = false;
let nextPendingPage = null;

// Elementos del DOM
const floatingHeader = document.getElementById('floating-header');
const interactionOverlay = document.getElementById('interaction-overlay');
const docNameSpan = document.getElementById('doc-name');
const pageIndicator = document.getElementById('page-indicator');
const connectionDot = document.getElementById('connection-dot');
const pdfCanvas = document.getElementById('pdf-canvas');
const pdfWrapper = document.getElementById('pdf-wrapper');
const wakeLockCheckbox = document.getElementById('wake-lock-checkbox');
const wakeLockLabel = document.getElementById('wake-lock-label');
const statusOverlay = document.getElementById('status-overlay');
const statusTitle = document.getElementById('status-title');
const statusMessage = document.getElementById('status-message');
const statusSpinner = document.getElementById('status-spinner');
const btnReconnect = document.getElementById('btn-reconnect');

// --- Control del Encabezado Flotante ---
function showHeader() {
    floatingHeader.classList.remove('hidden');
    clearTimeout(headerTimeout);
    headerTimeout = setTimeout(hideHeader, 3500); // Se oculta tras 3.5 segundos de inactividad
}

function hideHeader() {
    floatingHeader.classList.add('hidden');
}

// Escuchar interacciones para mostrar el encabezado
interactionOverlay.addEventListener('click', showHeader);
interactionOverlay.addEventListener('mousemove', showHeader);
interactionOverlay.addEventListener('touchstart', showHeader);
showHeader();

// --- API de Wake Lock (Mantener pantalla activa) ---
async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => {
                console.log('Wake Lock liberado.');
                updateWakeLockUI(false);
            });
            console.log('Wake Lock activado con éxito.');
            updateWakeLockUI(true);
        } catch (err) {
            console.warn(`No se pudo activar el Wake Lock: ${err.message}`);
            updateWakeLockUI(false);
        }
    } else {
        console.warn('La API de Wake Lock no está soportada en este navegador.');
        updateWakeLockUI(false);
    }
}

async function releaseWakeLock() {
    if (wakeLock) {
        await wakeLock.release();
        wakeLock = null;
    }
    updateWakeLockUI(false);
}

function updateWakeLockUI(isActive) {
    wakeLockCheckbox.checked = isActive;
    if (isActive) {
        wakeLockLabel.textContent = 'Mantener Encendida: SÍ';
        wakeLockLabel.style.color = 'var(--success)';
    } else {
        wakeLockLabel.textContent = 'Mantener Encendida: NO';
        wakeLockLabel.style.color = 'var(--text-muted)';
    }
}

// Manejar cambios en el interruptor de Wake Lock
wakeLockCheckbox.addEventListener('change', async (e) => {
    if (e.target.checked) {
        await requestWakeLock();
    } else {
        await releaseWakeLock();
    }
});

// Reactivar Wake Lock al volver a enfocar la pestaña
document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && wakeLockCheckbox.checked) {
        await requestWakeLock();
    }
});

// Intentar solicitar Wake Lock de forma predeterminada (requiere interacción previa en algunos móviles)
document.addEventListener('click', async () => {
    if (wakeLockCheckbox.checked && !wakeLock) {
        await requestWakeLock();
    }
}, { once: true });

// --- Lógica del Cliente WebSocket ---
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    console.log(`Conectando a WebSocket: ${wsUrl}`);
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log('Conectado al servidor de Unísono.');
        connectionDot.className = 'status-dot connected';
        statusOverlay.style.opacity = '0';
        setTimeout(() => {
            statusOverlay.style.display = 'none';
        }, 300);
    };
    
    ws.onclose = () => {
        console.warn('Conexión perdida con el servidor.');
        connectionDot.className = 'status-dot disconnected';
        showOfflineOverlay('Conexión Perdida', 'Intentando reconectar con el servidor...');
        setTimeout(connectWebSocket, 3000); // Reintentar en 3 segundos
    };
    
    ws.onerror = (err) => {
        console.error('Error de WebSocket:', err);
    };
    
    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        console.log('Mensaje recibido:', message);
        
        switch (message.type) {
            case 'sync':
                currentNumPage = message.page;
                loadDocument(message.document, message.document_name);
                break;
                
            case 'page_change':
                currentNumPage = message.page;
                renderPage(currentNumPage);
                break;
                
            case 'document_change':
                currentNumPage = message.page;
                loadDocument(message.document, message.document_name);
                break;
                
            default:
                break;
        }
    };
}

function showOfflineOverlay(title, msg) {
    statusOverlay.style.display = 'flex';
    statusOverlay.style.opacity = '1';
    statusTitle.textContent = title;
    statusMessage.textContent = msg;
    statusSpinner.style.display = 'block';
    btnReconnect.style.display = 'none';
}

btnReconnect.addEventListener('click', connectWebSocket);

// --- Lógica de Renderizado con PDF.js ---
function loadDocument(url, name) {
    if (currentDocUrl === url) {
        renderPage(currentNumPage);
        return;
    }
    
    console.log(`Cargando nuevo documento: ${url}`);
    currentDocUrl = url;
    docNameSpan.textContent = name;
    
    // Ocultar wrapper de canvas durante la carga inicial del doc
    pdfCanvas.style.opacity = '0.3';
    
    pdfjsLib.getDocument(url).promise.then(pdf => {
        pdfDoc = pdf;
        console.log(`Documento cargado. Páginas totales: ${pdf.numPages}`);
        pdfCanvas.style.opacity = '1';
        renderPage(currentNumPage);
    }).catch(err => {
        console.error('Error al cargar el PDF:', err);
        docNameSpan.textContent = 'Error al cargar';
        showOfflineOverlay('Error de Carga', 'No se pudo cargar el archivo PDF de la partitura.');
        statusSpinner.style.display = 'none';
        btnReconnect.style.display = 'block';
    });
}

function renderPage(num) {
    if (!pdfDoc) return;
    
    // Si ya hay un renderizado en proceso, guardar el número de página y renderizar luego
    if (renderInProgress) {
        nextPendingPage = num;
        return;
    }
    
    renderInProgress = true;
    
    // Validar límites de página
    if (num > pdfDoc.numPages) num = pdfDoc.numPages;
    if (num < 1) num = 1;
    
    pdfDoc.getPage(num).then(page => {
        const ctx = pdfCanvas.getContext('2d');
        
        // Calcular escala adaptativa al tamaño del contenedor
        const viewport = page.getViewport({ scale: 1.0 });
        const containerWidth = pdfWrapper.clientWidth - 20; // 10px padding a cada lado
        const containerHeight = pdfWrapper.clientHeight - 20;
        
        const scaleX = containerWidth / viewport.width;
        const scaleY = containerHeight / viewport.height;
        const scale = Math.min(scaleX, scaleY);
        
        const scaledViewport = page.getViewport({ scale: scale });
        
        // Configurar dimensiones físicas del canvas
        pdfCanvas.width = scaledViewport.width;
        pdfCanvas.height = scaledViewport.height;
        
        const renderContext = {
            canvasContext: ctx,
            viewport: scaledViewport
        };
        
        const renderTask = page.render(renderContext);
        
        renderTask.promise.then(() => {
            renderInProgress = false;
            pageIndicator.textContent = `Pág. ${num} / ${pdfDoc.numPages}`;
            
            // Si hubo otra petición de página mientras renderizaba, procesarla
            if (nextPendingPage !== null) {
                const pageToRender = nextPendingPage;
                nextPendingPage = null;
                renderPage(pageToRender);
            }
        });
    }).catch(err => {
        console.error('Error al renderizar página:', err);
        renderInProgress = false;
    });
}

// Rediseño adaptativo al cambiar de orientación o tamaño de pantalla
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        if (pdfDoc) {
            renderPage(currentNumPage);
        }
    }, 150);
});

// --- Inicialización ---
connectWebSocket();
// Intentar configurar Wake Lock al inicio si se tienen permisos
if ('wakeLock' in navigator) {
    requestWakeLock();
}
