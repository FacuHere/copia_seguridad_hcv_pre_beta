const botonAbrirRespaldos = document.querySelector('#chooseFolder');
const ventanaRespaldos = document.querySelector('#backupDialog');
const estadoRespaldos = document.querySelector('#backupStatus');
const botonCrearRespaldo = document.querySelector('#backupCreateButton');
const botonRestaurar = document.querySelector('#backupRestoreButton');
let carpetaDestinoRespaldo = null;
let carpetaOrigenRespaldo = null;
let contenidoRespaldoValidado = null;
let resumenActualRestauracion = null;
let operacionRespaldoActiva = false;
let generacionSesionRespaldos = 0;
// Coincide con el límite JSON de Express; el tamaño incluye el sobre del lote.
const maximoBytesLoteRestauracion = 256 * 1024;

function indicarEstadoRespaldos(mensaje, tipo = 'info') {
  estadoRespaldos.textContent = mensaje;
  estadoRespaldos.dataset.state = tipo;
}

function soporteDeCarpetasDisponible() {
  return Boolean(window.isSecureContext && window.showDirectoryPicker && window.crypto?.subtle);
}

function actualizarSoporteDeCarpetas() {
  const disponible = soporteDeCarpetasDisponible();
  document.querySelector('#backupSecurityNote').hidden = disponible;
  document.querySelector('#backupChooseDestination').disabled = !disponible || operacionRespaldoActiva;
  document.querySelector('#backupChooseSource').disabled = !disponible || operacionRespaldoActiva;
  botonCrearRespaldo.disabled = !disponible || operacionRespaldoActiva || !carpetaDestinoRespaldo;
  botonRestaurar.disabled = !disponible || operacionRespaldoActiva || !contenidoRespaldoValidado;
  document.querySelector('#backupIncludeUsers').disabled = operacionRespaldoActiva;
  document.querySelectorAll('[data-backup-tab], input[name="backupMode"]').forEach(control => { control.disabled = operacionRespaldoActiva; });
  return disponible;
}

function establecerOperacionRespaldoActiva(activa) {
  operacionRespaldoActiva = activa;
  actualizarSoporteDeCarpetas();
}

function comprobarSesionRespaldos(generacion) {
  if (generacion !== generacionSesionRespaldos) throw new Error('BACKUP_SESSION_CHANGED');
}

window.addEventListener('hcv:sesion-reiniciada', () => {
  generacionSesionRespaldos += 1;
  carpetaDestinoRespaldo = null;
  carpetaOrigenRespaldo = null;
  contenidoRespaldoValidado = null;
  resumenActualRestauracion = null;
  operacionRespaldoActiva = false;
  document.querySelector('#backupDestinationLabel').textContent = 'No se eligió una carpeta.';
  document.querySelector('#backupSourceLabel').textContent = 'No se eligió una carpeta.';
  document.querySelector('#backupPreview').innerHTML = '';
  document.querySelector('#backupPreview').hidden = true;
  document.querySelector('#backupIncludeUsers').checked = false;
  document.querySelectorAll('input[name="backupMode"]').forEach(radio => { radio.checked = radio.value === 'agregar'; });
  document.querySelectorAll('[data-backup-tab]').forEach(boton => boton.classList.toggle('active', boton.dataset.backupTab === 'create'));
  document.querySelector('#backupCreatePanel').hidden = false;
  document.querySelector('#backupCreatePanel').classList.toggle('active', true);
  document.querySelector('#backupRestorePanel').hidden = true;
  document.querySelector('#backupRestorePanel').classList.toggle('active', false);
  document.querySelector('#backupReplaceWarning').hidden = true;
  actualizarTextoBotonRestaurar();
  indicarEstadoRespaldos('');
  if (ventanaRespaldos.open) ventanaRespaldos.close();
  actualizarSoporteDeCarpetas();
});

function mostrarVentanaRespaldos() {
  if (!ventanaRespaldos.open) ventanaRespaldos.showModal();
  actualizarSoporteDeCarpetas();
  if (!operacionRespaldoActiva) indicarEstadoRespaldos('Elija crear un respaldo o restaurar una carpeta existente.');
}

