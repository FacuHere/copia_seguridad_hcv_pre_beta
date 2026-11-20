"""Resguardo privado previo a pruebas autorizadas sobre Docker beta."""
from pathlib import Path
from datetime import datetime
import subprocess,json,hashlib

raiz=Path('storage/qc')/datetime.now().strftime('resguardo-%Y%m%d-%H%M%S')
raiz.mkdir(parents=True,exist_ok=False)
def guardar(nombre,orden):
    r=subprocess.run(orden,capture_output=True,timeout=120)
    if r.returncode:raise RuntimeError('No se pudo completar el resguardo: '+nombre)
    ruta=raiz/nombre;ruta.write_bytes(r.stdout)
    return {'archivo':str(ruta),'bytes':len(r.stdout),'sha256':hashlib.sha256(r.stdout).hexdigest()}
datos=[]
datos.append(guardar('base.sql',['docker','exec','hcv_docker_beta_test-db-1','sh','-c','exec mariadb-dump -uroot -p"$MARIADB_ROOT_PASSWORD" --single-transaction --routines --triggers --databases hcv_docker_beta_test']))
datos.append(guardar('archivos.tar',['docker','exec','hcv_docker_beta_test-api-1','tar','-C','/var/lib/hcv-files','-cf','-','.']))
(raiz/'resguardo.json').write_text(json.dumps(datos,indent=2),encoding='utf8')
print('Resguardo privado completado en '+str(raiz)+'; base y archivos con SHA-256.')
