"""Respaldo y restauración reales; selección de carpeta controlada con OPFS nativo.

El selector del sistema operativo se sustituye para automatizarlo. Los handles,
archivos, streams, hashes, API, MariaDB y almacenamiento del servidor son reales.
"""
import argparse,base64,json,time
from datetime import datetime,timezone
from playwright.sync_api import sync_playwright,expect
from ejecutar_matriz import Pruebas,PUBLICO,PRIVADO,URL
from matriz_interfaz import Interfaz

PREPARAR_JS='''async()=>{
window.qcRaiz=await navigator.storage.getDirectory();
window.qcDestino=await window.qcRaiz.getDirectoryHandle('ensayo-qc',{create:true});
window.showDirectoryPicker=async()=>window.qcDestino;
window.qcCopiar=async function(origen,destino){for await(const e of origen.values()){
if(e.kind==='directory')await window.qcCopiar(e,await destino.getDirectoryHandle(e.name,{create:true}));
else{const w=await(await destino.getFileHandle(e.name,{create:true})).createWritable();await w.write(await e.getFile());await w.close();}}};
window.qcEscribir=async function(carpeta,nombre,contenido){const w=await(await carpeta.getFileHandle(nombre,{create:true})).createWritable();await w.write(contenido);await w.close();};
}'''

