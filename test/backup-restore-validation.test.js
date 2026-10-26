const test = require('node:test');
const assert = require('node:assert/strict');
const { validarArchivoRelativo, validarDatosClinicos } = require('../src/services/backup-service');

function crearDatosClinicos() {
  return {
    pacientes: [{
      id: '1', fullName: 'Paciente de prueba', dni: '12345678', birthDate: null,
      phone: null, address: null, notes: null, version: 1,
      createdByUsername: 'admin_prueba', updatedByUsername: 'admin_prueba',
      createdAt: '2026-01-02 03:04:05', updatedAt: '2026-01-02 03:04:05',
    }],
    estudios: [{
      id: '2', patientId: '1', serviceCode: 'GENERAL', type: 'Radiología', date: '2026-01-02',
      professional: null, diagnosis: null, procedure: null, description: null, conclusions: null,
      version: 1, createdByUsername: 'admin_prueba', updatedByUsername: 'admin_prueba',
      createdAt: '2026-01-02 03:04:05', updatedAt: '2026-01-02 03:04:05',
    }],
    documentos: [{
      id: '3', patientId: '1', studyId: '2', originalName: 'informe.pdf', archivePath: 'documentos/D-3 - informe.pdf',
      mimeType: 'application/pdf', sizeBytes: '5', sha256: 'a'.repeat(64), uploadedByUsername: 'admin_prueba',
      updatedByUsername: null, createdAt: '2026-01-02 03:04:05', updatedAt: '2026-01-02 03:04:05',
      derivedFromDocumentId: null,
    }],
  };
}

test('acepta rutas de documentos relativas y rechaza traversal o rutas fuera de la carpeta', () => {
  assert.equal(validarArchivoRelativo('documentos/D-3 - informe.pdf'), true);
  assert.equal(validarArchivoRelativo('../documentos/informe.pdf'), false);
  assert.equal(validarArchivoRelativo('documentos/../../otro.pdf'), false);
  assert.equal(validarArchivoRelativo('C:/documentos/informe.pdf'), false);
  assert.equal(validarArchivoRelativo('documentos\\informe.pdf'), false);
});

test('valida relaciones paciente-estudio-documento antes de restaurar', () => {
  const datos = crearDatosClinicos();
  assert.equal(validarDatosClinicos(datos).documentos.has('3'), true);

  const estudioConPacienteAusente = structuredClone(datos);
  estudioConPacienteAusente.estudios[0].patientId = '9';
  assert.throws(() => validarDatosClinicos(estudioConPacienteAusente), { code: 'BACKUP_RELATION_INVALID' });

  const documentoConPacienteDistinto = structuredClone(datos);
  documentoConPacienteDistinto.documentos[0].patientId = '9';
  assert.throws(() => validarDatosClinicos(documentoConPacienteDistinto), { code: 'BACKUP_RELATION_INVALID' });
});

test('permite Agregar pacientes con DNI repetido y conserva sus identidades de origen distintas', () => {
  const datos = crearDatosClinicos();
  datos.pacientes.push({ ...datos.pacientes[0], id: '4', fullName: 'Otra persona con DNI repetido' });

  const resultado = validarDatosClinicos(datos);

  assert.equal(resultado.pacientes.size, 2);
  assert.equal(resultado.pacientes.get('1').dni, resultado.pacientes.get('4').dni);
});

test('rechaza IDs de origen duplicados para evitar sobrescribir registros del mismo respaldo', () => {
  const datos = crearDatosClinicos();
  datos.pacientes.push({ ...datos.pacientes[0], fullName: 'Duplicado' });

  assert.throws(() => validarDatosClinicos(datos), { code: 'BACKUP_PATIENT_INVALID' });
});
