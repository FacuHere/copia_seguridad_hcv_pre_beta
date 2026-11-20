"""Controles de destino y aprobación del Smoke Test; no prueban HCV."""
import copy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ejecutar_smoke import BloqueoSmoke, PLAN, contexto_estable, resumir_estado, validar_entorno


class PruebasSmoke(unittest.TestCase):
    def setUp(self):
        self.entorno = {
            servicio: dict(imagen="sha256:imagen", id=servicio, inicio="fecha",
                           estado="running", salud="healthy", proyecto="hcv_docker_beta_test",
                           servicio=servicio, puertos={})
            for servicio in ("api", "db")
        }
        self.entorno["api"]["puertos"] = {"3000/tcp": [{"HostIp": "127.0.0.1", "HostPort": "3002"}]}
        self.pasos = [dict(id=i, estado="aprobado") for i, _ in PLAN]

    def test_acepta_destino_beta_local(self):
        validar_entorno(self.entorno)

    def test_rechaza_proyecto_distinto(self):
        self.entorno["db"]["proyecto"] = "otra_instalacion"
        with self.assertRaises(BloqueoSmoke):
            validar_entorno(self.entorno)

    def test_rechaza_api_publicada_fuera_de_loopback(self):
        self.entorno["api"]["puertos"]["3000/tcp"][0]["HostIp"] = "0.0.0.0"
        with self.assertRaises(BloqueoSmoke):
            validar_entorno(self.entorno)

    def test_detecta_reinicio_aunque_la_imagen_sea_igual(self):
        final = copy.deepcopy(self.entorno)
        final["db"]["inicio"] = "otra_fecha"
        self.assertFalse(contexto_estable(self.entorno, final))

    def test_no_aprueba_con_pasos_faltantes_o_no_ejecutados(self):
        self.assertEqual(resumir_estado(self.pasos[:-1], True), "bloqueado")
        self.pasos[4]["estado"] = "no_ejecutado"
        self.assertEqual(resumir_estado(self.pasos, True), "bloqueado")

    def test_no_convierte_un_fallo_en_aprobacion(self):
        self.pasos[5]["estado"] = "fallido"
        self.assertEqual(resumir_estado(self.pasos, True), "fallido")

    def test_contexto_cambiado_bloquea_aunque_todo_pase(self):
        self.assertEqual(resumir_estado(self.pasos, False), "bloqueado")
        self.assertEqual(resumir_estado(self.pasos, True), "aprobado")


if __name__ == "__main__":
    unittest.main()
