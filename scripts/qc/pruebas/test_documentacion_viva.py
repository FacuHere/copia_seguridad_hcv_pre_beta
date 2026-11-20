"""Verifica evidencia, privacidad y contexto de las herramientas de QC, sin HCV."""
import hashlib
import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import generar_documentacion_viva as generador
import ejecutar_behave as ejecutor


def reporte(estado="passed", texto="comprobación"):
    return [{
        "tags": ["RN-001"], "elements": [{
            "type": "scenario", "name": "Título arbitrario no publicable",
            "status": estado, "tags": ["RF-1.1", "HU-01", "TC-015"],
            "steps": [{"name": texto, "result": {
                "status": estado, "duration": 0.5,
                "error_message": "secreto_sintetico DNI 12345678 Paciente de prueba"
            }}],
        }]
    }]


class PruebasDocumentacionViva(unittest.TestCase):
    def setUp(self):
        self.temporal = tempfile.TemporaryDirectory(prefix="hcv-qc-herramientas-")
        self.addCleanup(self.temporal.cleanup)
        self.raiz = Path(self.temporal.name)
        (self.raiz / "reports/qc").mkdir(parents=True)
        (self.raiz / "docs/qc").mkdir(parents=True)
        (self.raiz / "features").mkdir()
        self.registro = {"casos": {"TC-015": {
            "titulo": "Ingreso después de errores",
            "pasos": {"comprobación": "Resultado observado"}
        }}, "ejecuciones": []}
        self.guardar_registro()

    def guardar_registro(self):
        (self.raiz / "docs/qc/registro-ejecuciones-behave.json").write_text(
            json.dumps(self.registro), encoding="utf-8"
        )

    def guardar_reporte(self, nombre="TC-015-20261116-120000.json", datos=None):
        ruta = self.raiz / "reports/qc" / nombre
        ruta.write_text(json.dumps(reporte() if datos is None else datos), encoding="utf-8")
        return ruta

    def test_resumen_no_publica_trazas_nombres_ni_valores_arbitrarios(self):
        self.guardar_reporte(datos=reporte("failed", "Paciente privado y contraseña secreta"))
        generador.generar(self.raiz)
        texto = (self.raiz / "reports/qc/documentacion-viva/index.html").read_text(encoding="utf-8")
        resumen = (self.raiz / "reports/qc/documentacion-viva/resumen.json").read_text(encoding="utf-8")
        for salida in (texto, resumen):
            for sensible in ("secreto_sintetico", "12345678", "Paciente privado", "contraseña secreta", "Título arbitrario"):
                self.assertNotIn(sensible, salida)
        self.assertIn("Paso 1", texto)
        self.assertIn("Fallido", texto)

    def test_conserva_fallo_y_aprobacion_sin_contarlos_como_dos_casos(self):
        self.guardar_reporte(datos=reporte("failed"))
        self.guardar_reporte("TC-015-20261116-130000.json")
        resumen = generador.generar(self.raiz)
        self.assertEqual(resumen["totales"], {
            "ejecuciones": 2, "casos_distintos": 1, "aprobadas": 1, "con_hallazgos": 1
        })

    def test_generar_vista_preserva_bytes_del_original(self):
        ruta = self.guardar_reporte()
        anterior = ruta.read_bytes()
        generador.generar(self.raiz)
        self.assertEqual(ruta.read_bytes(), anterior)

    def test_detecta_modificacion_de_evidencia_con_huella_registrada(self):
        ruta = self.guardar_reporte()
        self.registro["ejecuciones"].append({
            "archivo": ruta.name,
            "sha256_reporte": hashlib.sha256(ruta.read_bytes()).hexdigest()
        })
        self.guardar_registro()
        ruta.write_text(json.dumps(reporte("failed")), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "huella"):
            generador.generar(self.raiz)

    def test_escapa_html_de_las_notas_revisadas(self):
        ruta = self.guardar_reporte()
        self.registro["ejecuciones"].append({
            "archivo": ruta.name, "nota_revision": "<script>alert(1)</script>"
        })
        self.guardar_registro()
        generador.generar(self.raiz)
        texto = (self.raiz / "reports/qc/documentacion-viva/index.html").read_text(encoding="utf-8")
        self.assertNotIn("<script>", texto)
        self.assertIn("&lt;script&gt;", texto)

    def test_rechaza_un_escenario_con_dos_tc_para_no_inflar_trazabilidad(self):
        datos = reporte()
        datos[0]["elements"][0]["tags"].append("TC-014")
        self.guardar_reporte(datos=datos)
        with self.assertRaisesRegex(ValueError, "único TC"):
            generador.generar(self.raiz)

    def test_reporte_vacio_o_corrupto_no_se_convierte_en_aprobacion(self):
        ruta = self.guardar_reporte(datos=[])
        with self.assertRaisesRegex(ValueError, "no contiene escenarios"):
            generador.generar(self.raiz)
        ruta.write_text("contenido inválido secreto_sintetico", encoding="utf-8")
        with self.assertRaises(ValueError) as error:
            generador.generar(self.raiz)
        self.assertNotIn("secreto_sintetico", str(error.exception))

    def test_nuevos_nombres_de_ejecucion_admiten_varios_casos_en_archivos_distintos(self):
        self.guardar_reporte("QC-20261116-140000-123456.json")
        resumen = generador.generar(self.raiz)
        self.assertEqual(resumen["totales"]["ejecuciones"], 1)
        self.assertEqual(resumen["ejecuciones"][0]["escenarios"][0]["caso"], "TC-015")

    def test_no_acepta_duracion_no_finita(self):
        datos = reporte()
        datos[0]["elements"][0]["steps"][0]["result"]["duration"] = float("nan")
        self.guardar_reporte(datos=datos)
        with self.assertRaisesRegex(ValueError, "Duración inválida"):
            generador.generar(self.raiz)

    def simular_behave(self, comando, **argumentos):
        ruta = Path(comando[-1])
        ruta.write_text(json.dumps(reporte()), encoding="utf-8")
        return SimpleNamespace(returncode=0)

    def test_ejecutor_conserva_version_y_regenera_vista(self):
        imagen = "sha256:" + "a" * 64
        with patch.object(ejecutor, "RAIZ", self.raiz), \
             patch.object(ejecutor, "consultar_imagen", return_value=imagen), \
             patch.object(ejecutor, "hora_cliente", return_value=datetime(2026, 11, 16, tzinfo=timezone.utc)), \
             patch.object(ejecutor.subprocess, "run", side_effect=self.simular_behave):
            self.assertEqual(ejecutor.ejecutar("@TC-015"), 0)
        registro = json.loads((self.raiz / "docs/qc/registro-ejecuciones-behave.json").read_text(encoding="utf-8"))
        self.assertTrue(registro["ejecuciones"][0]["version_estable"])
        self.assertEqual(registro["ejecuciones"][0]["imagen"], imagen)
        self.assertTrue((self.raiz / "reports/qc/documentacion-viva/index.html").is_file())

    def test_cambio_de_imagen_impide_dar_por_valida_la_ejecucion(self):
        with patch.object(ejecutor, "RAIZ", self.raiz), \
             patch.object(ejecutor, "consultar_imagen", side_effect=["sha256:" + "a"*64, "sha256:" + "b"*64]), \
             patch.object(ejecutor.subprocess, "run", side_effect=self.simular_behave):
            self.assertEqual(ejecutor.ejecutar("@TC-015"), 2)
        registro = json.loads((self.raiz / "docs/qc/registro-ejecuciones-behave.json").read_text(encoding="utf-8"))
        self.assertFalse(registro["ejecuciones"][0]["version_estable"])
        resumen = generador.generar(self.raiz)
        self.assertEqual(resumen["totales"]["aprobadas"], 0)
        self.assertEqual(resumen["totales"]["con_hallazgos"], 1)

    def test_falta_de_reporte_no_produce_falso_aprobado(self):
        with patch.object(ejecutor, "RAIZ", self.raiz), \
             patch.object(ejecutor, "consultar_imagen", return_value="sha256:"+"a"*64), \
             patch.object(ejecutor.subprocess, "run", return_value=SimpleNamespace(returncode=0)):
            with self.assertRaisesRegex(ValueError, "No se pudo leer"):
                ejecutor.ejecutar("@TC-015")


if __name__ == "__main__":
    unittest.main()
