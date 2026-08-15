from __future__ import annotations

import argparse
import json
import mimetypes
import os
import signal
import sys
import threading
import urllib.parse
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from server import APP_VERSION
from server.backup import AutoBackupScheduler, BackupManager
from server.database import Database
from server.jurisprudence import JurisprudenceUpdater, UpdateScheduler
from server.questions import QuestionService
from server.study_planning import StudyPlanningService


PROJECT_ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
WEB_ROOT = PROJECT_ROOT / "web"


def default_data_dir() -> Path:
    if getattr(sys, "frozen", False) and os.name == "nt":
        local_app_data = os.environ.get("LOCALAPPDATA")
        base = Path(local_app_data) if local_app_data else Path.home() / "AppData" / "Local"
        return base / "CentroEstudosDPERN"
    return Path(__file__).resolve().parent / "runtime"


class LocalApplication:
    def __init__(self, data_dir: Path, disable_updates: bool = False):
        data_dir.mkdir(parents=True, exist_ok=True)
        self.database = Database(data_dir / "centro-dpern.sqlite3", PROJECT_ROOT)
        self.database.initialize()
        self.questions = QuestionService(self.database)
        self.questions.seed_catalog(PROJECT_ROOT / "data" / "question_catalog.json")
        self.planning = StudyPlanningService(self.database)
        self.backups = BackupManager(self.database)
        self.updater = JurisprudenceUpdater(self.database)
        self.schedulers = [] if disable_updates else [
            UpdateScheduler(self.updater),
            AutoBackupScheduler(self.backups),
        ]


