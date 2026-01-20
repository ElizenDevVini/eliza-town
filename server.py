import http.server
import socketserver
import os

PORT = int(os.environ.get("PORT", 10000))

class CORSHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.gltf': 'model/gltf+json',
        '.glb': 'model/gltf-binary',
        '.bin': 'application/octet-stream',
    }

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

with socketserver.TCPServer(("", PORT), CORSHandler) as httpd:
    print(f"Eliza Town server running at http://localhost:{PORT}")
    httpd.serve_forever()
