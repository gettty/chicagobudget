#!/usr/bin/env python3
"""Exercise the assembled Pages site over HTTP without starting a server.

Usage: python3 tests/check_pages_http.py http://127.0.0.1:8788 --dist site/dist
"""
import argparse
import html
import json
import re
import time
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
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
        response = opener.open(Request(base + path, method=method, headers={'User-Agent': 'ChicagoBudgetReleaseVerification/1.0'}), timeout=10)
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


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.canonicals = []
        self.hrefs = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get('href'):
            self.hrefs.append(attrs['href'])
        if tag == 'link' and 'canonical' in attrs.get('rel', '').lower().split():
            self.canonicals.append(attrs.get('href'))


def canonical(body, path):
    links = Links()
    links.feed(body)
    assert links.canonicals == [f'{ORIGIN}{path}'], (path, links.canonicals)
    assert not any('/undefined/' in href or '/null/' in href for href in links.hrefs), path


def money(cents):
    whole, fraction = divmod(abs(cents), 100)
    return f'{"-" if cents < 0 else ""}${whole:,}.{fraction:02d}'


def require_xml(base, path):
    status, _, body = fetch(base, path)
    assert status == 200 and body.lstrip().startswith('<?xml'), (path, status)
    return body


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
    source_index = json.loads((dist / 'data/sources.json').read_text())
    for gov, node in samples(dist):
        path = f'/{gov}/box/{node["id"]}/'
        body = require_html(base, path, '<h2>Sources</h2>', 'Open interactive view')
        assert node['name'] in html.unescape(body), (path, node['name'])
        canonical(body, path)
        assert f'<strong>{money(node["amount_cents"])}</strong>' in body, (path, node['amount_cents'])
        assert 'independent project' in body, path
        indices = node['source'] if isinstance(node['source'], list) else [node['source']]
        citations = [source_index[index] for index in indices if isinstance(index, int) and source_index[index]]
        assert citations, (path, indices)
        for source in citations:
            label = source.get('name') or source.get('doc') or source.get('dataset') or 'Public source'
            assert label in html.unescape(body), (path, label)
            if source.get('url', '').startswith(('http://', 'https://')):
                assert source['url'] in html.unescape(body), (path, source['url'])
            if source.get('page'):
                page_label = ','.join(map(str, source['page'])) if isinstance(source['page'], list) else str(source['page'])
                assert 'page ' + page_label in html.unescape(body), (path, source['page'])
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
    sitemap = ET.fromstring(require_xml(base, '/sitemap-index.xml'))
    segments = [node.text for node in sitemap.findall('.//{*}loc')]
    assert f'{ORIGIN}/sitemap-city.xml' in segments, segments
    city = ET.fromstring(require_xml(base, '/sitemap-city.xml'))
    urls = [node.text for node in city.findall('.//{*}loc')]
    sample = next((url for url in urls if url.startswith(f'{ORIGIN}/city/box/')), None)
    assert sample, 'City sitemap has no box URL'
    sitemap_path = sample.removeprefix(ORIGIN)
    canonical(require_html(base, sitemap_path), sitemap_path)
    print('Pages HTTP: homepage, discovery, redirects, static and dynamic boxes, 404, HEAD, data isolation and sitemap OK')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('base_url')
    parser.add_argument('--dist', type=Path, default=ROOT / 'site/dist')
    args = parser.parse_args()
    check(args.base_url, args.dist.resolve())