class ApiHandler(BaseHTTPRequestHandler):
    server_version = f"CentroEstudosDPERN/{APP_VERSION}"

    @property
    def application(self) -> LocalApplication:
        return self.server.application  # type: ignore[attr-defined]

    def log_message(self, format: str, *args: Any) -> None:
        print(f"[local] {self.address_string()} - {format % args}")

    def _headers(self, status: int, content_type: str, length: int | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self'; "
            "connect-src 'self'; img-src 'self' data:; object-src 'none'; "
            "base-uri 'none'; frame-ancestors 'none'",
        )
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header("Cache-Control", "no-store" if self.path.startswith("/api/") else "no-cache")
        if length is not None:
            self.send_header("Content-Length", str(length))
        self.end_headers()

    def _json(self, payload: Any, status: int = HTTPStatus.OK) -> None:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self._headers(status, "application/json; charset=utf-8", len(encoded))
        self.wfile.write(encoded)

    def _error(self, status: int, message: str) -> None:
        self._json({"error": message}, status)

    def _body(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ValueError("Cabeçalho Content-Length inválido.") from error
        if length > 1_000_000:
            raise ValueError("Corpo da requisição excede o limite permitido.")
        raw = self.rfile.read(length)
        if not raw:
            return {}
        value = json.loads(raw.decode("utf-8"))
        if not isinstance(value, dict):
            raise ValueError("O corpo deve ser um objeto JSON.")
        return value

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        try:
            if parsed.path == "/api/health":
                self._json({"status": "ok", "version": APP_VERSION, "mode": "local-single-workspace"})
            elif parsed.path == "/api/dashboard":
                self._json(self.application.database.dashboard())
            elif parsed.path == "/api/settings":
                self._json(self.application.database.get_settings())
            elif parsed.path == "/api/disciplines":
                self._json({"items": self.application.database.list_disciplines()})
            elif parsed.path == "/api/program":
                self._json(
                    self.application.database.list_program(
                        discipline=_first(query, "discipline"),
                        study_status=_first(query, "status"),
                        query=_first(query, "q"),
                        limit=_int_query(query, "limit", 500),
                        offset=_int_query(query, "offset", 0),
                    )
                )
            elif parsed.path == "/api/questions/stats":
                self._json(self.application.questions.stats())
            elif parsed.path == "/api/question-sources":
                self._json({"items": self.application.questions.list_sources()})
            elif parsed.path == "/api/questions":
                self._json(
                    self.application.questions.list_questions(
                        discipline=_first(query, "discipline"),
                        editorial_status=_first(query, "status"),
                        study_ready_only=_first(query, "ready") == "1",
                        query=_first(query, "q"),
                        limit=_int_query(query, "limit", 100),
                        offset=_int_query(query, "offset", 0),
                    )
                )
            elif parsed.path == "/api/question-reports":
                self._json(
                    {
                        "items": self.application.questions.list_reports(
                            status=_first(query, "status"),
                            limit=_int_query(query, "limit", 100),
                        )
                    }
                )
            elif parsed.path == "/api/diagnostic":
                self._json(self.application.planning.get_diagnostic())
            elif parsed.path == "/api/planning":
                self._json(self.application.planning.get_plan())
            elif parsed.path == "/api/reviews":
                self._json(
                    self.application.planning.list_reviews(
                        due_only=_first(query, "scope") != "all",
                        limit=_int_query(query, "limit", 200),
                    )
                )
            elif parsed.path == "/api/discursive-prompts":
                self._json({"items": self.application.planning.list_discursive_prompts()})
            elif parsed.path == "/api/discursive-attempts":
                self._json(
                    {
                        "items": self.application.planning.list_discursive_attempts(
                            _int_query(query, "limit", 100)
                        )
                    }
                )
            elif parsed.path == "/api/quiz-sessions":
                self._json(
                    {
                        "items": self.application.questions.list_sessions(
                            _int_query(query, "limit", 30)
                        )
                    }
                )
            elif parsed.path.startswith("/api/quiz-sessions/"):
                session_id = urllib.parse.unquote(
                    parsed.path.removeprefix("/api/quiz-sessions/")
                )
                if not session_id or "/" in session_id:
                    raise ValueError("Identificador de sessão inválido.")
                self._json(self.application.questions.get_session(session_id))
            elif parsed.path == "/api/jurisprudence":
                self._json(
                    self.application.database.list_jurisprudence(
                        court=_first(query, "court"),
                        editorial_status=_first(query, "status"),
                        study_status=_first(query, "study"),
                        query=_first(query, "q"),
                        limit=_int_query(query, "limit", 100),
                    )
                )
            elif parsed.path == "/api/sources":
                self._json({"items": self.application.database.list_sources()})
            elif parsed.path == "/api/backups":
                self._json({"items": self.application.backups.list()})
            elif parsed.path.startswith("/api/"):
                self._error(HTTPStatus.NOT_FOUND, "Rota não localizada.")
            else:
                self._serve_static(parsed.path)
        except ValueError as error:
            self._error(HTTPStatus.BAD_REQUEST, str(error))
        except KeyError as error:
            self._error(HTTPStatus.NOT_FOUND, str(error))
        except FileNotFoundError as error:
            self._error(HTTPStatus.NOT_FOUND, str(error))
        except Exception as error:
            self._error(HTTPStatus.INTERNAL_SERVER_ERROR, f"Falha interna: {error}")

    def do_PATCH(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        try:
            if not self._same_origin():
                self._error(HTTPStatus.FORBIDDEN, "Origem da requisição não autorizada.")
                return
            payload = self._body()
            if parsed.path == "/api/settings":
                self._json(self.application.database.update_settings(payload))
            elif parsed.path == "/api/diagnostic":
                self._json(self.application.planning.save_diagnostic(payload))
            elif parsed.path.startswith("/api/planning/entries/"):
                entry_id = urllib.parse.unquote(
                    parsed.path.removeprefix("/api/planning/entries/")
                )
                if not entry_id or "/" in entry_id:
                    raise ValueError("Identificador de bloco inválido.")
                self._json(self.application.planning.update_plan_entry(entry_id, payload))
            elif parsed.path.startswith("/api/program/"):
                topic_id = urllib.parse.unquote(parsed.path.removeprefix("/api/program/"))
                self._json(self.application.database.update_topic_progress(topic_id, payload))
            elif parsed.path.startswith("/api/jurisprudence/"):
                item_id = urllib.parse.unquote(
                    parsed.path.removeprefix("/api/jurisprudence/")
                )
                if not item_id.isdigit():
                    raise ValueError("Identificador de informativo inválido.")
                self._json(
                    self.application.database.update_jurisprudence_progress(
                        int(item_id), payload
                    )
                )
            else:
                self._error(HTTPStatus.NOT_FOUND, "Rota não localizada.")
        except (ValueError, json.JSONDecodeError) as error:
            self._error(HTTPStatus.BAD_REQUEST, str(error))
        except KeyError as error:
            self._error(HTTPStatus.NOT_FOUND, str(error))
        except Exception as error:
            self._error(HTTPStatus.INTERNAL_SERVER_ERROR, f"Falha interna: {error}")

    def do_POST(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        try:
            if not self._same_origin():
                self._error(HTTPStatus.FORBIDDEN, "Origem da requisição não autorizada.")
                return
            if parsed.path == "/api/jurisprudence/update":
                self._json(self.application.updater.update_all())
            elif parsed.path == "/api/planning/generate":
                self._json(self.application.planning.generate_plan(self._body()), HTTPStatus.CREATED)
            elif parsed.path.startswith("/api/reviews/") and parsed.path.endswith("/rate"):
                topic_id = urllib.parse.unquote(
                    parsed.path.removeprefix("/api/reviews/").removesuffix("/rate")
                ).strip("/")
                if not topic_id or "/" in topic_id:
                    raise ValueError("Identificador de tópico inválido.")
                self._json(self.application.planning.rate_review(topic_id, self._body()))
            elif parsed.path == "/api/discursive-prompts":
                self._json(
                    self.application.planning.create_discursive_prompt(self._body()),
                    HTTPStatus.CREATED,
                )
            elif parsed.path == "/api/discursive-attempts":
                self._json(self.application.planning.save_discursive_attempt(self._body()))
            elif parsed.path.startswith("/api/questions/") and parsed.path.endswith("/reports"):
                question_id = urllib.parse.unquote(
                    parsed.path.removeprefix("/api/questions/").removesuffix("/reports")
                ).strip("/")
                if not question_id or "/" in question_id:
                    raise ValueError("Identificador de questão inválido.")
                self._json(
                    self.application.questions.report_question(question_id, self._body()),
                    HTTPStatus.CREATED,
                )
            elif parsed.path == "/api/quiz-sessions":
                self._json(
                    self.application.questions.create_session(self._body()),
                    HTTPStatus.CREATED,
                )
            elif parsed.path.startswith("/api/quiz-sessions/"):
                parts = [urllib.parse.unquote(part) for part in parsed.path.split("/") if part]
                if len(parts) != 4:
                    raise ValueError("Operação de sessão inválida.")
                _, _, session_id, operation = parts
                if operation == "answer":
                    self._json(
                        self.application.questions.answer_session(session_id, self._body())
                    )
                elif operation == "finish":
                    self._json(self.application.questions.finish_session(session_id))
                else:
                    raise ValueError("Operação de sessão não reconhecida.")
            elif parsed.path == "/api/backups":
                self._json(self.application.backups.create(), HTTPStatus.CREATED)
            elif parsed.path.startswith("/api/backups/"):
                parts = [urllib.parse.unquote(part) for part in parsed.path.split("/") if part]
                if len(parts) != 4:
                    raise ValueError("Operação de backup inválida.")
                _, _, file_name, operation = parts
                if operation == "verify":
                    self._json(self.application.backups.verify(file_name))
                elif operation == "restore":
                    body = self._body()
                    if body.get("confirmation") != "RESTAURAR":
                        raise ValueError("Confirmação de restauração inválida.")
                    result = self.application.backups.restore(file_name)
                    self.application.questions.seed_catalog(
                        PROJECT_ROOT / "data" / "question_catalog.json"
                    )
                    self.application.planning.initialize()
                    self._json(result)
                else:
                    raise ValueError("Operação de backup não reconhecida.")
            else:
                self._error(HTTPStatus.NOT_FOUND, "Rota não localizada.")
        except (ValueError, json.JSONDecodeError) as error:
            self._error(HTTPStatus.BAD_REQUEST, str(error))
        except FileNotFoundError as error:
            self._error(HTTPStatus.NOT_FOUND, str(error))
        except KeyError as error:
            self._error(HTTPStatus.NOT_FOUND, str(error))
        except Exception as error:
            self._error(HTTPStatus.INTERNAL_SERVER_ERROR, f"Falha interna: {error}")

    def _serve_static(self, request_path: str) -> None:
        relative = request_path.lstrip("/") or "index.html"
        candidate = (WEB_ROOT / relative).resolve()
        if WEB_ROOT.resolve() not in candidate.parents and candidate != WEB_ROOT.resolve():
            self._error(HTTPStatus.FORBIDDEN, "Caminho inválido.")
            return
        if not candidate.exists() or candidate.is_dir():
            self._error(HTTPStatus.NOT_FOUND, "Arquivo não localizado.")
            return
        content = candidate.read_bytes()
        content_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        if content_type.startswith("text/") or content_type in {"application/javascript", "application/json"}:
            content_type += "; charset=utf-8"
        self._headers(HTTPStatus.OK, content_type, len(content))
        self.wfile.write(content)

    def _same_origin(self) -> bool:
        origin = self.headers.get("Origin")
        if not origin:
            return True
        parsed = urllib.parse.urlparse(origin)
        return parsed.scheme == "http" and parsed.netloc == self.headers.get("Host")


def _first(query: dict[str, list[str]], key: str) -> str | None:
    values = query.get(key)
    return values[0] if values and values[0] else None


def _int_query(query: dict[str, list[str]], key: str, default: int) -> int:
    value = _first(query, key)
    return int(value) if value is not None else default


def main() -> None:
    parser = argparse.ArgumentParser(description="Centro de Estudos DPE/RN — execução local")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--data-dir", type=Path, default=default_data_dir())
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--disable-updates", action="store_true")
    args = parser.parse_args()
    if args.host not in {"127.0.0.1", "localhost"}:
        raise SystemExit("Por segurança, esta versão só pode escutar na própria máquina.")

    application = LocalApplication(args.data_dir.resolve(), args.disable_updates)
    server = ThreadingHTTPServer((args.host, args.port), ApiHandler)
    server.application = application  # type: ignore[attr-defined]
    for scheduler in application.schedulers:
        scheduler.start()

    def shutdown(*_: Any) -> None:
        for scheduler in application.schedulers:
            scheduler.stop()
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGINT, shutdown)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, shutdown)
    url = f"http://127.0.0.1:{args.port}/"
    print(f"Centro de Estudos DPE/RN disponível em {url}")
    print("Os dados permanecem nesta máquina. Pressione Ctrl+C para encerrar.")
    if not args.no_browser and not os.environ.get("DPE_NO_BROWSER"):
        threading.Timer(0.7, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        for scheduler in application.schedulers:
            scheduler.stop()
        server.server_close()


if __name__ == "__main__":
    main()
