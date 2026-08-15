from __future__ import annotations

import hashlib
import html
import re
import threading
import time
import urllib.error
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from typing import Any

from .database import Database


USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 CentroEstudosDPERN/0.4"
)


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self._ignored_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() in {"script", "style", "svg", "noscript"}:
            self._ignored_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in {"script", "style", "svg", "noscript"} and self._ignored_depth:
            self._ignored_depth -= 1

    def handle_data(self, data: str) -> None:
        if not self._ignored_depth:
            self.parts.append(data)

    def text(self) -> str:
        return re.sub(r"\s+", " ", " ".join(self.parts)).strip()


def html_to_text(value: str | None) -> str:
    if not value:
        return ""
    parser = _TextExtractor()
    parser.feed(html.unescape(value))
    return parser.text()


def _decode_html(payload: bytes) -> str:
    for encoding in ("utf-8", "latin-1"):
        try:
            return payload.decode(encoding)
        except UnicodeDecodeError:
            continue
    return payload.decode("utf-8", errors="replace")


def _meta_description(decoded: str) -> str:
    patterns = [
        r"<meta[^>]+(?:name|property)=[\"'](?:description|og:description)[\"'][^>]+content=[\"']([^\"']+)",
        r"<meta[^>]+content=[\"']([^\"']+)[\"'][^>]+(?:name|property)=[\"'](?:description|og:description)[\"']",
    ]
    for pattern in patterns:
        match = re.search(pattern, decoded, flags=re.I | re.S)
        if match:
            return html_to_text(match.group(1))
    return ""


def _clean_summary(value: str) -> str:
    value = re.sub(r"\s+", " ", value).strip(" .|-")
    boilerplate = (
        "Compartilhe:",
        "Avalie nosso serviço",
        "Limpar seleção",
        "Saiba mais:",
    )
    for marker in boilerplate:
        value = value.split(marker, 1)[0].strip()
    return value[:12000]


def _is_generic_summary(value: str) -> bool:
    normalized = _clean_summary(value).lower()
    return len(normalized) < 80 or normalized.startswith(
        ("informativo de jurisprudência n", "informativo de jurisprudencia n", "informativo stf n")
    )


def parse_official_detail(payload: bytes, court: str) -> str:
    """Extrai tema/destaque do HTML oficial sem fabricar síntese por IA."""
    decoded = _decode_html(payload)
    text = html_to_text(decoded)
    if court.upper() == "STJ":
        theme_match = re.search(
            r"\bTema\s+(.*?)(?=\s+Destaque\b|\s+Informações do Inteiro Teor\b|\s+Processo\b|$)",
            text,
            flags=re.I | re.S,
        )
        highlight_match = re.search(
            r"\bDestaque\s+(.*?)(?=\s+Informações do Inteiro Teor\b|\s+Informações Adicionais\b|\s+Processo\b|$)",
            text,
            flags=re.I | re.S,
        )
        parts = []
        if theme_match:
            parts.append(_clean_summary(theme_match.group(1)))
        if highlight_match:
            highlight = _clean_summary(highlight_match.group(1))
            if highlight and highlight not in parts:
                parts.append(highlight)
        combined = _clean_summary(" — ".join(part for part in parts if len(part) >= 15))
        if len(combined) >= 40:
            return combined
    meta = _clean_summary(_meta_description(decoded))
    if len(meta) >= 40 and "informativo" not in meta.lower()[:30]:
        return meta
    issue = extract_issue_number(text[:5000])
    if issue:
        marker = re.search(rf"Informativo(?:\s+STF)?\s*(?:n[º°.]?\s*)?{re.escape(issue)}", text, re.I)
        if marker:
            candidate = _clean_summary(text[marker.end() : marker.end() + 12000])
            if len(candidate) >= 40:
                return candidate
    return _clean_summary(text[:12000])


def content_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def _child_text(element: ET.Element, names: set[str]) -> str:
    for child in list(element):
        if _local_name(child.tag) in names:
            return "".join(child.itertext()).strip()
    return ""


