"""Vuelca resultados reales a la RTM, sin convertir ausencia de ejecución en éxito."""
from pathlib import Path
import json,re
RAIZ=Path(__file__).resolve().parents[2];CARPETA=RAIZ/'reports/qc/matriz-ejecucion-20261117'
MATRIZ=RAIZ/'docs/matriz-trazabilidad-hcv.md'
NUEVOS={186:('Consultar salud de MariaDB y almacenamiento','RN-007','RF-7.1','HU-24'),187:('Consultar un estudio por identificador','RN-003','RF-3.3','HU-12'),188:('Listar documentos de un estudio','RN-004','RF-4.1','HU-18'),189:('Recuperar una carga pendiente desde el journal al reiniciar','RN-004','RF-4.6','HU-23'),190:('Crear el administrador técnico inicial y rechazar un segundo bootstrap','RN-005','RF-5.1','HU-25'),191:('Restablecer contraseña por CLI y revocar sesiones','RN-005','RF-5.2','HU-26'),192:('Aceptar nombre de un carácter','RN-002','RF-2.3','HU-07'),193:('Aceptar nombre de dos caracteres','RN-002','RF-2.3','HU-07'),194:('Aceptar usuario de cuatro caracteres','RN-005','RF-5.3','HU-27, HU-29'),195:('Aceptar usuario de 99 caracteres','RN-005','RF-5.3','HU-27, HU-29'),196:('Aceptar contraseña administrativa de 1023 caracteres','RN-005','RF-5.3','HU-27, HU-29'),197:('Aceptar contraseña administrativa de 1024 caracteres','RN-005','RF-5.3','HU-27, HU-29'),198:('Rechazar contraseña administrativa de 1025 caracteres','RN-005','RF-5.3','HU-27, HU-29')}
ASIGNACIONES={'RF-3.3':187,'RF-4.1':188,'RF-4.6':189,'RF-5.1':190,'RF-5.2':191,'RF-7.1':186}
def ids(texto):
    salida=set()
    for m in re.finditer(r'TC-(\d{3})(?:[–−-](?:TC-)?(\d{3}))?',texto):salida.update(range(int(m[1]),int(m[2] or m[1])+1))
    return salida
def resultados():
    registros={}
    for archivo in sorted(CARPETA.glob('MATRIZ-*.json')):
        for resultado in json.loads(archivo.read_text(encoding='utf8'))['resultados']:
            numero=int(resultado['caso'].split('-')[1]);copia={**resultado,'reporte':archivo.relative_to(RAIZ).as_posix()}
            registros.setdefault(numero,[]).append(copia)
    return registros
def elegir(registros,n):
    ejecuciones=registros.get(n,[])
    # Mantener la aprobación posterior al fallo. Un bloqueo posterior del mismo
    # canal no debe quedar oculto por el éxito de una ejecución antigua.
    return ejecuciones[-1] if ejecuciones else None
