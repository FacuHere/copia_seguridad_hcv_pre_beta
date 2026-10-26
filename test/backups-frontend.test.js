const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash, webcrypto } = require('node:crypto');

const codigoRespaldos = fs.readFileSync(path.join(__dirname, '../public/js/backups.js'), 'utf8');

function crearElemento() {
  return {
    eventos: new Map(), dataset: {}, disabled: false, hidden: false, open: false,
    textContent: '', innerHTML: '', checked: false,
    classList: { toggle() {} },
    addEventListener(tipo, accion) { this.eventos.set(tipo, accion); },
    showModal() { this.open = true; },
    close() { this.open = false; },
  };
}

function crearEntorno() {
  const elementos = new Map();
  const elemento = selector => {
    if (!elementos.has(selector)) elementos.set(selector, crearElemento());
    return elementos.get(selector);
  };
  const radios = ['agregar', 'reemplazar'].map((value, indice) => ({ ...crearElemento(), value, checked: indice === 0 }));
  const pestanas = ['create', 'restore'].map(backupTab => ({ ...crearElemento(), dataset: { backupTab } }));
  const eventosVentana = new Map();
  const actualizacionesClinicas = [];
  const contexto = vm.createContext({
    Blob, FormData, TextEncoder,
    document: {
      querySelector(selector) {
        return selector === 'input[name="backupMode"]:checked' ? radios.find(radio => radio.checked) : elemento(selector);
      },
      querySelectorAll(selector) {
        if (selector === '[data-backup-tab]') return pestanas;
        if (selector === 'input[name="backupMode"]') return radios;
        if (selector === '[data-backup-tab], input[name="backupMode"]') return [...pestanas, ...radios];
        return [];
      },
    },
    window: {
      isSecureContext: true, crypto: webcrypto, confirm: () => true,
      async showDirectoryPicker() { throw new Error('No se esperaba abrir un selector.'); },
      addEventListener(tipo, accion) { eventosVentana.set(tipo, accion); },
    },
    async apiRequest() { throw new Error('No se esperaba consultar la API.'); },
    async actualizarVistaClinicaTrasRestauracion(modo) { actualizacionesClinicas.push(modo); },
    escaparHtml: valor => String(valor),
  });
  vm.runInContext(codigoRespaldos, contexto, { filename: 'public/js/backups.js' });
  return { contexto, elemento, radios, eventosVentana, actualizacionesClinicas };
}

function crearCarpetaVirtual(archivos, nombre = 'Respaldo de prueba') {
  const lecturas = [];
  function directorio(prefijo = '') {
    return {
      name: nombre,
      async getDirectoryHandle(segmento) { return directorio(`${prefijo}${segmento}/`); },
      async getFileHandle(segmento) {
        const ruta = `${prefijo}${segmento}`;
        lecturas.push(ruta);
        if (!Object.hasOwn(archivos, ruta)) throw new Error(`Archivo ausente: ${ruta}`);
        return { async getFile() { return new Blob([archivos[ruta]]); } };
      },
    };
  }
  return { ...directorio(), lecturas };
}

function crearRespaldoVacio() {
  const datos = JSON.stringify({ pacientes: [], estudios: [], documentos: [] });
  const manifiesto = {
    formato: 'hcv-respaldo-clinico', version: 1, archivoDatos: 'datos-clinicos.json',
    sha256Datos: createHash('sha256').update(datos).digest('hex'),
    conteos: { pacientes: 0, estudios: 0, documentos: 0 }, archivos: [],
  };
  return crearCarpetaVirtual({ 'manifest.json': JSON.stringify(manifiesto), 'datos-clinicos.json': datos });
}

const resumenClinico = { pacientes: 1, estudios: 1, documentos: 0, muestraPacientes: [{ nombre: 'Paciente sintético', dni: null }], hayMasPacientes: false };

test('la interfaz valida una carpeta completa leyendo los dos metadatos de la raíz', async () => {
  const { contexto } = crearEntorno();
  const carpeta = crearRespaldoVacio();

  const respaldo = await contexto.leerYValidarCarpetaRespaldo(carpeta);

  assert.equal(respaldo.manifiesto.formato, 'hcv-respaldo-clinico');
  assert.equal(respaldo.datos.pacientes.length, 0);
  assert.deepEqual(carpeta.lecturas, ['manifest.json', 'datos-clinicos.json']);
});

