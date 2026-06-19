// Configurar worker de PDF.js localmente
pdfjsLib.GlobalWorkerOptions.workerSrc = '/static/js/libs/pdf.worker.min.js';

let pdfDoc = null;
let currentNumPage = 1;
let currentDocUrl = '';
let ws = null;
let renderInProgress = false;
let nextPendingPage = null;

// Elementos del DOM
const connectionDot = document.getElementById('connection-dot');
const connectionText = document.getElementById('connection-text');
const clientCountSpan = document.getElementById('client-count');
const pdfCanvas = document.getElementById('pdf-canvas');
const pdfWrapper = document.getElementById('pdf-wrapper');
const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');
const pageInput = document.getElementById('page-input');
const totalPagesSpan = document.getElementById('total-pages');
const docListUl = document.getElementById('doc-list');
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const lanIpListDiv = document.getElementById('lan-ip-list');

// --- Lógica del Cliente WebSocket ---
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    console.log(`Director conectando a: ${wsUrl}`);
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log('Conexión del Director establecida.');
        connectionDot.className = 'status-dot connected';
        connectionText.textContent = 'Director Conectado';
        
        // Cargar listas iniciales
        fetchDocuments();
        fetchIps();
    };
    
    ws.onclose = () => {
        console.warn('Conexión del Director perdida.');
        connectionDot.className = 'status-dot disconnected';
        connectionText.textContent = 'Desconectado';
        setTimeout(connectWebSocket, 3000);
    };
    
    ws.onerror = (err) => {
        console.error('Error en WS del Director:', err);
    };
    
    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        console.log('Director recibió mensaje:', message);
        
        switch (message.type) {
            case 'sync':
                currentNumPage = message.page;
                if (message.clients_count !== undefined) {
                    clientCountSpan.textContent = message.clients_count;
                }
                loadDocument(message.document, message.document_name);
                break;
                
            case 'page_change':
                currentNumPage = message.page;
                renderPage(currentNumPage);
                break;
                
            case 'document_change':
                currentNumPage = message.page;
                loadDocument(message.document, message.document_name);
                // Refrescar listado para marcar el activo
                fetchDocuments();
                break;
                
            case 'client_count':
                clientCountSpan.textContent = message.count;
                break;
                
            default:
                break;
        }
    };
}

// --- Comandos de Control ---
function sendPageChange(pageNumber) {
    if (!pdfDoc) return;
    
    // Validar límites
    if (pageNumber < 1) pageNumber = 1;
    if (pageNumber > pdfDoc.numPages) pageNumber = pdfDoc.numPages;
    
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            command: 'change_page',
            page: pageNumber
        }));
    }
}

function sendDocumentChange(docName) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            command: 'change_document',
            document: docName
        }));
    }
}

// --- Controles de Página UI ---
btnPrev.addEventListener('click', () => {
    if (currentNumPage > 1) {
        sendPageChange(currentNumPage - 1);
    }
});

btnNext.addEventListener('click', () => {
    if (pdfDoc && currentNumPage < pdfDoc.numPages) {
        sendPageChange(currentNumPage + 1);
    }
});

pageInput.addEventListener('change', (e) => {
    const val = parseInt(e.target.value);
    if (!isNaN(val)) {
        sendPageChange(val);
    } else {
        pageInput.value = currentNumPage;
    }
});

// Atajos de teclado
document.addEventListener('keydown', (e) => {
    // Evitar disparar si se está escribiendo en el input de página
    if (document.activeElement === pageInput) return;
    
    if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        if (pdfDoc && currentNumPage < pdfDoc.numPages) {
            sendPageChange(currentNumPage + 1);
        }
    } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (currentNumPage > 1) {
            sendPageChange(currentNumPage - 1);
        }
    }
});

// --- Renderizado del PDF (Preview) ---
function loadDocument(url, name) {
    if (currentDocUrl === url) {
        renderPage(currentNumPage);
        return;
    }
    
    console.log(`Director cargando documento: ${url}`);
    currentDocUrl = url;
    
    pdfCanvas.style.opacity = '0.3';
    
    pdfjsLib.getDocument(url).promise.then(pdf => {
        pdfDoc = pdf;
        console.log(`Director cargó PDF. Páginas: ${pdf.numPages}`);
        pdfCanvas.style.opacity = '1';
        
        totalPagesSpan.textContent = pdf.numPages;
        pageInput.max = pdf.numPages;
        pageInput.disabled = false;
        
        renderPage(currentNumPage);
    }).catch(err => {
        console.error('Error al cargar PDF en director:', err);
        totalPagesSpan.textContent = '-';
        pageInput.disabled = true;
    });
}