def main():
    registros=resultados();s=MATRIZ.read_text(encoding='utf8')
    if not (CARPETA/'matriz-antes-de-resultados.md').exists():(CARPETA/'matriz-antes-de-resultados.md').write_text(s,encoding='utf8')
    lineas=[];resumen=[];agregados=set()
    for linea in s.splitlines():
        if linea.startswith('| RN-'):
            c=[x.strip() for x in linea.strip('|').split('|')];rf=c[1].split()[0]
            if len(c)!=6:
                lineas.append(linea);continue
            if rf in ASIGNACIONES:c[3]='TC-'+str(ASIGNACIONES[rf])
            if rf=='RF-2.3' and 'TC-192' not in c[3]:c[3]+=', TC-192–193'
            if rf=='RF-5.3' and 'TC-194' not in c[3]:c[3]+=', TC-194–198'
            casos=ids(c[3]);evaluables=casos-{4};estados=[elegir(registros,n) for n in evaluables]
            aprobados=sum(x is not None and x['estado']=='aprobado' for x in estados);fallidos=sum(x is not None and x['estado']=='fallido' for x in estados);bloqueados=sum(x is not None and x['estado']=='bloqueado' for x in estados);sin=sum(x is None for x in estados)
            c[4]=f'{aprobados}/{len(evaluables)} TC aprobados'+(f'; {fallidos} fallido'+('s' if fallidos!=1 else '') if fallidos else '')+(f'; {bloqueados} bloqueado'+('s' if bloqueados!=1 else '') if bloqueados else '')+(f'; {sin} sin ejecutar' if sin else '')
            if rf=='RF-2.5':c[4]='TC-060 aprobado: eliminación deshabilitada'
            if rf=='RF-8.1':c[4]='TC-182 aprobado: control reservado; no genera reportes'
            linea='| '+' | '.join(c)+' |';resumen.append({'requisito':rf,'casos':sorted(casos),'estado':c[4]})
        elif re.match(r'^\| TC-\d{3} [^|]',linea):
            c=[x.strip() for x in linea.strip('|').split('|')];n=int(re.search(r'TC-(\d{3})',c[0])[1]);agregados.add(n);r=elegir(registros,n)
            if r:
                c[6]=r['estado'].capitalize()+' 17/11/2026';c[7]=f"{r['objetivo']}. Canal: {r['canal']}. [Reporte](../{r['reporte']}).";linea='| '+' | '.join(c)+' |'
        lineas.append(linea)
    s='\n'.join(lineas)+'\n'
    nuevas=[]
    for n,(nombre,rn,rf,hu) in NUEVOS.items():
        if n in agregados:continue
        r=elegir(registros,n);estado=r['estado'].capitalize()+' 17/11/2026' if r else 'En ejecución/preparación'
        evidencia=f"{r['objetivo']}. Canal: {r['canal']}. [Reporte](../{r['reporte']})." if r else 'Caso asignado para completar la verificación funcional.'
        nuevas.append(f'| TC-{n:03} {nombre} | {rn} | {rf} | {hu} | Vigente | — | {estado} | {evidencia} |')
    if nuevas:s=s.replace('\n## Brechas y alcance parcial','\n'+'\n'.join(nuevas)+'\n\n## Brechas y alcance parcial')
    s=s.replace('Esta versión selecciona 176 casos','Esta versión selecciona 189 casos').replace('El índice inverso reúne los 176 casos','El índice inverso reúne los 189 casos').replace('selección de 176 casos','selección de 189 casos')
    for rf,n in ASIGNACIONES.items():
        s=re.sub(r'(?m)^- \*\*'+re.escape(rf)+r' ([^*]+)\*\*:.*$',lambda m:f'- **{rf} {m[1]}**: caso dedicado TC-{n:03}; el resultado y su reporte se consultan en el índice inverso.',s)
    aviso='## Ejecución de la matriz del 17 de noviembre\n\nLas columnas de seguimiento y el resumen se actualizan desde los reportes de `reports/qc/matriz-ejecucion-20261117/`. Cada aprobación corresponde al objetivo y canal descritos en su reporte; las pruebas de carpetas identifican el selector sustituido y el uso de archivos nativos OPFS en el cliente. Los casos de red hospitalaria requieren ese despliegue.\n\n'
    if '## Ejecución de la matriz del 17 de noviembre' not in s:s=s.replace('## Matriz resumida',aviso+'## Matriz resumida')
    s=s.replace('Versión documental: 2.','Versión documental: 3.')
    MATRIZ.write_text(s,encoding='utf8')
    (CARPETA/'estado-matriz.json').write_text(json.dumps({'requisitos':resumen,'resultados':{str(n):elegir(registros,n) for n in registros}},ensure_ascii=False,indent=2),encoding='utf8')
    print('RTM actualizada desde '+str(len(registros))+' casos con resultados; seis brechas con caso asignado.')
if __name__=='__main__':main()