botonAbrirRespaldos.addEventListener('click', mostrarVentanaRespaldos);
document.querySelector('#backupClose').addEventListener('click', () => ventanaRespaldos.close());
ventanaRespaldos.addEventListener('click', evento => {
  if (evento.target === ventanaRespaldos) ventanaRespaldos.close();
});

document.querySelectorAll('[data-backup-tab]').forEach(boton => boton.addEventListener('click', () => {
  if (operacionRespaldoActiva) return;
  const pestana = boton.dataset.backupTab;
  document.querySelectorAll('[data-backup-tab]').forEach(elemento => elemento.classList.toggle('active', elemento === boton));
  document.querySelector('#backupCreatePanel').hidden = pestana !== 'create';
  document.querySelector('#backupRestorePanel').hidden = pestana !== 'restore';
  document.querySelector('#backupCreatePanel').classList.toggle('active', pestana === 'create');
  document.querySelector('#backupRestorePanel').classList.toggle('active', pestana === 'restore');
  indicarEstadoRespaldos(pestana === 'create' ? 'Prepare una copia en la carpeta elegida.' : 'Seleccione una carpeta para validar su contenido.');
}));

document.querySelector('#backupChooseDestination').addEventListener('click', async () => {
  if (operacionRespaldoActiva || !actualizarSoporteDeCarpetas()) return;
  const generacion = generacionSesionRespaldos;
  establecerOperacionRespaldoActiva(true);
  try {
    const carpetaElegida = await window.showDirectoryPicker({ mode: 'readwrite' });
    comprobarSesionRespaldos(generacion);
    carpetaDestinoRespaldo = carpetaElegida;
    document.querySelector('#backupDestinationLabel').textContent = carpetaDestinoRespaldo.name;
    actualizarSoporteDeCarpetas();
    indicarEstadoRespaldos('La carpeta de destino está seleccionada.');
  } catch (error) {
    if (generacion !== generacionSesionRespaldos) return;
    if (error.name !== 'AbortError') indicarEstadoRespaldos('No se pudo acceder a la carpeta elegida.', 'error');
  } finally { if (generacion === generacionSesionRespaldos) establecerOperacionRespaldoActiva(false); }
});

document.querySelector('#backupChooseSource').addEventListener('click', async () => {
  if (operacionRespaldoActiva || !actualizarSoporteDeCarpetas()) return;
  const generacion = generacionSesionRespaldos;
  establecerOperacionRespaldoActiva(true);
  try {
    const carpetaElegida = await window.showDirectoryPicker({ mode: 'read' });
    comprobarSesionRespaldos(generacion);
    carpetaOrigenRespaldo = carpetaElegida;
    contenidoRespaldoValidado = null;
    document.querySelector('#backupSourceLabel').textContent = carpetaOrigenRespaldo.name;
    document.querySelector('#backupPreview').hidden = true;
    botonRestaurar.disabled = true;
    indicarEstadoRespaldos('Leyendo y verificando la carpeta…');
    const contenidoValidado = await leerYValidarCarpetaRespaldo(carpetaElegida);
    comprobarSesionRespaldos(generacion);
    const resumen = (await apiRequest('/api/respaldos/resumen-clinico')).data;
    comprobarSesionRespaldos(generacion);
    contenidoRespaldoValidado = contenidoValidado;
    resumenActualRestauracion = resumen;
    mostrarPrevisualizacionRestauracion(contenidoRespaldoValidado, resumenActualRestauracion);
    actualizarTextoBotonRestaurar();
    actualizarSoporteDeCarpetas();
    indicarEstadoRespaldos('La carpeta y sus metadatos pasaron la validación inicial.');
  } catch (error) {
    if (generacion !== generacionSesionRespaldos) return;
    contenidoRespaldoValidado = null;
    actualizarSoporteDeCarpetas();
    indicarEstadoRespaldos(mensajeErrorRespaldo(error, 'No se pudo validar la carpeta. Revise que contenga manifest.json y datos-clinicos.json.'), 'error');
  } finally { if (generacion === generacionSesionRespaldos) establecerOperacionRespaldoActiva(false); }
});