test('el lector permite documentos relativos y rechaza traversal y archivos raíz ajenos al formato', async () => {
  const { contexto } = crearEntorno();
  const carpeta = crearCarpetaVirtual({ 'documentos/informe.pdf': '%PDF-1.4' });
  assert.equal(await (await contexto.leerArchivo(carpeta, 'documentos/informe.pdf')).text(), '%PDF-1.4');

  for (const ruta of ['.env', 'otro.json', '../manifest.json', '/manifest.json', 'C:/manifest.json', 'documentos/../otro.pdf', 'documentos\\informe.pdf']) {
    await assert.rejects(contexto.leerArchivo(carpeta, ruta), /ruta de un archivo del respaldo no es válida/);
  }
  assert.deepEqual(carpeta.lecturas, ['documentos/informe.pdf']);
});

test('los lotes conservan todos los registros sin superar el límite HTTP en bytes UTF-8', async () => {
  const { contexto } = crearEntorno();
  const solicitudes = [];
  contexto.apiRequest = async (ruta, opciones) => { solicitudes.push({ ruta, cuerpo: opciones.body }); return {}; };
  const registros = Array.from({ length: 5 }, (_, indice) => ({ id: String(indice + 1), notes: 'ñ'.repeat(30000) }));

  await contexto.enviarRegistrosPorLotes('operacion-sintetica', 'pacientes', registros);

  assert.equal(solicitudes.length, 2);
  for (const solicitud of solicitudes) {
    assert.ok(Buffer.byteLength(solicitud.cuerpo, 'utf8') <= 256 * 1024);
    assert.ok(JSON.parse(solicitud.cuerpo).registros.length <= 5);
  }
  assert.deepEqual(solicitudes.flatMap(solicitud => JSON.parse(solicitud.cuerpo).registros), registros);
});

test('un registro que supera por sí solo el límite JSON muestra un error antes de enviarse', async () => {
  const { contexto } = crearEntorno();
  let solicitudes = 0;
  contexto.apiRequest = async () => { solicitudes += 1; };

  await assert.rejects(contexto.enviarRegistrosPorLotes('operacion-sintetica', 'pacientes', [{ id: '1', notes: '\u0000'.repeat(50000) }]), { code: 'RESTORE_RECORD_TOO_LARGE' });
  assert.equal(solicitudes, 0);
});

test('reabrir el diálogo no permite duplicar una operación ni cambiar sus carpetas', async () => {
  const { contexto, elemento } = crearEntorno();
  let selecciones = 0;
  contexto.window.showDirectoryPicker = async () => { selecciones += 1; return { name: 'Destino sintético' }; };
  await elemento('#backupChooseDestination').eventos.get('click')();
  let rechazar;
  let solicitudes = 0;
  contexto.apiRequest = () => { solicitudes += 1; return new Promise((_resolver, rechazo) => { rechazar = rechazo; }); };

  const operacion = elemento('#backupCreateButton').eventos.get('click')();
  elemento('#backupClose').eventos.get('click')();
  contexto.mostrarVentanaRespaldos();
  assert.equal(elemento('#backupCreateButton').disabled, true);
  assert.equal(elemento('#backupChooseSource').disabled, true);
  assert.equal(elemento('#backupChooseDestination').disabled, true);
  assert.equal(elemento('#backupStatus').textContent, 'Consultando los datos clínicos…');
  await elemento('#backupCreateButton').eventos.get('click')();
  await elemento('#backupChooseSource').eventos.get('click')();
  assert.equal(solicitudes, 1);
  assert.equal(selecciones, 1);
  rechazar(new Error('Fallo sintético anterior a crear la operación'));
  await operacion;
  assert.equal(elemento('#backupCreateButton').disabled, false);
  assert.equal(elemento('#backupChooseSource').disabled, false);
});

test('un selector iniciado por una sesión anterior no vuelve a publicar su carpeta después del cierre', async () => {
  const { contexto, elemento, eventosVentana } = crearEntorno();
  let resolver;
  contexto.window.showDirectoryPicker = () => new Promise(resolucion => { resolver = resolucion; });
  const seleccion = elemento('#backupChooseDestination').eventos.get('click')();

  eventosVentana.get('hcv:sesion-reiniciada')();
  resolver({ name: 'Carpeta de la sesión anterior' });
  await seleccion;

  assert.equal(elemento('#backupDestinationLabel').textContent, 'No se eligió una carpeta.');
  assert.equal(elemento('#backupCreateButton').disabled, true);
  assert.equal(elemento('#backupPreview').innerHTML, '');
});