function renderPage(num) {
    if (!pdfDoc) return;
    
    if (renderInProgress) {
        nextPendingPage = num;
        return;
    }
    
    renderInProgress = true;
    
    if (num > pdfDoc.numPages) num = pdfDoc.numPages;
    if (num < 1) num = 1;
    
    pdfDoc.getPage(num).then(page => {
        const ctx = pdfCanvas.getContext('2d');
        const viewport = page.getViewport({ scale: 1.0 });
        
        const containerWidth = pdfWrapper.clientWidth - 20;
        const containerHeight = pdfWrapper.clientHeight - 20;
        
        const scaleX = containerWidth / viewport.width;
        const scaleY = containerHeight / viewport.height;
        const scale = Math.min(scaleX, scaleY);
        
        const scaledViewport = page.getViewport({ scale: scale });
        
        pdfCanvas.width = scaledViewport.width;
        pdfCanvas.height = scaledViewport.height;
        
        const renderContext = {
            canvasContext: ctx,
            viewport: scaledViewport
        };
        
        page.render(renderContext).promise.then(() => {
            renderInProgress = false;
            currentNumPage = num;
            pageInput.value = num;
            
            // Actualizar botones desactivados
            btnPrev.disabled = (num <= 1);
            btnNext.disabled = (num >= pdfDoc.numPages);
            
            if (nextPendingPage !== null) {
                const pageToRender = nextPendingPage;
                nextPendingPage = null;
                renderPage(pageToRender);
            }
        });
    }).catch(err => {
        console.error('Error al renderizar preview:', err);
        renderInProgress = false;
    });
}

let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        if (pdfDoc) {
            renderPage(currentNumPage);
        }
    }, 150);
});

// --- Obtener e interactuar con Documentos ---
async function fetchDocuments() {
    try {
        const response = await fetch('/api/documents');
        const data = await response.json();
        
        docListUl.innerHTML = '';
        
        if (data.documents.length === 0) {
            docListUl.innerHTML = '<li class="doc-item" style="cursor: default; justify-content: center;"><span class="doc-name">No hay partituras. ¡Sube una abajo!</span></li>';
            return;
        }
        
        data.documents.forEach(docName => {
            const li = document.createElement('li');
            const isActive = currentDocUrl.endsWith(`/uploads/${docName}`);
            
            li.className = `doc-item ${isActive ? 'active' : ''}`;
            li.innerHTML = `
                <span class="doc-name" title="${docName}">${docName}</span>
                <span class="doc-badge">${isActive ? 'Activo' : 'Cargar'}</span>
            `;
            
            if (!isActive) {
                li.addEventListener('click', () => sendDocumentChange(docName));
            }
            docListUl.appendChild(li);
        });
    } catch (err) {
        console.error('Error al listar partituras:', err);
        docListUl.innerHTML = '<li class="doc-item" style="cursor: default;"><span class="doc-name">Error al cargar lista</span></li>';
    }
}

// --- Arrastrar y soltar para subir partituras ---
dropzone.addEventListener('click', () => fileInput.click());

dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
});

['dragleave', 'dragend'].forEach(evt => {
    dropzone.addEventListener(evt, () => {
        dropzone.classList.remove('dragover');
    });
});

dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    
    if (e.dataTransfer.files.length > 0) {
        handleFileUpload(e.dataTransfer.files[0]);
    }
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleFileUpload(e.target.files[0]);
    }
});

async function handleFileUpload(file) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
        alert('Solo se permiten archivos PDF.');
        return;
    }
    
    const formData = new FormData();
    formData.append('file', file);
    
    // Mostrar visualmente que está subiendo
    dropzone.innerHTML = `
        <div class="spinner" style="width: 24px; height: 24px; margin: 0 auto 10px auto;"></div>
        <p>Subiendo "${file.name}"...</p>
    `;
    
    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        
        if (response.ok) {
            console.log('Archivo subido con éxito.');
            // El backend notificará por WS del cambio de doc, así que se recarga automáticamente.
        } else {
            alert('Error al subir el archivo.');
        }
    } catch (err) {
        console.error('Error en fetch de subida:', err);
        alert('Error de red al subir el archivo.');
    } finally {
        // Restaurar contenido de dropzone
        dropzone.innerHTML = `
            <div class="dropzone-icon">⇪</div>
            <p>Arrastra tu archivo PDF aquí o <strong>haz clic para buscar</strong></p>
            <span>Tamaño máximo recomendado: 15MB</span>
        `;
    }
}

// --- Obtener direcciones IP de red local ---
async function fetchIps() {
    try {
        const response = await fetch('/api/ips');
        const data = await response.json();
        
        lanIpListDiv.innerHTML = '';
        
        // Filtrar localhost si es conveniente, pero mostrar todas las que provea el back
        data.ips.forEach(ip => {
            const isLocal = ip === '127.0.0.1' || ip === 'localhost';
            const url = `https://${ip}:8000`;
            
            const item = document.createElement('div');
            item.className = 'lan-ip-item';
            item.innerHTML = `
                <span class="lan-ip-url">${url}</span>
                <button class="btn-copy">Copiar</button>
            `;
            
            const btnCopy = item.querySelector('.btn-copy');
            btnCopy.addEventListener('click', () => {
                navigator.clipboard.writeText(url).then(() => {
                    btnCopy.textContent = 'Copiado!';
                    btnCopy.style.color = 'var(--success)';
                    setTimeout(() => {
                        btnCopy.textContent = 'Copiar';
                        btnCopy.style.color = 'var(--text-muted)';
                    }, 1500);
                });
            });
            
            // Añadir al principio si no es localhost, al final si lo es
            if (!isLocal) {
                lanIpListDiv.insertBefore(item, lanIpListDiv.firstChild);
            } else {
                lanIpListDiv.appendChild(item);
            }
        });
    } catch (err) {
        console.error('Error al obtener IPs:', err);
        lanIpListDiv.innerHTML = '<p class="instruction-text" style="color: var(--danger);">No se pudieron obtener las direcciones de red.</p>';
    }
}

// --- Inicialización ---
connectWebSocket();
