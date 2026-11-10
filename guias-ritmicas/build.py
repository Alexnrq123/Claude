#!/usr/bin/env python3
"""Arma index.html: inserta las fuentes (base64) y el motor dentro de src/app.html."""
import base64, json, pathlib
R = pathlib.Path(__file__).parent
b = lambda f: base64.b64encode((R / "fuentes" / f).read_bytes()).decode()
fonts = {"petaluma": b("petaluma-sub.woff2"), "bravura": b("bravura-sub.woff2"), "pscript": b("pscript-sub.woff2"),
         "barlow500": b("barlow500.woff2"), "barlow700": b("barlow700.woff2")}
html = (R / "src" / "app.html").read_text(encoding="utf-8")
html = html.replace("<script>/*FONTS*/</script>", "<script>window.__GR_FONTS__=" + json.dumps(fonts) + ";</script>")
html = html.replace("<script>/*MOTOR*/</script>", "<script>\n" + (R / "src" / "motor.js").read_text(encoding="utf-8") + "\n</script>")
(R / "index.html").write_text(html, encoding="utf-8")
print("index.html", len(html) // 1024, "KB")