test('una exportación pendiente de una sesión anterior no escribe carpetas ni cancela con la sesión nueva', async () => {
  const { contexto, elemento, eventosVentana } = crearEntorno();
  let escrituras = 0;
  contexto.window.showDirectoryPicker = async () => ({ name: 'Destino anterior', async getDirectoryHandle() { escrituras += 1; } });
  await elemento('#backupChooseDestination').eventos.get('click')();
  const solicitudes = [];
  let resolver;
  contexto.apiRequest = ruta => { solicitudes.push(ruta); return new Promise(resolucion => { resolver = resolucion; }); };
  const exportacion = elemento('#backupCreateButton').eventos.get('click')();

  eventosVentana.get('hcv:sesion-reiniciada')();
  resolver({ data: { operationId: 'operacion-anterior', formato: 'hcv-respaldo-clinico', version: 1 } });
  await exportacion;

  assert.deepEqual(solicitudes, ['/api/respaldos/exportar']);
  assert.equal(escrituras, 0);
  assert.equal(elemento('#backupStatus').textContent, '');
  assert.equal(elemento('#backupCreateButton').disabled, true);
});

test('una cancelación ya iniciada no publica el error anterior después de cambiar la sesión', async () => {
  const { contexto, elemento, eventosVentana } = crearEntorno();
  contexto.window.showDirectoryPicker = async () => ({ name: 'Destino sintético', async getDirectoryHandle() { throw new Error('Fallo sintético al crear carpeta'); } });
  await elemento('#backupChooseDestination').eventos.get('click')();
  let avisarCancelacion;
  const cancelacionIniciada = new Promise(resolver => { avisarCancelacion = resolver; });
  let resolverCancelacion;
  contexto.apiRequest = async ruta => {
    if (ruta === '/api/respaldos/exportar') return { data: { operationId: 'operacion-sintetica', formato: 'hcv-respaldo-clinico', version: 1, datos: {} } };
    if (ruta.endsWith('/cancelar')) {
      avisarCancelacion();
      return new Promise(resolver => { resolverCancelacion = resolver; });
    }
    throw new Error(`Ruta no esperada: ${ruta}`);
  };
  const exportacion = elemento('#backupCreateButton').eventos.get('click')();
  await cancelacionIniciada;

  eventosVentana.get('hcv:sesion-reiniciada')();
  resolverCancelacion({});
  await exportacion;

  assert.equal(elemento('#backupStatus').textContent, '');
  assert.equal(elemento('#backupCreateButton').disabled, true);
});

test('la restauración confirmada actualiza la vista clínica y distingue un fallo posterior de actualización', async () => {
  for (const fallaActualizacion of [false, true]) {
    const { contexto, elemento, actualizacionesClinicas } = crearEntorno();
    const solicitudes = [];
    contexto.window.showDirectoryPicker = async () => crearRespaldoVacio();
    contexto.apiRequest = async ruta => {
      solicitudes.push(ruta);
      if (ruta.endsWith('/resumen-clinico')) return { data: resumenClinico };
      if (ruta === '/api/respaldos/restauraciones') return { data: { operationId: 'restauracion-sintetica' } };
      if (ruta.endsWith('/confirmar')) return { data: { limpiezaPendiente: false } };
      throw new Error(`Ruta no esperada: ${ruta}`);
    };
    if (fallaActualizacion) contexto.actualizarVistaClinicaTrasRestauracion = async () => { throw new Error('Error sintético de actualización'); };
    await elemento('#backupChooseSource').eventos.get('click')();

    await elemento('#backupRestoreButton').eventos.get('click')();

    assert.ok(solicitudes.includes('/api/respaldos/restauraciones/restauracion-sintetica/confirmar'));
    assert.equal(solicitudes.some(ruta => ruta.endsWith('/cancelar')), false);
    if (fallaActualizacion) {
      assert.match(elemento('#backupStatus').textContent, /^Los datos fueron restaurados, pero no se pudo actualizar la vista/);
    } else {
      assert.deepEqual(actualizacionesClinicas, ['agregar']);
      assert.match(elemento('#backupStatus').textContent, /^Restauración completada/);
    }
  }
});
