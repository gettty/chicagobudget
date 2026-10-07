#!/usr/bin/env python3
"""Exercise the assembled Pages site over HTTP without starting a server.

Usage: python3 tests/check_pages_http.py http://127.0.0.1:8788 --dist site/dist
"""
import argparse
import html
import json
import re
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener, HTTPRedirectHandler

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = 'https://chicagobudget.com'


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, url):
        return None


opener = build_opener(NoRedirect)


def fetch(base, path, method='GET'):
    try:
        response = opener.open(Request(base + path, method=method), timeout=10)
    except HTTPError as error:
        response = error
    with response:
        return response.status, response.headers, response.read().decode('utf-8', 'replace')


def require_html(base, path, *needles):
    status, headers, body = fetch(base, path)
    assert status == 200, (path, status, body[:200])
    assert '<html' in body.lower() and '<main' in body.lower() and len(body) > 500, path
    for needle in needles:
        assert needle in body, (path, needle)
    return body


def canonical(body, path):
    assert f'href="{ORIGIN}{path}"' in body, ('canonical', path)


def samples(dist):
    manifest = json.loads((dist / 'data/manifest.json').read_text())
    for gov in ('city', 'cps', 'parks'):
        found = None
        for key, file in manifest['chunks'].items():
            if not key.startswith(gov + '.'):
                continue
            for node in json.loads((dist / 'data' / file).read_text())['nodes']:
                if node.get('root') == gov and node.get('depth', 0) >= 5 and node.get('source') is not None:
                    path = f'/{gov}/box/{node["id"]}/'
                    if not (dist / path.lstrip('/') / 'index.html').exists():
                        found = node
                        break
            if found:
                break
        assert found, f'No nonstatic sourced {gov} node in export'
        yield gov, found


def check(base, dist):
    base = base.rstrip('/')
    for attempt in range(40):
        try:
            status, _, _ = fetch(base, '/')
            if status == 200:
                break
        except (URLError, TimeoutError, OSError):
            pass
        time.sleep(.5)
    else:
        raise AssertionError(f'Server did not become ready at {base}')

    home = require_html(base, '/', 'Chicago', '2026')
    for gov in ('city', 'cps', 'parks'):
        assert f'href="/{gov}/"' in home, gov
    assert re.search(r'\$[\d,.]+', home), 'Homepage lacks budget totals'
    for path, text in (('/datasets/', '2026 budget datasets'), ('/guides/', '2026 budget guides'),
                       ('/datasets/2026/city/', 'City'), ('/methods', 'How it works')):
        body = require_html(base, path, text)
        canonical(body, path)
    for path, target in (('/methods/', '/methods'), ('/style-guide', '/'), ('/style-guide/', '/')):
        status, headers, _ = fetch(base, path)
        assert status in (301, 302, 307, 308), (path, status)
        assert headers.get('Location', '').rstrip('/') == (base + target).rstrip('/') or headers.get('Location', '').rstrip('/') == target.rstrip('/'), (path, headers.get('Location'))

    # Static HTML must be served verbatim instead of being replaced by the worker fallback.
    static = dist / 'city/box/city.public-safety/index.html'
    assert static.is_file(), static
    static_body = require_html(base, '/city/box/city.public-safety/', 'public-safety')
    assert static_body == static.read_text(), 'Static box HTML was replaced by fallback'
    for gov, node in samples(dist):
        path = f'/{gov}/box/{node["id"]}/'
        body = require_html(base, path, html.escape(node['name'], quote=False), 'Sources', 'Open interactive view')
        canonical(body, path)
        assert re.search(r'\$[\d,.]+|Exact', body), path
        assert 'independent project' in body, path
        status, _, head = fetch(base, path, 'HEAD')
        assert status == 200 and not head, (path, status, head)
    memo = '/city/box/city-twice.services-between-funds/'
    body = require_html(base, memo, 'One city fund paying another for services', '/city/counted-twice/')
    canonical(body, memo)
    for path in ('/city/box/city.not-real-seo/', '/cps/box/city.public-safety/', '/city/box/city.%2Fsecret/'):
        status, _, _ = fetch(base, path)
        assert status == 404, (path, status)
    status, _, body = fetch(base, '/data/manifest.json')
    assert status == 200 and 'chunks' in json.loads(body)
    assert json.loads(body) == json.loads((dist / 'data/manifest.json').read_text())
    for path in ('/data/sources.json', '/visual-data/sources.json'):
        status, _, body = fetch(base, path)
        assert status == 200 and json.loads(body) == json.loads((dist / path.lstrip('/')).read_text()), path
    assert (dist / 'data/sources.json').read_bytes() != (dist / 'visual-data/sources.json').read_bytes(), 'Source indexes collided'
    print('Pages HTTP: homepage, discovery, redirects, static and dynamic boxes, 404, HEAD, data isolation OK')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('base_url')
    parser.add_argument('--dist', type=Path, default=ROOT / 'site/dist')
    args = parser.parse_args()
    check(args.base_url, args.dist.resolve())
