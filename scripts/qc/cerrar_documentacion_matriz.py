"""Sincroniza catálogos documentales con los resultados ya guardados."""
from pathlib import Path
import json,re,hashlib
RAIZ=Path(__file__).resolve().parents[2]
cierre=json.loads((RAIZ/'reports/qc/matriz-ejecucion-20261117/CIERRE-MATRIZ-20261117.json').read_text(encoding='utf8'));resultados={r['caso']:r for r in cierre['resultados']}
p=RAIZ/'docs/requisitos-hcv.md';texto=p.read_text(encoding='utf8');actual=None;salida=[]
asignaciones={'RF-1.1':'TC-001–004, TC-006, TC-016, TC-020–021, TC-023','RF-1.2':'TC-003, TC-017, TC-022','RF-3.3':'TC-187','RF-4.1':'TC-188','RF-4.6':'TC-189','RF-5.1':'TC-190','RF-5.2':'TC-191','RF-7.1':'TC-186'}
for linea in texto.splitlines():
 m=re.match(r'### (RF-\d+\.\d+)',linea)
 if m:actual=m[1]
 if linea.startswith('**Casos vinculados:**'):
  if actual in asignaciones:linea='**Casos vinculados:** '+asignaciones[actual]+'. Resultado y evidencia en la [matriz](matriz-trazabilidad-hcv.md).'
  elif actual=='RF-2.3':linea='**Casos vinculados:** TC-005, TC-024–047, TC-055 y TC-192–193.'
  elif actual=='RF-5.3':linea='**Casos vinculados:** TC-114, TC-116–146 y TC-194–198.'
 salida.append(linea)
p.write_text('\n'.join(salida)+'\n',encoding='utf8')
p=RAIZ/'docs/matriz-trazabilidad-hcv.md';texto=p.read_text(encoding='utf8')
texto=texto.replace('Estado manual fuente','Estado previo a la campaña')
texto=texto.replace('los vecinos 4 y 99 todavía no tienen caso dedicado identificado.','los vecinos 4 y 99 tienen TC-194 y TC-195, ambos aprobados por API.')
texto=re.sub(r'(?m)^Se identificaron 30 puntos de frontera:.*$', 'Los 30 puntos de frontera tienen caso dedicado y ejecución API aprobada. TC-192–193 cubren nombres de uno y dos caracteres; TC-194–195 usuarios de cuatro y 99; TC-196–198 contraseñas de 1023, 1024 y 1025. Los reportes distinguen la API de los recorridos de interfaz. Behave conserva el piloto TC-006; los nuevos casos utilizan scripts Python y Playwright.',texto)
texto=re.sub(r'(?m)^El \[registro U5\].*$', 'El [registro U5](qc-unidad-5-ejecucion-defectos.md) conserva las fuentes históricas. El cierre del 17/11/2026 está en [CIERRE-MATRIZ-20261117](../reports/qc/matriz-ejecucion-20261117/CIERRE-MATRIZ-20261117.md): 181 casos aprobados, siete bloqueados y un criterio retirado. El smoke final aprobó sus diez controles. El catálogo de hallazgos se conserva separado para preparar otro documento.',texto)
texto=re.sub(r'(?m)^El informe y esta matriz comparten.*$', 'El informe, el plan de casos y esta matriz comparten los 189 casos y el identificador TC-006 para el piloto. Los archivos históricos del escenario y sus reportes conservan TC-015; la equivalencia permite verificar sus nombres y huellas. Los demás identificadores permanecen estables.',texto)
p.write_text(texto,encoding='utf8')
p=RAIZ/'docs/qc/diseno-ep-bva-hcv.json';datos=json.loads(p.read_text(encoding='utf8'))
respaldo=RAIZ/'reports/qc/matriz-ejecucion-20261117/diseno-ep-bva-antes.json'
if not respaldo.exists():respaldo.write_text(json.dumps(datos,ensure_ascii=False,indent=2),encoding='utf8')
datos.update(version=2,fecha='2026-11-17',estado='30 puntos ejecutados y aprobados por API en Docker beta')
datos['resumen'].update(puntos_con_tc_origen=30,puntos_sin_tc_dedicado=0,ejecuciones_nuevas=30)
datos['convenciones']['tc_origen']='Referencia al caso vigente del plan; las siete fronteras inicialmente sin caso tienen TC-192 a TC-198.'
datos['convenciones']['canales']='Ejecución API aprobada según el cierre de la campaña; los recorridos de interfaz se identifican por separado.'
mapeo={('fullName',1):192,('fullName',2):193,('username',4):194,('username',99):195,('password',1023):196,('password',1024):197,('password',1025):198}
cuenta=0
for campo in datos['campos']:
 for frontera in campo['fronteras']:
  for punto in frontera['puntos']:
   if punto['tc_origen'] is None:punto['tc_origen']='TC-'+str(mapeo[(campo['campo'],punto['longitud'])])
   r=resultados[punto['tc_origen']];assert r['estado']=='aprobado'
   punto.update(estado_diseno='Caso dedicado identificado',estado_ejecucion='aprobado por API el 17/11/2026',reporte=r['reporte'],sha256_reporte=r['sha256_reporte'],nota_trazabilidad='La ejecución corresponde al objetivo API de la ficha actualizada; los pasos de interfaz se distinguen en sus registros.');cuenta+=1
assert cuenta==30
datos['puntos_sin_tc_dedicado']=[]
datos['faltantes']=[]
for ejemplo in datos['ejemplos_baoe']:
 ejemplo['canal_diseno']=ejemplo['canal'];ejemplo['canal_ejecutado']='API';ejemplo['estado_ejecucion']='aprobado por API el 17/11/2026'
for fuente in datos['fuentes']:
 ruta=RAIZ/fuente['ruta']
 if ruta.exists() and not Path(fuente['ruta']).is_absolute():fuente['sha256']=hashlib.sha256(ruta.read_bytes()).hexdigest()
p.write_text(json.dumps(datos,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print('Catálogo RF, RTM y 30 puntos BVA sincronizados con sus reportes.')