def _entry_link(element: ET.Element) -> str:
    for child in list(element):
        if _local_name(child.tag) != "link":
            continue
        href = child.attrib.get("href")
        relation = child.attrib.get("rel", "alternate")
        if href and relation in {"alternate", ""}:
            return href.strip()
        if child.text:
            return child.text.strip()
    return ""


def _normalise_date(value: str) -> str | None:
    if not value:
        return None
    value = value.strip()
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        try:
            parsed = parsedate_to_datetime(value)
        except (TypeError, ValueError):
            return value[:80]
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).replace(microsecond=0).isoformat()


def extract_issue_number(text: str) -> str | None:
    patterns = [
        r"Informativo(?:\s+de\s+Jurisprudência)?\s*(?:n[º°.]?\s*)?(\d{3,4})",
        r"Última\s+edição\s*:\s*(\d{3,4})(?:/\d{4})?",
        r"(?:N[º°.]?|número)\s*(\d{3,4})",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.I)
        if match:
            return match.group(1)
    return None


def extract_portuguese_date(text: str) -> str | None:
    months = {
        "janeiro": 1,
        "fevereiro": 2,
        "março": 3,
        "marco": 3,
        "abril": 4,
        "maio": 5,
        "junho": 6,
        "julho": 7,
        "agosto": 8,
        "setembro": 9,
        "outubro": 10,
        "novembro": 11,
        "dezembro": 12,
    }
    match = re.search(
        r"\b(\d{1,2})\s+de\s+([a-zç]+)\s+de\s+(\d{4})\b",
        text,
        flags=re.I,
    )
    if not match:
        return None
    month = months.get(match.group(2).lower())
    if not month:
        return None
    try:
        parsed = datetime(int(match.group(3)), month, int(match.group(1)), tzinfo=timezone.utc)
    except ValueError:
        return None
    return parsed.replace(microsecond=0).isoformat()


def parse_stj_feed(payload: bytes, base_url: str = "https://processo.stj.jus.br") -> list[dict[str, Any]]:
    root = ET.fromstring(payload)
    entries = [node for node in root.iter() if _local_name(node.tag) in {"entry", "item"}]
    parsed: list[dict[str, Any]] = []
    for entry in entries:
        title = html_to_text(_child_text(entry, {"title"}))
        summary = html_to_text(_child_text(entry, {"summary", "description", "content"}))
        link = urllib.parse.urljoin(base_url, _entry_link(entry))
        identifier = _child_text(entry, {"id", "guid"}) or link
        published = _child_text(entry, {"published", "pubdate", "updated"})
        if not title:
            continue
        if not identifier:
            identifier = content_hash(f"{title}|{published}")
        issue_number = extract_issue_number(f"{title} {summary}")
        if len(summary) < 40 and len(title) >= 80:
            summary = title
        fingerprint = content_hash(f"{title}|{summary}|{link}|{published}")
        parsed.append(
            {
                "external_id": identifier[:500],
                "issue_number": issue_number,
                "title": title[:1000],
                "published_at": _normalise_date(published),
                "source_url": link or "https://scon.stj.jus.br/jurisprudencia/externo/informativo/",
                "summary": summary[:12000],
                "content_hash": fingerprint,
            }
        )
    return parsed