document.querySelectorAll('input[name="backupMode"]').forEach(radio => radio.addEventListener('change', () => {
  const reemplazar = document.querySelector('input[name="backupMode"]:checked')?.value === 'reemplazar';
  document.querySelector('#backupReplaceWarning').hidden = !reemplazar;
  actualizarTextoBotonRestaurar();
}));

function actualizarTextoBotonRestaurar() {
  const modo = document.querySelector('input[name="backupMode"]:checked')?.value;
  botonRestaurar.textContent = modo === 'reemplazar' ? 'Restaurar y reemplazar datos' : 'Restaurar agregando pacientes';
}

function mensajeErrorRespaldo(error, alternativa) {
  if (error?.messageFromApi) return error.messageFromApi;
  if (error?.code === 'FILE_TOO_LARGE') return 'Un archivo supera el límite configurado para cargas.';
  if (error?.code === 'RESTORE_RECORD_TOO_LARGE') return error.message;
  if (error?.name === 'NotAllowedError') return 'El navegador no concedió acceso a la carpeta seleccionada.';
  if (error?.name === 'QuotaExceededError') return 'No hay espacio suficiente en la carpeta de destino.';
  if (error?.name === 'AbortError') return 'La operación se interrumpió.';
  return alternativa;
}

async function calcularSha256(contenido) {
  const bytes = contenido instanceof Blob ? await contenido.arrayBuffer() : new TextEncoder().encode(contenido);
  const digest = await window.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function guardarContenido(carpeta, ruta, contenido, comprobarVigencia = () => {}) {
  const partes = ruta.split('/');
  let directorio = carpeta;
  for (const nombre of partes.slice(0, -1)) {
    comprobarVigencia();
    directorio = await directorio.getDirectoryHandle(nombre, { create: true });
  }
  comprobarVigencia();
  const archivo = await directorio.getFileHandle(partes.at(-1), { create: true });
  comprobarVigencia();
  const escritor = await archivo.createWritable();
  try { comprobarVigencia(); await escritor.write(contenido); comprobarVigencia(); await escritor.close(); comprobarVigencia(); }
  catch (error) { await escritor.abort().catch(() => {}); throw error; }
  return archivo;
}

async function guardarRespuestaDeArchivo(carpeta, ruta, respuesta, tamanoEsperado, comprobarVigencia = () => {}) {
  const lector = respuesta.body?.getReader();
  if (!lector) throw new Error('El navegador no puede leer el archivo por partes.');
  const partes = ruta.split('/');
  let directorio = carpeta;
  for (const nombre of partes.slice(0, -1)) {
    comprobarVigencia();
    directorio = await directorio.getDirectoryHandle(nombre, { create: true });
  }
  comprobarVigencia();
  const archivo = await directorio.getFileHandle(partes.at(-1), { create: true });
  comprobarVigencia();
  const escritor = await archivo.createWritable();
  let total = 0;
  try {
    comprobarVigencia();
    while (true) {
      const { done, value } = await lector.read();
      comprobarVigencia();
      if (done) break;
      total += value.byteLength;
      if (total > tamanoEsperado) throw new Error('El archivo recibido supera el tamaño registrado.');
      await escritor.write(value);
    }
    if (total !== tamanoEsperado) throw new Error('El tamaño del archivo recibido no coincide con sus metadatos.');
    comprobarVigencia();
    await escritor.close();
    comprobarVigencia();
  } catch (error) {
    await escritor.abort().catch(() => {});
    await lector.cancel().catch(() => {});
    throw error;
  }
  return archivo;
}

async function leerArchivo(carpeta, ruta) {
  if (typeof ruta !== 'string' || ruta.includes('\\') || ruta.startsWith('/') || /^[A-Za-z]:/.test(ruta)) throw new Error('La ruta de un archivo del respaldo no es válida.');
  const partes = ruta.split('/');
  const esMetadatoRaiz = ruta === 'manifest.json' || ruta === 'datos-clinicos.json';
  if (!esMetadatoRaiz && (partes.length !== 2 || partes[0] !== 'documentos' || !partes[1] || partes[1] === '.' || partes[1] === '..' || partes[1].includes('..') || /[<>:"|?*\u0000-\u001f]/.test(partes[1]))) throw new Error('La ruta de un archivo del respaldo no es válida.');
  let directorio = carpeta;
  for (const nombre of partes.slice(0, -1)) directorio = await directorio.getDirectoryHandle(nombre);
  const archivo = await directorio.getFileHandle(partes.at(-1));
  return archivo.getFile();
}

function nombreCarpetaRespaldo() {
  const fecha = new Date();
  const sello = [fecha.getFullYear(), String(fecha.getMonth() + 1).padStart(2, '0'), String(fecha.getDate()).padStart(2, '0'), '-', String(fecha.getHours()).padStart(2, '0'), String(fecha.getMinutes()).padStart(2, '0'), String(fecha.getSeconds()).padStart(2, '0')].join('');
  return `Respaldo-HCV-${sello}-${window.crypto.randomUUID().slice(0, 8)}`;
}

async function descargarArchivoRespaldo(documento, comprobarVigencia = () => {}) {
  const respuesta = await fetch(`/api/respaldos/documentos/${encodeURIComponent(documento.id)}`, {
    method: 'GET', credentials: 'same-origin', headers: { Accept: 'application/octet-stream' },
  });
  try { comprobarVigencia(); }
  catch (error) { await respuesta.body?.cancel().catch(() => {}); throw error; }
  if (!respuesta.ok) {
    let mensaje = 'No se pudo leer el archivo clínico.';
    try { mensaje = (await respuesta.json())?.error?.message || mensaje; } catch {}
    const error = new Error('BACKUP_FILE_DOWNLOAD_FAILED');
    error.messageFromApi = mensaje;
    error.status = respuesta.status;
    throw error;
  }
  if (respuesta.headers.get('X-Document-SHA256') !== documento.sha256) {
    throw new Error('El archivo no coincide con el SHA-256 registrado en los datos clínicos.');
  }
  const longitud = Number(respuesta.headers.get('Content-Length'));
  if (Number.isFinite(longitud) && longitud !== Number(documento.sizeBytes)) {
    throw new Error('El tamaño del archivo recibido no coincide con sus metadatos.');
  }
  return respuesta;
}

botonCrearRespaldo.addEventListener('click', async () => {
  if (operacionRespaldoActiva || !carpetaDestinoRespaldo || !actualizarSoporteDeCarpetas()) return;
  const generacion = generacionSesionRespaldos;
  const comprobarVigencia = () => comprobarSesionRespaldos(generacion);
  const carpetaDestino = carpetaDestinoRespaldo;
  establecerOperacionRespaldoActiva(true);
  let operationId = null;
  try {
    indicarEstadoRespaldos('Consultando los datos clínicos…');
    const respuesta = await apiRequest('/api/respaldos/exportar', {
      method: 'POST',
      body: JSON.stringify({ incluirReferenciasUsuarios: document.querySelector('#backupIncludeUsers').checked }),
    });
    comprobarVigencia();
    const respaldo = respuesta?.data;
    operationId = respaldo?.operationId;
    if (!operationId || respaldo.formato !== 'hcv-respaldo-clinico' || respaldo.version !== 1) throw new Error('La API devolvió un formato de respaldo no reconocido.');
    const contenidoDatos = new Blob([JSON.stringify(respaldo.datos)], { type: 'application/json' });
    const shaDatos = await calcularSha256(contenidoDatos);
    comprobarVigencia();
    const carpetaRespaldo = await carpetaDestino.getDirectoryHandle(nombreCarpetaRespaldo(), { create: true });
    comprobarVigencia();
    await guardarContenido(carpetaRespaldo, 'datos-clinicos.json', contenidoDatos, comprobarVigencia);

    const archivosIncluidos = [];
    for (let indice = 0; indice < respaldo.datos.documentos.length; indice += 1) {
      const documento = respaldo.datos.documentos[indice];
      indicarEstadoRespaldos(`Guardando archivo ${indice + 1} de ${respaldo.datos.documentos.length}: ${documento.originalName}`);
      const respuestaArchivo = await descargarArchivoRespaldo(documento, comprobarVigencia);
      await guardarRespuestaDeArchivo(carpetaRespaldo, documento.archivePath, respuestaArchivo, Number(documento.sizeBytes), comprobarVigencia);
      archivosIncluidos.push({
        documentoId: documento.id,
        ruta: documento.archivePath,
        nombre: documento.originalName,
        tipo: documento.mimeType,
        tamano: documento.sizeBytes,
        sha256: documento.sha256,
      });
    }

    const manifiesto = {
      formato: respaldo.formato,
      version: respaldo.version,
      creadoEn: respaldo.creadoEn,
      archivoDatos: 'datos-clinicos.json',
      sha256Datos: shaDatos,
      conteos: respaldo.conteos,
      incluyeReferenciasUsuarios: Array.isArray(respaldo.datos.referenciasUsuarios),
      archivos: archivosIncluidos,
    };
    await guardarContenido(carpetaRespaldo, 'manifest.json', new Blob([JSON.stringify(manifiesto, null, 2)], { type: 'application/json' }), comprobarVigencia);
    await apiRequest(`/api/respaldos/exportar/${encodeURIComponent(operationId)}/completar`, { method: 'POST' });
    comprobarVigencia();
    operationId = null;
    indicarEstadoRespaldos(`Respaldo completo guardado en «${carpetaRespaldo.name}». Contiene ${respaldo.conteos.pacientes} pacientes, ${respaldo.conteos.estudios} estudios y ${respaldo.conteos.documentos} archivos.`, 'success');
  } catch (error) {
    if (generacion !== generacionSesionRespaldos) return;
    if (operationId) await apiRequest(`/api/respaldos/operaciones/${encodeURIComponent(operationId)}/cancelar`, { method: 'POST' }).catch(() => {});
    if (generacion !== generacionSesionRespaldos) return;
    indicarEstadoRespaldos(mensajeErrorRespaldo(error, 'No se pudo completar el respaldo. La carpeta sin manifest.json está incompleta y no debe usarse para restaurar.'), 'error');
  } finally {
    if (generacion === generacionSesionRespaldos) establecerOperacionRespaldoActiva(false);
  }
});

async function leerYValidarCarpetaRespaldo(carpeta) {
  const archivoManifiesto = await leerArchivo(carpeta, 'manifest.json');
  const manifiesto = JSON.parse(await archivoManifiesto.text());
  if (manifiesto.formato !== 'hcv-respaldo-clinico' || manifiesto.version !== 1 || manifiesto.archivoDatos !== 'datos-clinicos.json'
    || !manifiesto.conteos || !Array.isArray(manifiesto.archivos)) throw new Error('La carpeta no es un respaldo HCV compatible.');
  const archivoDatos = await leerArchivo(carpeta, manifiesto.archivoDatos);
  if (await calcularSha256(archivoDatos) !== manifiesto.sha256Datos) throw new Error('El SHA-256 de datos-clinicos.json no coincide con el manifiesto.');
  const datos = JSON.parse(await archivoDatos.text());
  if (!Array.isArray(datos.pacientes) || !Array.isArray(datos.estudios) || !Array.isArray(datos.documentos)
    || manifiesto.conteos.pacientes !== datos.pacientes.length
    || manifiesto.conteos.estudios !== datos.estudios.length
    || manifiesto.conteos.documentos !== datos.documentos.length
    || manifiesto.archivos.length !== datos.documentos.length) throw new Error('Los conteos del manifiesto no coinciden con los datos del respaldo.');
  const archivos = new Map(manifiesto.archivos.map(archivo => [String(archivo.documentoId), archivo]));
  for (const documento of datos.documentos) {
    const archivoManifiesto = archivos.get(String(documento.id));
    if (!archivoManifiesto || archivoManifiesto.ruta !== documento.archivePath
      || archivoManifiesto.sha256 !== documento.sha256 || String(archivoManifiesto.tamano) !== String(documento.sizeBytes)) {
      throw new Error('El inventario de archivos no coincide con los metadatos clínicos.');
    }
    const archivoFisico = await leerArchivo(carpeta, documento.archivePath);
    if (archivoFisico.size !== Number(documento.sizeBytes)) throw new Error(`El tamaño de «${documento.originalName}» no coincide con el respaldo.`);
  }
  return { manifiesto, datos };
}

function mostrarPrevisualizacionRestauracion(respaldo, resumen) {
  const panel = document.querySelector('#backupPreview');
  const nombres = resumen.muestraPacientes.map(paciente => `${paciente.nombre}${paciente.dni ? ` (DNI ${paciente.dni})` : ''}`).join(', ');
  const lista = nombres ? `<p><strong>Pacientes actuales:</strong> ${escaparHtml(nombres)}${resumen.hayMasPacientes ? ', entre otros' : ''}</p>` : '<p>No hay pacientes cargados actualmente.</p>';
  panel.innerHTML = `<p><strong>Carpeta seleccionada:</strong> ${escaparHtml(carpetaOrigenRespaldo.name)}</p>
    <p><strong>El respaldo contiene:</strong> ${respaldo.manifiesto.conteos.pacientes} pacientes, ${respaldo.manifiesto.conteos.estudios} estudios y ${respaldo.manifiesto.conteos.documentos} documentos.</p>
    <p><strong>En este sistema:</strong> ${resumen.pacientes} pacientes, ${resumen.estudios} estudios y ${resumen.documentos} documentos.</p>${lista}`;
  panel.hidden = false;
}

function confirmarAccionRestauracion(modo, respaldo, resumen) {
  if (modo === 'agregar') {
    return window.confirm(`Se agregarán ${respaldo.datos.pacientes.length} pacientes nuevos y sus estudios y documentos. Los pacientes no se fusionarán aunque coincida el DNI. Los datos actuales se conservarán. ¿Continuar?`);
  }
  const nombres = resumen.muestraPacientes.slice(0, 8).map(paciente => paciente.nombre).join('\n• ');
  const muestra = nombres ? `\n\nPacientes actuales que serán reemplazados:\n• ${nombres}${resumen.hayMasPacientes ? '\n• y otros pacientes' : ''}` : '';
  return window.confirm(`ATENCIÓN: se reemplazarán ${resumen.pacientes} pacientes, ${resumen.estudios} estudios y ${resumen.documentos} documentos actuales por ${respaldo.datos.pacientes.length}, ${respaldo.datos.estudios.length} y ${respaldo.datos.documentos.length} del respaldo. Se conservarán usuarios, permisos y auditoría.${muestra}\n\nLa operación solo comenzará después de validar todos los registros y archivos. ¿Desea continuar?`);
}

async function enviarRegistrosPorLotes(operationId, tipo, registros, comprobarVigencia = () => {}) {
  comprobarVigencia();
  let lote = [];
  const enviarLote = async () => {
    comprobarVigencia();
    await apiRequest(`/api/respaldos/restauraciones/${encodeURIComponent(operationId)}/registros`, {
      method: 'POST', body: JSON.stringify({ tipo, registros: lote }),
    });
    comprobarVigencia();
  };
  for (const registro of registros) {
    const contenidoIndividual = JSON.stringify({ tipo, registros: [registro] });
    if (new TextEncoder().encode(contenidoIndividual).byteLength > maximoBytesLoteRestauracion) {
      const error = new Error(`Un registro de ${tipo} supera el tamaño permitido por la API y no puede restaurarse desde esta interfaz.`);
      error.code = 'RESTORE_RECORD_TOO_LARGE';
      throw error;
    }
    const siguienteLote = [...lote, registro];
    const contenidoSiguiente = JSON.stringify({ tipo, registros: siguienteLote });
    if (lote.length && (siguienteLote.length > 5 || new TextEncoder().encode(contenidoSiguiente).byteLength > maximoBytesLoteRestauracion)) {
      await enviarLote();
      lote = [registro];
    } else {
      lote = siguienteLote;
    }
  }
  if (lote.length) await enviarLote();
}

botonRestaurar.addEventListener('click', async () => {
  if (operacionRespaldoActiva || !contenidoRespaldoValidado || !actualizarSoporteDeCarpetas()) return;
  const generacion = generacionSesionRespaldos;
  const comprobarVigencia = () => comprobarSesionRespaldos(generacion);
  const respaldo = contenidoRespaldoValidado;
  const carpetaOrigen = carpetaOrigenRespaldo;
  const modo = document.querySelector('input[name="backupMode"]:checked')?.value;
  if (!confirmarAccionRestauracion(modo, respaldo, resumenActualRestauracion)) return;
  establecerOperacionRespaldoActiva(true);
  let operationId = null;
  let restauracionConfirmada = false;
  try {
    const inicio = await apiRequest('/api/respaldos/restauraciones', {
      method: 'POST',
      body: JSON.stringify({ formato: respaldo.manifiesto.formato, version: respaldo.manifiesto.version, modo, conteos: respaldo.manifiesto.conteos }),
    });
    comprobarVigencia();
    operationId = inicio.data.operationId;
    for (const [tipo, registros] of [['pacientes', respaldo.datos.pacientes], ['estudios', respaldo.datos.estudios], ['documentos', respaldo.datos.documentos]]) {
      await enviarRegistrosPorLotes(operationId, tipo, registros, comprobarVigencia);
      comprobarVigencia();
      indicarEstadoRespaldos(`Se prepararon ${registros.length} registros de ${tipo}.`);
    }
    for (let indice = 0; indice < respaldo.datos.documentos.length; indice += 1) {
      const documento = respaldo.datos.documentos[indice];
      indicarEstadoRespaldos(`Validando archivo ${indice + 1} de ${respaldo.datos.documentos.length}: ${documento.originalName}`);
      const archivo = await leerArchivo(carpetaOrigen, documento.archivePath);
      comprobarVigencia();
      const formulario = new FormData();
      formulario.append('file', archivo, documento.originalName);
      await apiRequest(`/api/respaldos/restauraciones/${encodeURIComponent(operationId)}/documentos/${encodeURIComponent(documento.id)}`, { method: 'POST', body: formulario });
      comprobarVigencia();
    }
    indicarEstadoRespaldos('Todos los datos y archivos fueron validados. Aplicando la restauración…');
    const resultado = await apiRequest(`/api/respaldos/restauraciones/${encodeURIComponent(operationId)}/confirmar`, { method: 'POST' });
    comprobarVigencia();
    restauracionConfirmada = true;
    operationId = null;
    indicarEstadoRespaldos(resultado.data.limpiezaPendiente
      ? 'Los datos fueron restaurados. Quedó pendiente la limpieza física de archivos anteriores; la API continúa disponible y requiere revisión técnica.'
      : `Restauración completada: ${respaldo.datos.pacientes.length} pacientes, ${respaldo.datos.estudios.length} estudios y ${respaldo.datos.documentos.length} documentos.`, 'success');
    await actualizarVistaClinicaTrasRestauracion(modo);
    comprobarVigencia();
    const resumen = (await apiRequest('/api/respaldos/resumen-clinico')).data;
    comprobarVigencia();
    resumenActualRestauracion = resumen;
    mostrarPrevisualizacionRestauracion(respaldo, resumenActualRestauracion);
  } catch (error) {
    if (generacion !== generacionSesionRespaldos) return;
    if (operationId) await apiRequest(`/api/respaldos/operaciones/${encodeURIComponent(operationId)}/cancelar`, { method: 'POST' }).catch(() => {});
    if (generacion !== generacionSesionRespaldos) return;
    indicarEstadoRespaldos(restauracionConfirmada
      ? 'Los datos fueron restaurados, pero no se pudo actualizar la vista. Recargue la página para consultar el estado actual.'
      : mensajeErrorRespaldo(error, 'La restauración no se confirmó. Los datos actuales se conservaron si la validación o la transacción falló antes de confirmar.'), 'error');
  } finally {
    if (generacion === generacionSesionRespaldos) establecerOperacionRespaldoActiva(false);
  }
});

actualizarSoporteDeCarpetas();