class Respaldos:
    def __init__(self,p):
        self.p=p;self.ui=Interfaz(p);self.pagina=self.ui.pagina;self.pagina.set_default_timeout(30000)
        self.pagina.evaluate(PREPARAR_JS);self.pagina.locator('#chooseFolder').click();expect(self.pagina.locator('#backupDialog')).to_be_visible()
        self.limpiar_archivos_grandes()
        self.base=self.exportar();(PRIVADO/'respaldo-clinico-previo.json').write_text(json.dumps(self.base,ensure_ascii=False),encoding='utf8')
        self.contenidos={}
        for d in self.base['datos']['documentos']:
            r=p.peticion('get','/api/respaldos/documentos/'+d['id']);self.contenidos[d['id']]=r.body();(PRIVADO/('previo-documento-'+d['id'])).write_bytes(r.body())
        self.cuentas_antes=self.cuentas();self.ultima=None
    def limpiar_archivos_grandes(self):
        id=self.p.estado['estudio']['id'];paciente=self.p.peticion('get','/api/pacientes/'+self.p.estado['paciente']['id']).json()['data']
        assert paciente['fullName'].startswith(self.p.prefijo)
        for d in self.p.peticion('get','/api/estudios/'+id+'/documentos').json()['data']:
            if int(d['sizeBytes'])>1024*1024:self.p.peticion('delete','/api/documentos/'+d['id'],204)
    def cuentas(self):
        datos=[];pagina=1
        while True:
            lote=self.p.peticion('get','/api/users',params={'page':pagina}).json()['data'];datos.extend(lote)
            if len(lote)<50:return sorted((x['id'],x['username'],x['isActive'],tuple(x['roles'])) for x in datos)
            pagina+=1
    def resumen(self):return self.p.peticion('get','/api/respaldos/resumen-clinico').json()['data']
    def conteos(self):
        r=self.resumen();return {k:r[k] for k in ['pacientes','estudios','documentos']}
    def exportar(self,referencias=False):
        a=self.p.peticion('post','/api/respaldos/exportar',201,{'incluirReferenciasUsuarios':referencias}).json()['data'];self.p.peticion('post','/api/respaldos/exportar/'+a['operationId']+'/completar');return a
    def restaurar_api(self,datos,modo='reemplazar',archivos=None):
        conteos={k:len(datos[k]) for k in ['pacientes','estudios','documentos']};a=self.p.peticion('post','/api/respaldos/restauraciones',201,{'formato':self.base['formato'],'version':self.base['version'],'modo':modo,'conteos':conteos}).json()['data'];id=a['operationId']
        try:
            for tipo in conteos:
                for inicio in range(0,len(datos[tipo]),5):self.p.peticion('post','/api/respaldos/restauraciones/'+id+'/registros',201,{'tipo':tipo,'registros':datos[tipo][inicio:inicio+5]})
            for documento in datos['documentos']:
                contenido=(archivos or self.contenidos)[documento['id']]
                self.p.peticion('post','/api/respaldos/restauraciones/'+id+'/documentos/'+documento['id'],201,multipart={'file':{'name':documento['originalName'],'mimeType':documento['mimeType'],'buffer':contenido}})
            return self.p.peticion('post','/api/respaldos/restauraciones/'+id+'/confirmar').json()['data']
        except Exception:
            self.p.admin.post('/api/respaldos/operaciones/'+id+'/cancelar');raise
    def crear_ui(self,referencias=False):
        self.pagina.locator('[data-backup-tab=create]').click();self.pagina.evaluate('window.showDirectoryPicker=async()=>window.qcDestino');self.pagina.locator('#backupChooseDestination').click();expect(self.pagina.locator('#backupCreateButton')).to_be_enabled();self.pagina.locator('#backupIncludeUsers').set_checked(referencias)
        self.pagina.locator('#backupCreateButton').click();expect(self.pagina.locator('#backupStatus')).to_contain_text('Respaldo completo guardado',timeout=90000)
        self.ultima=self.pagina.evaluate('''async()=>{const a=[];for await(const x of window.qcDestino.values())if(x.kind==='directory')a.push(x.name);a.sort();window.qcRespaldo=await window.qcDestino.getDirectoryHandle(a.at(-1));return a.at(-1)}''')
        return self.pagina.evaluate('''async()=>JSON.parse(await(await(await window.qcRespaldo.getFileHandle('manifest.json')).getFile()).text())''')
    def elegir_origen(self,variable='qcRespaldo',valido=True):
        self.pagina.locator('[data-backup-tab=restore]').click();self.pagina.evaluate('(v)=>window.showDirectoryPicker=async()=>window[v]',variable);self.pagina.locator('#backupChooseSource').click()
        if valido:expect(self.pagina.locator('#backupRestoreButton')).to_be_enabled();expect(self.pagina.locator('#backupPreview')).to_be_visible()
        else:expect(self.pagina.locator('#backupStatus')).to_have_attribute('data-state','error')
    def restaurar_ui(self,modo='agregar',aceptar=True):
        self.elegir_origen();self.pagina.locator('[name=backupMode][value='+modo+']').check()
        self.pagina.once('dialog',lambda d:d.accept() if aceptar else d.dismiss());self.pagina.locator('#backupRestoreButton').click()
        if aceptar:expect(self.pagina.locator('#backupStatus')).to_contain_text('Restauración completada',timeout=90000)
    def copia(self):
        self.pagina.evaluate('''async()=>{window.qcCopia=await window.qcRaiz.getDirectoryHandle('copia-'+crypto.randomUUID(),{create:true});await window.qcCopiar(window.qcRespaldo,window.qcCopia)}''')
    def caso(self,n,objetivo,accion,canal=None):self.p.caso(n,objetivo,accion,canal or 'Interfaz + API + archivos reales; selector sustituido por OPFS nativo del navegador')
    def ejecutar(self):
        def completo():
            a=self.crear_ui();self.p.comprobar(a['conteos']==self.base['conteos'],'El manifiesto coincide con el conjunto clínico');self.p.comprobar(len(a['archivos'])==self.base['conteos']['documentos'],'Inventario completo de archivos')
            resultado=self.pagina.evaluate('''async()=>{const r=await leerYValidarCarpetaRespaldo(window.qcRespaldo);for(const d of r.datos.documentos){const f=await leerArchivo(window.qcRespaldo,d.archivePath);if(await calcularSha256(f)!==d.sha256)return false}return true}''');self.p.comprobar(resultado,'Todos los archivos guardados en el cliente coinciden en SHA-256')
        self.caso(147,'Crear respaldo completo en el cliente y comprobar todos sus archivos',completo)
        def referencias():
            for incluir in [False,True]:
                a=self.exportar(incluir);self.p.comprobar(('referenciasUsuarios' in a['datos'])==incluir,'La opción controla la inclusión de referencias');texto=json.dumps(a);self.p.comprobar('password_hash' not in texto and 'token_hash' not in texto,'El respaldo no contiene hashes de credenciales o sesiones')
        self.caso(150,'Incluir y excluir referencias de usuarios sin secretos',referencias,'API real en Docker')
        def selector_cancelado():
            self.pagina.locator('[data-backup-tab=create]').click();anterior=self.pagina.locator('#backupDestinationLabel').inner_text();self.pagina.evaluate('()=>{window.showDirectoryPicker=async()=>{throw new DOMException("Cancelado QC","AbortError")}}');self.pagina.locator('#backupChooseDestination').click();expect(self.pagina.locator('#backupDestinationLabel')).to_have_text(anterior)
        self.caso(151,'Cancelar selección de destino sin iniciar exportación',selector_cancelado)
        def sin_permiso():
            self.pagina.evaluate('()=>{window.showDirectoryPicker=async()=>{throw new DOMException("Denegado QC","NotAllowedError")}}');self.pagina.locator('#backupChooseDestination').click();expect(self.pagina.locator('#backupStatus')).to_contain_text('No se pudo acceder')
        self.caso(152,'Informar que no se tiene permiso sobre el destino',sin_permiso)
        def controles():
            self.pagina.evaluate('''()=>{window.qcBloqueo=false;new MutationObserver(()=>{if(document.querySelector('#backupCreateButton').disabled&&document.querySelector('#backupIncludeUsers').disabled)window.qcBloqueo=true}).observe(document.querySelector('#backupDialog'),{subtree:true,attributes:true})}''');self.crear_ui();self.p.comprobar(self.pagina.evaluate('window.qcBloqueo'),'Los controles se deshabilitaron durante el respaldo');expect(self.pagina.locator('#backupCreateButton')).to_be_enabled()
        self.caso(153,'Bloquear controles durante el respaldo y habilitarlos al terminar',controles)
        def dos():
            a=self.ultima;self.crear_ui();self.p.comprobar(self.ultima!=a,'Dos respaldos en el mismo destino tienen carpetas distintas')
        self.caso(154,'Guardar dos respaldos sin sobrescribir la carpeta anterior',dos)
        self.caso(155,'Validar carpeta y mostrar su resumen',lambda:self.elegir_origen())
        def ajena():
            self.pagina.evaluate('''async()=>{window.qcCopia=await window.qcRaiz.getDirectoryHandle('ajena-'+crypto.randomUUID(),{create:true});await window.qcEscribir(window.qcCopia,'manifest.json',JSON.stringify({formato:'ajeno',version:1}))}''');self.elegir_origen('qcCopia',False)
        self.caso(156,'Rechazar carpeta con formato ajeno',ajena)
        def falta(nombre):
            self.copia();self.pagina.evaluate('async n=>{await window.qcCopia.removeEntry(n)}',nombre);self.elegir_origen('qcCopia',False);expect(self.pagina.locator('#backupRestoreButton')).to_be_disabled()
        self.caso(157,'Rechazar respaldo sin manifest.json',lambda:falta('manifest.json'))
        self.caso(158,'Rechazar respaldo sin datos-clinicos.json',lambda:falta('datos-clinicos.json'))
        def falta_documento():
            self.copia();self.pagina.evaluate('''async()=>{const m=JSON.parse(await(await(await qcCopia.getFileHandle('manifest.json')).getFile()).text());const a=m.archivos[0].ruta.split('/');await(await qcCopia.getDirectoryHandle(a[0])).removeEntry(a[1])}''');self.elegir_origen('qcCopia',False)
        self.caso(159,'Detectar archivo clínico faltante en la carpeta',falta_documento)
        def alterar_datos():
            self.copia();self.pagina.evaluate('''async()=>{const a=await(await qcCopia.getFileHandle('datos-clinicos.json')).getFile();await qcEscribir(qcCopia,'datos-clinicos.json',(await a.text())+' ')}''');self.elegir_origen('qcCopia',False)
        self.caso(160,'Rechazar archivo de datos con SHA-256 alterado',alterar_datos)
        self.caso(161,'Rechazar documento alterado del mismo tamaño antes de confirmar',self.alterar_documento)
        def agregar():
            antes=self.conteos();self.restaurar_ui('agregar');despues=self.conteos();self.p.comprobar(all(despues[k]==antes[k]+self.base['conteos'][k] for k in antes),'Agregar conserva lo existente y suma todos los registros del respaldo')
        self.caso(162,'Restaurar agregando datos y archivos sin reemplazar los actuales',agregar)
        def dni():
            paciente=next(x for x in self.base['datos']['pacientes'] if x.get('dni'));antes=len(self.p.peticion('get','/api/pacientes',params={'search':paciente['dni']}).json()['data']);self.restaurar_api({'pacientes':[paciente],'estudios':[],'documentos':[]},'agregar');despues=self.p.peticion('get','/api/pacientes',params={'search':paciente['dni']}).json()['data'];self.p.comprobar(len(despues)==antes+1,'El DNI coincidente genera un registro adicional sin fusión')
        self.caso(163,'Agregar un paciente con DNI coincidente sin fusionarlo',dni,'API real en Docker')
        def cancelar(modo):
            antes=self.conteos();self.restaurar_ui(modo,False);self.p.comprobar(self.conteos()==antes,'Cancelar conserva todos los conteos clínicos')
            if modo=='reemplazar':expect(self.pagina.locator('#backupReplaceWarning')).to_be_visible()
        self.caso(164,'Cancelar la confirmación de Agregar',lambda:cancelar('agregar'))
        self.caso(165,'Mostrar advertencia y cancelar Reemplazar',lambda:cancelar('reemplazar'))
        self.caso(168,'Reemplazo incompleto no elimina los datos actuales',self.reemplazo_incompleto,'API real en Docker')
        def reemplazar():
            self.restaurar_ui('reemplazar');self.p.comprobar(self.conteos()==self.base['conteos'],'Reemplazar deja exactamente los conteos del respaldo');actual=self.exportar();esperados=sorted(d['sha256'] for d in self.base['datos']['documentos']);self.p.comprobar(sorted(d['sha256'] for d in actual['datos']['documentos'])==esperados,'Todos los hashes documentales se conservan al restaurar')
        self.caso(166,'Restaurar reemplazando y comprobar integridad documental',reemplazar)
        self.caso(167,'Conservar cuentas y perfiles al reemplazar',lambda:self.p.comprobar(self.cuentas()==self.cuentas_antes,'Todas las cuentas, estados y perfiles se conservaron'),'API real en Docker')
        self.caso(170,'Escribir respaldos en el sistema de archivos del navegador cliente',lambda:self.p.comprobar(self.pagina.evaluate('window.qcRespaldo instanceof FileSystemDirectoryHandle'),'El respaldo se guardó mediante un handle nativo del cliente'))
        def sin_soporte():
            self.pagina.evaluate('window.showDirectoryPicker=undefined');self.pagina.locator('#backupClose').click();self.pagina.locator('#chooseFolder').click();expect(self.pagina.locator('#backupSecurityNote')).to_be_visible();expect(self.pagina.locator('#backupChooseDestination')).to_be_disabled();self.pagina.evaluate('window.showDirectoryPicker=async()=>window.qcDestino')
        self.caso(171,'Informar falta de soporte del selector de carpetas',sin_soporte)
        self.caso(169,'Olvidar carpetas elegidas al cerrar sesión',self.olvidar_carpetas)
        self.caso(149,'Respaldar un conjunto clínico vacío',self.vacio,'UI y API reales; conjunto vacío temporal y recuperación posterior')
        self.caso(148,'Respaldar pacientes y estudios sin documentos',self.sin_documentos,'UI y API reales; datos temporales y recuperación posterior')
        self.reenlazar_estado()
    def alterar_documento(self):
        self.copia();self.pagina.evaluate('''async()=>{const m=JSON.parse(await(await(await qcCopia.getFileHandle('manifest.json')).getFile()).text());const a=m.archivos[0].ruta.split('/');const d=await qcCopia.getDirectoryHandle(a[0]);const f=await(await d.getFileHandle(a[1])).getFile();const b=new Uint8Array(await f.arrayBuffer());b[b.length-1]^=1;await qcEscribir(d,a[1],b)}''');self.elegir_origen('qcCopia');antes=self.conteos();self.pagina.locator('[name=backupMode][value=reemplazar]').check();self.pagina.once('dialog',lambda d:d.accept());self.pagina.locator('#backupRestoreButton').click();expect(self.pagina.locator('#backupStatus')).to_have_attribute('data-state','error',timeout=90000);self.p.comprobar(self.conteos()==antes,'Documento alterado rechazado sin reemplazar datos')
    def reemplazo_incompleto(self):
        antes=self.conteos();a=self.p.peticion('post','/api/respaldos/restauraciones',201,{'formato':self.base['formato'],'version':1,'modo':'reemplazar','conteos':{'pacientes':1,'estudios':0,'documentos':0}}).json()['data'];id=a['operationId']
        try:self.p.peticion('post','/api/respaldos/restauraciones/'+id+'/confirmar',422);self.p.comprobar(self.conteos()==antes,'Rechazo previo al commit conserva los conteos')
        finally:self.p.admin.post('/api/respaldos/operaciones/'+id+'/cancelar')
    def olvidar_carpetas(self):
        self.pagina.locator('#backupClose').click();self.pagina.locator('#logoutButton').click();expect(self.pagina.locator('#loginForm')).to_be_visible();self.ui.login(self.pagina,self.p.usuario,self.p.contrasena);self.pagina.locator('#chooseFolder').click();expect(self.pagina.locator('#backupDestinationLabel')).to_contain_text('No se eligió');expect(self.pagina.locator('#backupSourceLabel')).to_contain_text('No se eligió');expect(self.pagina.locator('#backupCreateButton')).to_be_disabled();self.pagina.evaluate(PREPARAR_JS)
    def vacio(self):
        try:
            self.restaurar_api({'pacientes':[],'estudios':[],'documentos':[]});self.p.comprobar(self.conteos()=={'pacientes':0,'estudios':0,'documentos':0},'Conjunto clínico vacío preparado');a=self.crear_ui();self.p.comprobar(a['conteos']=={'pacientes':0,'estudios':0,'documentos':0},'Manifiesto de respaldo vacío correcto')
        finally:self.restaurar_api(self.base['datos'])
    def sin_documentos(self):
        try:
            self.restaurar_api({'pacientes':[],'estudios':[],'documentos':[]});a=self.p.paciente();self.p.estudio(a);m=self.crear_ui();self.p.comprobar(m['conteos']=={'pacientes':1,'estudios':1,'documentos':0},'Manifiesto incluye paciente y estudio sin exigir archivos')
        finally:self.restaurar_api(self.base['datos'])
    def reenlazar_estado(self):
        pacientes=self.p.peticion('get','/api/pacientes',params={'search':self.p.estado['paciente']['fullName']}).json()['data'];a=next(x for x in pacientes if x['fullName']==self.p.estado['paciente']['fullName']);a=self.p.peticion('get','/api/pacientes/'+a['id']).json()['data'];self.p.estado['paciente']=a
        estudios=self.p.peticion('get','/api/pacientes/'+a['id']+'/estudios').json()['data']
        for e in estudios:
            docs=self.p.peticion('get','/api/estudios/'+e['id']+'/documentos').json()['data']
            if len(docs)>=9:
                self.p.estado['estudio']=e
                for d in docs:
                    extension=d['originalName'].rsplit('.',1)[-1].lower()
                    if extension in self.p.estado['documentos'] and d['originalName'].startswith('prueba.'):self.p.estado['documentos'][extension]=d
                break
        self.p.guardar_estado()
    def cerrar(self):self.ui.cerrar()

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--casos');args=parser.parse_args()
    with sync_playwright() as motor:
        p=Pruebas(motor);p.inicio=datetime.now(timezone.utc).isoformat();p.identificador='MATRIZ-'+datetime.now().strftime('%Y%m%d-%H%M%S')+'-respaldos';p.fase='respaldos';p.entorno={};p.seleccion={int(x) for x in args.casos.split(',')} if args.casos else None
        r=Respaldos(p)
        try:r.ejecutar()
        finally:r.cerrar();p.cerrar();p.guardar_reporte()
if __name__=='__main__':main()
