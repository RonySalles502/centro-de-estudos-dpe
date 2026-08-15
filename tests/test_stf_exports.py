from __future__ import annotations

import io
import unittest
import zipfile
from xml.sax.saxutils import escape

from server.stf_exports import (
    DATASET_COLUMNS,
    dataset_record_count,
    informativo_url_overrides,
    parse_stf_acordaos_csv,
    parse_stf_informativos_xlsx,
)


HEADERS = [
    "Informativo",
    "Classe Processo",
    "Número Processo",
    "Incidente Julgamento",
    "UF",
    "Observação",
    "Data Julgamento",
    "Relator",
    "Redator Acórdão",
    "Órgão Julgador",
    "Tipo Julgamento",
    "Situação Julgamento",
    "Título",
    "Tese Julgado",
    "Resumo",
    "Notícia",
    "Ramo Direito",
    "Matéria",
    "Repercussão Geral",
    "Tema RG",
    "Legislação",
    "ODS ONU 2030",
    "Covid-19",
    "Notícia completa",
]


def column_name(index: int) -> str:
    result = ""
    value = index + 1
    while value:
        value, remainder = divmod(value - 1, 26)
        result = chr(65 + remainder) + result
    return result


def xlsx_fixture(rows: list[list[str]]) -> bytes:
    strings = [str(value) for row in rows for value in row]
    shared = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + "".join(f"<si><t>{escape(value)}</t></si>" for value in strings)
        + "</sst>"
    )
    position = 0
    xml_rows = []
    for row_number, row in enumerate(rows, start=1):
        cells = []
        for column, _value in enumerate(row):
            cells.append(
                f'<c r="{column_name(column)}{row_number}" t="s"><v>{position}</v></c>'
            )
            position += 1
        xml_rows.append(f'<row r="{row_number}">{"".join(cells)}</row>')
    sheet = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<sheetData>{"".join(xml_rows)}</sheetData></worksheet>'
    )
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("xl/sharedStrings.xml", shared)
        archive.writestr("xl/worksheets/sheet1.xml", sheet)
    return output.getvalue()


class StfExportsTestCase(unittest.TestCase):
    def test_informativos_xlsx_is_compacted_and_deduplicated(self) -> None:
        data = [
            "1223",
            "ADI",
            "5775",
            "",
            "GO",
            "Julgamento conjunto",
            "2026-06-26",
            "MIN. NUNES MARQUES",
            "",
            "Plenário",
            "Virtual",
            "Concluído",
            "Progressão de praças ao oficialato",
            "É constitucional a progressão funcional nos limites legais.",
            "Resumo alternativo",
            "Notícia extensa",
            "Direito Constitucional",
            "Organização do Estado; Polícia Militar",
            "Não",
            "",
            "CF/1988: arts. 22 e 37.",
            "16 Paz, Justiça e Instituições Eficazes",
            "Não",
            "Notícia completa",
        ]
        payload = xlsx_fixture([HEADERS, data, data])
        natural_key = "1223|adi|5775|"
        dataset = parse_stf_informativos_xlsx(
            payload,
            url_overrides={natural_key: "https://jurisprudencia.stf.jus.br/pages/search/item"},
        )
        self.assertEqual(len(dataset["rows"]), 1)
        record = dict(zip(DATASET_COLUMNS, dataset["rows"][0]))
        self.assertEqual(record["informativo"], "1223")
        self.assertEqual(record["processo"], "ADI 5775/GO")
        self.assertEqual(record["g"], "I")
        self.assertEqual(record["published_at"], "2026-06-26T00:00:00+00:00")
        self.assertEqual(record["url"], "https://jurisprudencia.stf.jus.br/pages/search/item")
        self.assertEqual(record["tese"], "É constitucional a progressão funcional nos limites legais.")

    def test_informativos_csv_builds_only_valid_url_overrides(self) -> None:
        payload = (
            "Informativo;Processo;Título URL;Classe;Número;Incidente processo\n"
            "1223;ADI 5775;https://jurisprudencia.stf.jus.br/pages/search/item;ADI;5775;\n"
            "Termos da busca: INFORMATIVO;;;;;\n"
        ).encode("utf-8")
        overrides = informativo_url_overrides(payload)
        self.assertEqual(overrides, {"1223|adi|5775|": "https://jurisprudencia.stf.jus.br/pages/search/item"})

    def test_acordaos_csv_rejects_footer_and_preserves_decision(self) -> None:
        payload = (
            "Classe;Número;Incidente;Título;Título URL;Relator(a);Redator(a) acórdão;Órgão julgador;"
            "Data de julgamento;Data de publicação;Ementa;Decisão;Tema;Tese;Repercussão geral;"
            "Acompanhamento processual;Mesmo sentido\n"
            "HC;272522;AgR;HC 272522 AgR;https://jurisprudencia.stf.jus.br/pages/search/sjur1/false;"
            "CRISTIANO ZANIN;;Primeira Turma;06/08/2026;12/08/2026;Ementa penal;Negado provimento;;;"
            ";https://portal.stf.jus.br/processos/;\n"
            ";;;;;;;;Termos da busca: INFORMATIVO;;;;;;;;\n"
        ).encode("utf-8")
        dataset = parse_stf_acordaos_csv(payload)
        self.assertEqual(dataset_record_count({"acordaos": dataset}), 1)
        record = dict(zip(DATASET_COLUMNS, dataset["rows"][0]))
        self.assertEqual(record["ref"], "HC 272522 AgR")
        self.assertEqual(record["record_type"], "Acórdão STF")
        self.assertEqual(record["decisao"], "Negado provimento")
        self.assertEqual(record["g"], "II")


if __name__ == "__main__":
    unittest.main()