def parse_stf_latest(payload: bytes, source_url: str) -> list[dict[str, Any]]:
    decoded = _decode_html(payload)
    text = html_to_text(decoded)
    number = extract_issue_number(text[:5000])
    if not number:
        raise ValueError("O número do Informativo STF não foi identificado na página oficial.")
    historical_url = (
        "https://www.stf.jus.br/arquivo/informativo/documento/"
        f"informativo{number}.htm"
    )
    title = f"Informativo STF nº {number}"
    presentation = re.search(
        r"\bApresentação\s+(.*?)(?=\s+Responsável:|\s+Expediente\b|$)",
        text,
        flags=re.I | re.S,
    )
    excerpt = _clean_summary(presentation.group(1)) if presentation else title
    updated = re.search(r"Última\s+atualização\s*:\s*(\d{4}-\d{2}-\d{2})", text, flags=re.I)
    return [
        {
            "external_id": f"stf-informativo-{number}",
            "issue_number": number,
            "title": title,
            "published_at": (
                _normalise_date(updated.group(1))
                if updated
                else extract_portuguese_date(text[:5000])
            ),
            "source_url": historical_url or source_url,
            "summary": excerpt,
            "content_hash": content_hash(excerpt),
        }
    ]


class JurisprudenceUpdater:
    def __init__(self, database: Database, timeout: int = 25):
        self.database = database
        self.timeout = timeout
        self._run_lock = threading.Lock()

    def update_all(self) -> dict[str, Any]:
        if not self._run_lock.acquire(blocking=False):
            return {"status": "EM_EXECUCAO", "sources": []}
        results: list[dict[str, Any]] = []
        try:
            for source in self.database.list_sources():
                if not source["enabled"]:
                    continue
                results.append(self._update_source(source))
        finally:
            self._run_lock.release()
        failed = [item for item in results if item["status"] == "ERRO"]
        return {
            "status": "PARCIAL" if failed and len(failed) < len(results) else ("ERRO" if failed else "SUCESSO"),
            "sources": results,
        }

    def _request(
        self, source: dict[str, Any], force: bool = False
    ) -> tuple[bytes | None, dict[str, str], bool]:
        headers = {
            "User-Agent": USER_AGENT,
            "Accept": "application/atom+xml, application/xml, text/html;q=0.9, */*;q=0.5",
            "Accept-Language": "pt-BR,pt;q=0.9",
            "Referer": "https://www.stj.jus.br/",
        }
        if source.get("etag") and not force:
            headers["If-None-Match"] = source["etag"]
        if source.get("last_modified") and not force:
            headers["If-Modified-Since"] = source["last_modified"]
        request = urllib.request.Request(source["url"], headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                body = response.read(5_000_000)
                response_headers = {
                    "etag": response.headers.get("ETag", ""),
                    "last_modified": response.headers.get("Last-Modified", ""),
                }
                return body, response_headers, False
        except urllib.error.HTTPError as error:
            if error.code == 304:
                return None, {}, True
            raise

    def _request_detail(self, url: str, court: str) -> bytes:
        parsed = urllib.parse.urlparse(url)
        allowed_suffix = "stj.jus.br" if court == "STJ" else "stf.jus.br"
        if parsed.scheme not in {"http", "https"} or not (
            parsed.hostname and (parsed.hostname == allowed_suffix or parsed.hostname.endswith(f".{allowed_suffix}"))
        ):
            raise ValueError("A síntese só pode ser buscada em domínio oficial do tribunal.")
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
                "Accept-Language": "pt-BR,pt;q=0.9",
                "Referer": f"https://www.{allowed_suffix}/",
            },
        )
        with urllib.request.urlopen(request, timeout=self.timeout) as response:
            return response.read(5_000_000)

    def _enrich_summaries(
        self,
        items: list[dict[str, Any]],
        court: str,
        existing_summaries: dict[str, str] | None = None,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        existing_summaries = existing_summaries or {}
        attempts = 0
        for item in items:
            summary = _clean_summary(str(item.get("summary", "")))
            generic = _is_generic_summary(summary)
            saved = _clean_summary(existing_summaries.get(str(item.get("external_id", "")), ""))
            saved_is_specific = not _is_generic_summary(saved)
            if generic and saved_is_specific:
                summary = saved
                generic = False
            if generic and attempts < limit and item.get("source_url"):
                attempts += 1
                try:
                    detail = self._request_detail(item["source_url"], court)
                    extracted = parse_official_detail(detail, court)
                    if len(extracted) >= 40:
                        summary = extracted
                except Exception:
                    # A falha do detalhe não elimina o item do feed. O título é
                    # mantido como fallback verificável e a fonte continua acessível.
                    pass
            if not summary:
                summary = item["title"]
            item["summary"] = summary[:12000]
            item["content_hash"] = content_hash(
                f"{item['title']}|{item['summary']}|{item['source_url']}|{item.get('published_at', '')}"
            )
        return items

    def _update_source(self, source: dict[str, Any]) -> dict[str, Any]:
        run_id = self.database.start_update_run(source["id"])
        try:
            missing_summaries = self.database.count_missing_jurisprudence_summaries(source["id"])
            payload, headers, unchanged = self._request(source, force=missing_summaries > 0)
            if unchanged:
                self.database.finish_update_run(
                    run_id, source["id"], "SEM_ALTERACAO", 0, 0, "Fonte sem alterações."
                )
                return {"source": source["id"], "status": "SEM_ALTERACAO", "imported": 0}
            if payload is None:
                raise ValueError("A fonte não retornou conteúdo.")
            if source["source_kind"] == "ATOM":
                items = parse_stj_feed(payload, source["url"])
            elif source["source_kind"] == "HTML_LATEST":
                items = parse_stf_latest(payload, source["url"])
            else:
                raise ValueError(f"Tipo de fonte ainda não suportado: {source['source_kind']}")
            if not items:
                raise ValueError("Nenhuma publicação foi identificada na resposta oficial.")
            existing_summaries = self.database.jurisprudence_summaries(source["id"])
            items = self._enrich_summaries(
                items,
                source["court"],
                existing_summaries,
            )
            summaries_updated = sum(
                1
                for item in items
                if not _is_generic_summary(str(item.get("summary", "")))
                and _clean_summary(existing_summaries.get(str(item.get("external_id", "")), ""))
                != _clean_summary(str(item.get("summary", "")))
            )
            imported = sum(
                1 for item in items if self.database.upsert_jurisprudence_item(source["id"], item)
            )
            self.database.finish_update_run(
                run_id,
                source["id"],
                "SUCESSO",
                len(items),
                imported,
                f"{len(items)} publicação(ões) detectada(s); {imported} nova(s).",
                headers.get("etag") or None,
                headers.get("last_modified") or None,
            )
            return {
                "source": source["id"],
                "status": "SUCESSO",
                "detected": len(items),
                "imported": imported,
                "summaries_updated": summaries_updated,
            }
        except Exception as error:  # a falha de uma fonte não bloqueia as demais
            message = f"{type(error).__name__}: {error}"
            self.database.finish_update_run(run_id, source["id"], "ERRO", 0, 0, message)
            return {"source": source["id"], "status": "ERRO", "message": message}


class UpdateScheduler(threading.Thread):
    def __init__(self, updater: JurisprudenceUpdater):
        super().__init__(name="jurisprudence-updater", daemon=True)
        self.updater = updater
        self._stop_event = threading.Event()

    def stop(self) -> None:
        self._stop_event.set()

    def run(self) -> None:
        # Pequeno atraso evita bloquear a abertura da interface.
        if self._stop_event.wait(4):
            return
        last_run: float | None = None
        while not self._stop_event.is_set():
            try:
                settings = self.updater.database.get_settings()
                enabled = str(
                    settings.get("jurisprudence_auto_update", "true")
                ).lower() == "true"
                interval = max(
                    900,
                    int(float(settings.get("jurisprudence_update_interval_hours", "12")) * 3600),
                )
                now = time.monotonic()
                if enabled and (last_run is None or now - last_run >= interval):
                    self.updater.update_all()
                    last_run = time.monotonic()
            except Exception as error:
                print(
                    "[jurisprudencia] Falha no agendador: "
                    f"{type(error).__name__}: {error}"
                )
            # Reavalia rapidamente as preferências, mas respeita o intervalo da coleta.
            self._stop_event.wait(60)
